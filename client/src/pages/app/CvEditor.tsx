import { useEffect, useRef, useState } from 'react';
import type { CvContent, CvText, CvVersion, SectionKey, TemplateId } from '../../../../shared/schemas';
import { Field, LazyText, SECTION_LABELS, TEMPLATES } from '../../components/ui';
import { useT } from '../../i18n';

const rid = () => `t${Math.random().toString(36).slice(2, 10)}`;
const newText = (): CvText => ({ id: rid(), text: '', status: 'fact', reason: '', fallbackText: '', sourceIds: [] });
// Pozycja dopisana w edytorze: przedrostek "cv-" mówi serwerowi, że to nowa pozycja, którą ma też założyć w profilu.
const newSourceId = () => `cv-${Math.random().toString(36).slice(2, 10)}`;
const newExperience = (): CvContent['experience'][number] => ({ sourceId: newSourceId(), role: '', company: '', location: '', dates: '', bullets: [newText()] });
const newProject = (): CvContent['projects'][number] => ({ sourceId: newSourceId(), name: '', role: '', dates: '', technologies: [], link: '', bullets: [newText()] });
const newEducation = (): CvContent['education'][number] => ({ sourceId: newSourceId(), school: '', degree: '', field: '', dates: '', details: '' });

type Patch = Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>;
type Decision = 'accepted' | 'rejected';

/** Decyzja wpisana w treść: zaakceptowana → fakt, odrzucona → bezpieczna wersja jako fakt, a bez niej usunięcie (null). */
function resolveText(item: CvText, d: Decision): CvText | null {
  if (d === 'accepted') return { ...item, status: 'fact', reason: '', fallbackText: '' };
  return item.fallbackText.trim() ? { ...item, text: item.fallbackText, status: 'fact', reason: '', fallbackText: '' } : null;
}

/** Treść z wpisanymi decyzjami, tak samo jak applyDecisions na serwerze (starsze wersje trzymały decyzje osobno). */
function withDecisions(c: CvContent, decisions: CvVersion['decisions']): CvContent {
  const r = (x: CvText) => (x.status === 'suggested' && decisions[x.id] ? resolveText(x, decisions[x.id]) : x);
  const keep = (items: CvText[]) => items.map(r).filter((x): x is CvText => x !== null);
  return {
    ...c,
    summary: r(c.summary) ?? { ...c.summary, text: '', status: 'fact', reason: '', fallbackText: '' },
    experience: c.experience.map((e) => ({ ...e, bullets: keep(e.bullets) })),
    projects: c.projects.map((p) => ({ ...p, bullets: keep(p.bullets) })),
  };
}

const allTexts = (c: CvContent) => [c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)];

/** Liczba sugestii bez decyzji - to samo liczy serwer (pendingSuggestions). */
export const pendingCount = (cv: Pick<CvVersion, 'content' | 'decisions'>) => allTexts(cv.content).filter((x) => x.status === 'suggested' && !cv.decisions[x.id]).length;

function Suggestion({ item, focus, onDecide }: { item: CvText; focus: boolean; onDecide: (d: 'accepted' | 'rejected') => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus]);
  return (
    <div ref={ref} className={`suggestion ${focus ? 'focus' : ''}`}>
      <div className="text">{t('„{text}”', { text: item.text })}</div>
      <div className="small">
        <b>{t('Dlaczego do sprawdzenia:')}</b> {item.reason}
      </div>
      <div className="alt">
        {t('Bezpieczna wersja:')} {item.fallbackText ? t('„{text}”', { text: item.fallbackText }) : <i>{t('usunięcie tego punktu')}</i>}
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => onDecide('accepted')}>
          {t('To prawda - zostaw')}
        </button>
        <button className="btn sm" onClick={() => onDecide('rejected')}>
          {t('Użyj bezpiecznej wersji')}
        </button>
      </div>
    </div>
  );
}

function Bullets({ items, onChange }: { items: CvText[]; onChange: (items: CvText[]) => void }) {
  const { t } = useT();
  return (
    <div className="stack" style={{ gap: 6 }}>
      {items.map((b) => (
        <div key={b.id} className={`bullet-row ${b.status === 'suggested' ? 'suggested' : ''}`}>
          <span className="faint" style={{ paddingTop: 8 }}>•</span>
          <LazyText
            multiline
            value={b.text}
            // Ręczna edycja sugestii = kandydat bierze ją na siebie.
            onCommit={(text) => onChange(items.map((x) => (x.id === b.id ? { ...x, text, status: 'fact', reason: '', fallbackText: '' } : x)))}
          />
          <button className="icon-btn" onClick={() => onChange(items.filter((x) => x.id !== b.id))} aria-label={t('Usuń punkt')}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...items, newText()])}>
        {t('+ punkt')}
      </button>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="card" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {children}
      </div>
    </details>
  );
}

export function CvEditor({
  cv,
  onPatch,
  hasPhoto,
  unverifiedSkills,
  focusId,
  onInstruct,
}: {
  cv: CvVersion;
  onPatch: (p: Patch) => void;
  hasPhoto: boolean;
  unverifiedSkills: string[];
  focusId: string | null;
  /** polecenie dla AI z pola na dole edytora; true, gdy się udało (pole się wtedy czyści) */
  onInstruct: (instruction: string) => Promise<boolean>;
}) {
  const { t } = useT();
  // Edytor pokazuje treść z wpisanymi decyzjami: odrzucona sugestia nie może wrócić przy kolejnej edycji.
  const legacy = Object.keys(cv.decisions).length > 0;
  const c = legacy ? withDecisions(cv.content, cv.decisions) : cv.content;
  const setContent = (content: CvContent) => onPatch(legacy ? { content, decisions: {} } : { content });
  const setC = (patch: Partial<CvContent>) => setContent({ ...c, ...patch });
  const decide = (id: string, d: Decision) => setContent(withDecisions(c, { [id]: d }));

  const pending = allTexts(c).filter((x) => x.status === 'suggested');
  const [rodoEdit, setRodoEdit] = useState(false);

  const allSections: SectionKey[] = ['summary', 'experience', 'projects', 'education', 'skills', 'certificates', 'languages', 'interests'];
  const order = [...c.sectionOrder, ...allSections.filter((s) => !c.sectionOrder.includes(s))];
  const moveSection = (i: number, d: number) => {
    const next = [...order];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setC({ sectionOrder: next });
  };

  return (
    <div className="editor-form">
      {c.notes && (
        <div className="callout info small">
          <b>{t('Notatka AI:')}</b> {c.notes}
        </div>
      )}

      {pending.length > 0 && (
        <div className="card stack">
          <div>
            <h3>{t('Do Twojej decyzji ({n})', { n: pending.length })}</h3>
            <p className="faint">
              {t('Te sformułowania są odważniejsze niż fakty w profilu (na podglądzie na żółto). Zostaw je tylko, jeśli są prawdziwe - na rozmowie mogą o nie zapytać.')}
            </p>
          </div>
          {pending.map((s) => (
            <Suggestion key={s.id} item={s} focus={focusId === s.id} onDecide={(d) => decide(s.id, d)} />
          ))}
        </div>
      )}

      {unverifiedSkills.length > 0 && (
        <div className="callout warn small">
          <b>{t('Sprawdź umiejętności:')}</b>{' '}
          {t('tych pozycji nie ma w profilu: {skills}. Jeśli ich nie znasz, usuń je z sekcji Umiejętności poniżej.', { skills: unverifiedSkills.join(', ') })}
        </div>
      )}

      <Section title={t('Wygląd i dodatki')}>
        <div className="grid3">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              className={`btn ${cv.template === tpl.id ? 'primary' : ''}`}
              style={{ flexDirection: 'column', gap: 4, padding: '10px 8px', whiteSpace: 'normal' }}
              onClick={() => onPatch({ template: tpl.id as TemplateId })}
            >
              {t(tpl.name)}
              <span style={{ fontWeight: 400, fontSize: 11.5, opacity: 0.85 }}>{t(tpl.desc)}</span>
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={cv.photo} disabled={!hasPhoto} onChange={(e) => onPatch({ photo: e.target.checked })} /> {t('Zdjęcie w CV')}
        </label>
        <p className="faint" style={{ marginTop: -6 }}>
          {hasPhoto ? cv.photoReason : t('Profil nie ma zdjęcia - dodasz je w zakładce Mój profil.')}
        </p>
        <label className="check">
          <input type="checkbox" checked={cv.rodo.include} onChange={(e) => onPatch({ rodo: { ...cv.rodo, include: e.target.checked } })} /> {t('Klauzula RODO')}
        </label>
        <p className="faint" style={{ marginTop: -6 }}>
          {cv.rodo.reason}{' '}
          <button className="btn ghost sm" onClick={() => setRodoEdit(!rodoEdit)}>
            {rodoEdit ? t('Zwiń') : t('Edytuj treść')}
          </button>
        </p>
        {rodoEdit && <LazyText multiline rows={4} value={cv.rodo.text} onCommit={(text) => onPatch({ rodo: { ...cv.rodo, text } })} />}
      </Section>

      <Section title={t('Nagłówek i podsumowanie')}>
        <Field label={t('Stanowisko pod nazwiskiem')}>
          <LazyText value={c.headline} onCommit={(headline) => setC({ headline })} />
        </Field>
        <Field label={t('Podsumowanie')}>
          <LazyText multiline rows={4} value={c.summary.text} onCommit={(text) => setC({ summary: { ...c.summary, text, status: 'fact', reason: '', fallbackText: '' } })} />
        </Field>
      </Section>

      <Section title={t('Kolejność sekcji')} defaultOpen={false}>
        <div className="order-list">
          {order.map((k, i) => (
            <div key={k} className="order-item">
              <span className="name">{t(SECTION_LABELS[k])}</span>
              <button className="icon-btn" disabled={i === 0} onClick={() => moveSection(i, -1)} aria-label={t('W górę')}>↑</button>
              <button className="icon-btn" disabled={i === order.length - 1} onClick={() => moveSection(i, 1)} aria-label={t('W dół')}>↓</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('Doświadczenie ({n})', { n: c.experience.length })}>
        {c.experience.map((e, i) => {
          const upd = (patch: Partial<typeof e>) => setC({ experience: c.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label={t('Stanowisko')}><LazyText value={e.role} onCommit={(role) => upd({ role })} /></Field>
                <Field label={t('Firma')}><LazyText value={e.company} onCommit={(company) => upd({ company })} /></Field>
                <Field label={t('Daty')}><LazyText value={e.dates} onCommit={(dates) => upd({ dates })} /></Field>
                <Field label={t('Miejscowość')}><LazyText value={e.location} onCommit={(location) => upd({ location })} /></Field>
              </div>
              <Bullets items={e.bullets} onChange={(bullets) => upd({ bullets })} />
              <button className="btn ghost sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => setC({ experience: c.experience.filter((_, j) => j !== i) })}>
                {t('Usuń pozycję z CV')}
              </button>
            </div>
          );
        })}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setC({ experience: [...c.experience, newExperience()] })}>
          {t('+ doświadczenie')}
        </button>
      </Section>

      <Section title={t('Projekty ({n})', { n: c.projects.length })}>
        {c.projects.map((p, i) => {
          const upd = (patch: Partial<typeof p>) => setC({ projects: c.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label={t('Nazwa')}><LazyText value={p.name} onCommit={(name) => upd({ name })} /></Field>
                <Field label={t('Rola')}><LazyText value={p.role} onCommit={(role) => upd({ role })} /></Field>
                <Field label={t('Daty')}><LazyText value={p.dates} onCommit={(dates) => upd({ dates })} /></Field>
                <Field label={t('Link')}><LazyText value={p.link} onCommit={(link) => upd({ link })} /></Field>
              </div>
              <Field label={t('Technologie (po przecinku)')}>
                <LazyText value={p.technologies.join(', ')} onCommit={(v) => upd({ technologies: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </Field>
              <Bullets items={p.bullets} onChange={(bullets) => upd({ bullets })} />
              <button className="btn ghost sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => setC({ projects: c.projects.filter((_, j) => j !== i) })}>
                {t('Usuń projekt z CV')}
              </button>
            </div>
          );
        })}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setC({ projects: [...c.projects, newProject()] })}>
          {t('+ projekt')}
        </button>
      </Section>

      <Section title={t('Wykształcenie ({n})', { n: c.education.length })}>
        {c.education.map((e, i) => {
          const upd = (patch: Partial<typeof e>) => setC({ education: c.education.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label={t('Stopień')}><LazyText value={e.degree} onCommit={(degree) => upd({ degree })} /></Field>
                <Field label={t('Kierunek')}><LazyText value={e.field} onCommit={(field) => upd({ field })} /></Field>
                <Field label={t('Uczelnia')}><LazyText value={e.school} onCommit={(school) => upd({ school })} /></Field>
                <Field label={t('Daty')}><LazyText value={e.dates} onCommit={(dates) => upd({ dates })} /></Field>
              </div>
              <Field label={t('Szczegóły')}><LazyText multiline value={e.details} onCommit={(details) => upd({ details })} /></Field>
              <button className="btn ghost sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => setC({ education: c.education.filter((_, j) => j !== i) })}>
                {t('Usuń szkołę z CV')}
              </button>
            </div>
          );
        })}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setC({ education: [...c.education, newEducation()] })}>
          {t('+ szkoła')}
        </button>
      </Section>

      <Section title={t('Umiejętności')}>
        {c.skills.map((g, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: 150 }}>
              <LazyText value={g.category} onCommit={(category) => setC({ skills: c.skills.map((x, j) => (j === i ? { ...x, category } : x)) })} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <LazyText
                multiline
                value={g.items.join(', ')}
                onCommit={(v) => setC({ skills: c.skills.map((x, j) => (j === i ? { ...x, items: v.split(',').map((s) => s.trim()).filter(Boolean) } : x)) })}
              />
            </div>
            <button className="icon-btn" onClick={() => setC({ skills: c.skills.filter((_, j) => j !== i) })} aria-label={t('Usuń grupę')}>✕</button>
          </div>
        ))}
        {/* Nazwa nowej grupy trafia do treści CV, więc idzie za językiem CV, nie interfejsu. */}
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setC({ skills: [...c.skills, { category: c.language === 'pl' ? 'Inne' : 'Other', items: [] }] })}>
          {t('+ grupa umiejętności')}
        </button>
      </Section>

      <Section title={t('Języki, certyfikaty, zainteresowania')} defaultOpen={false}>
        <Field label={t('Języki (np. Angielski - B2, po przecinku)')}>
          <LazyText
            value={c.languages.map((l) => (l.level ? `${l.name} - ${l.level}` : l.name)).join(', ')}
            onCommit={(v) =>
              setC({
                languages: v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
                  const [name, level = ''] = s.split(/\s*[–-]\s*/);
                  return { name, level };
                }),
              })
            }
          />
        </Field>
        <Field label={t('Certyfikaty i kursy (jeden w linii: nazwa - wystawca - data)')}>
          <LazyText
            multiline
            rows={3}
            value={c.certificates.map((x) => [x.name, x.issuer, x.date].filter(Boolean).join(' - ')).join('\n')}
            onCommit={(v) =>
              setC({
                certificates: v.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
                  // Myślnik ze spacjami po obu stronach; półpauza ze starszych wersji też się liczy.
                  const [name, issuer = '', date = ''] = s.split(/\s+[-–]\s+/);
                  return { name, issuer, date };
                }),
              })
            }
          />
        </Field>
        <Field label={t('Zainteresowania (po przecinku)')}>
          <LazyText value={c.interests.join(', ')} onCommit={(v) => setC({ interests: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      </Section>

      <InstructBox onInstruct={onInstruct} />
    </div>
  );
}

/** Pole na dole edytora: kandydat pisze AI, co ma zmienić (np. co dodać z profilu). */
function InstructBox({ onInstruct }: { onInstruct: (instruction: string) => Promise<boolean> }) {
  const { t } = useT();
  const [text, setText] = useState('');
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>{t('Polecenie dla AI')}</h3>
      <p className="faint small">
        {t('Napisz, co AI ma zmienić w tym CV, np. co dodać z Twojego profilu. Zrobi tylko to, o co prosisz, tylko z faktów z profilu, i utworzy nową wersję (obecna zostanie na liście).')}
      </p>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Np. dodaj praktyki zawodowe i harcerstwo z mojego profilu')} aria-label={t('Polecenie dla AI')} />
      <button
        className="btn sm primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={!text.trim()}
        onClick={async () => {
          if (await onInstruct(text.trim())) setText('');
        }}
      >
        {t('Zmień CV')}
      </button>
    </div>
  );
}
