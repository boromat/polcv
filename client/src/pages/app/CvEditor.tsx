import { useEffect, useRef, useState } from 'react';
import type { CvContent, CvText, CvVersion, SectionKey, TemplateId } from '../../../../shared/schemas';
import { Field, LazyText, SECTION_LABELS, TEMPLATES } from '../../components/ui';

const rid = () => `t${Math.random().toString(36).slice(2, 10)}`;
const newText = (): CvText => ({ id: rid(), text: '', status: 'fact', reason: '', fallbackText: '', sourceIds: [] });

type Patch = Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>;

function Suggestion({ t, focus, onDecide }: { t: CvText; focus: boolean; onDecide: (d: 'accepted' | 'rejected') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus]);
  return (
    <div ref={ref} className={`suggestion ${focus ? 'focus' : ''}`}>
      <div className="text">„{t.text}”</div>
      <div className="small">
        <b>Dlaczego do sprawdzenia:</b> {t.reason}
      </div>
      <div className="alt">
        Bezpieczna wersja: {t.fallbackText ? `„${t.fallbackText}”` : <i>usunięcie tego punktu</i>}
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => onDecide('accepted')}>
          To prawda — zostaw
        </button>
        <button className="btn sm" onClick={() => onDecide('rejected')}>
          Użyj bezpiecznej wersji
        </button>
      </div>
    </div>
  );
}

function Bullets({ items, onChange }: { items: CvText[]; onChange: (items: CvText[]) => void }) {
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
          <button className="icon-btn" onClick={() => onChange(items.filter((x) => x.id !== b.id))} aria-label="Usuń punkt">
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...items, newText()])}>
        + punkt
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
}: {
  cv: CvVersion;
  onPatch: (p: Patch) => void;
  hasPhoto: boolean;
  unverifiedSkills: string[];
  focusId: string | null;
}) {
  const c = cv.content;
  const setC = (patch: Partial<CvContent>) => onPatch({ content: { ...c, ...patch } });
  const decide = (id: string, d: 'accepted' | 'rejected') => onPatch({ decisions: { ...cv.decisions, [id]: d } });

  const all = [c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)];
  const pending = all.filter((t) => t.status === 'suggested' && !cv.decisions[t.id]);
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
          <b>Notatka AI:</b> {c.notes}
        </div>
      )}

      {pending.length > 0 && (
        <div className="card stack">
          <div>
            <h3>Do Twojej decyzji ({pending.length})</h3>
            <p className="faint">
              Te sformułowania są odważniejsze niż fakty w profilu (na podglądzie na żółto). Zostaw je tylko, jeśli są prawdziwe — na rozmowie mogą o nie zapytać.
            </p>
          </div>
          {pending.map((t) => (
            <Suggestion key={t.id} t={t} focus={focusId === t.id} onDecide={(d) => decide(t.id, d)} />
          ))}
        </div>
      )}

      {unverifiedSkills.length > 0 && (
        <div className="callout warn small">
          <b>Sprawdź umiejętności:</b> tych pozycji nie ma w profilu: {unverifiedSkills.join(', ')}. Jeśli ich nie znasz, usuń je z sekcji Umiejętności poniżej.
        </div>
      )}

      <Section title="Wygląd i dodatki">
        <div className="grid3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`btn ${cv.template === t.id ? 'primary' : ''}`}
              style={{ flexDirection: 'column', gap: 4, padding: '10px 8px', whiteSpace: 'normal' }}
              onClick={() => onPatch({ template: t.id as TemplateId })}
            >
              {t.name}
              <span style={{ fontWeight: 400, fontSize: 11.5, opacity: 0.85 }}>{t.desc}</span>
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={cv.photo} disabled={!hasPhoto} onChange={(e) => onPatch({ photo: e.target.checked })} /> Zdjęcie w CV
        </label>
        <p className="faint" style={{ marginTop: -6 }}>
          {hasPhoto ? cv.photoReason : 'Profil nie ma zdjęcia — dodasz je w zakładce Mój profil.'}
        </p>
        <label className="check">
          <input type="checkbox" checked={cv.rodo.include} onChange={(e) => onPatch({ rodo: { ...cv.rodo, include: e.target.checked } })} /> Klauzula RODO
        </label>
        <p className="faint" style={{ marginTop: -6 }}>
          {cv.rodo.reason}{' '}
          <button className="btn ghost sm" onClick={() => setRodoEdit(!rodoEdit)}>
            {rodoEdit ? 'Zwiń' : 'Edytuj treść'}
          </button>
        </p>
        {rodoEdit && <LazyText multiline rows={4} value={cv.rodo.text} onCommit={(text) => onPatch({ rodo: { ...cv.rodo, text } })} />}
      </Section>

      <Section title="Nagłówek i podsumowanie">
        <Field label="Stanowisko pod nazwiskiem">
          <LazyText value={c.headline} onCommit={(headline) => setC({ headline })} />
        </Field>
        <Field label="Podsumowanie">
          <LazyText multiline rows={4} value={c.summary.text} onCommit={(text) => setC({ summary: { ...c.summary, text, status: 'fact', reason: '', fallbackText: '' } })} />
        </Field>
      </Section>

      <Section title="Kolejność sekcji" defaultOpen={false}>
        <div className="order-list">
          {order.map((k, i) => (
            <div key={k} className="order-item">
              <span className="name">{SECTION_LABELS[k]}</span>
              <button className="icon-btn" disabled={i === 0} onClick={() => moveSection(i, -1)} aria-label="W górę">↑</button>
              <button className="icon-btn" disabled={i === order.length - 1} onClick={() => moveSection(i, 1)} aria-label="W dół">↓</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Doświadczenie (${c.experience.length})`}>
        {c.experience.map((e, i) => {
          const upd = (patch: Partial<typeof e>) => setC({ experience: c.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label="Stanowisko"><LazyText value={e.role} onCommit={(role) => upd({ role })} /></Field>
                <Field label="Firma"><LazyText value={e.company} onCommit={(company) => upd({ company })} /></Field>
                <Field label="Daty"><LazyText value={e.dates} onCommit={(dates) => upd({ dates })} /></Field>
                <Field label="Miejscowość"><LazyText value={e.location} onCommit={(location) => upd({ location })} /></Field>
              </div>
              <Bullets items={e.bullets} onChange={(bullets) => upd({ bullets })} />
              <button className="btn ghost sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => setC({ experience: c.experience.filter((_, j) => j !== i) })}>
                Usuń pozycję z CV
              </button>
            </div>
          );
        })}
      </Section>

      <Section title={`Projekty (${c.projects.length})`}>
        {c.projects.map((p, i) => {
          const upd = (patch: Partial<typeof p>) => setC({ projects: c.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label="Nazwa"><LazyText value={p.name} onCommit={(name) => upd({ name })} /></Field>
                <Field label="Rola"><LazyText value={p.role} onCommit={(role) => upd({ role })} /></Field>
                <Field label="Daty"><LazyText value={p.dates} onCommit={(dates) => upd({ dates })} /></Field>
                <Field label="Link"><LazyText value={p.link} onCommit={(link) => upd({ link })} /></Field>
              </div>
              <Field label="Technologie (po przecinku)">
                <LazyText value={p.technologies.join(', ')} onCommit={(t) => upd({ technologies: t.split(',').map((s) => s.trim()).filter(Boolean) })} />
              </Field>
              <Bullets items={p.bullets} onChange={(bullets) => upd({ bullets })} />
              <button className="btn ghost sm danger" style={{ alignSelf: 'flex-end' }} onClick={() => setC({ projects: c.projects.filter((_, j) => j !== i) })}>
                Usuń projekt z CV
              </button>
            </div>
          );
        })}
      </Section>

      <Section title={`Wykształcenie (${c.education.length})`}>
        {c.education.map((e, i) => {
          const upd = (patch: Partial<typeof e>) => setC({ education: c.education.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="entry-card">
              <div className="grid2">
                <Field label="Stopień"><LazyText value={e.degree} onCommit={(degree) => upd({ degree })} /></Field>
                <Field label="Kierunek"><LazyText value={e.field} onCommit={(field) => upd({ field })} /></Field>
                <Field label="Uczelnia"><LazyText value={e.school} onCommit={(school) => upd({ school })} /></Field>
                <Field label="Daty"><LazyText value={e.dates} onCommit={(dates) => upd({ dates })} /></Field>
              </div>
              <Field label="Szczegóły"><LazyText multiline value={e.details} onCommit={(details) => upd({ details })} /></Field>
            </div>
          );
        })}
      </Section>

      <Section title="Umiejętności">
        {c.skills.map((g, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: 150 }}>
              <LazyText value={g.category} onCommit={(category) => setC({ skills: c.skills.map((x, j) => (j === i ? { ...x, category } : x)) })} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <LazyText
                multiline
                value={g.items.join(', ')}
                onCommit={(t) => setC({ skills: c.skills.map((x, j) => (j === i ? { ...x, items: t.split(',').map((s) => s.trim()).filter(Boolean) } : x)) })}
              />
            </div>
            <button className="icon-btn" onClick={() => setC({ skills: c.skills.filter((_, j) => j !== i) })} aria-label="Usuń grupę">✕</button>
          </div>
        ))}
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setC({ skills: [...c.skills, { category: c.language === 'pl' ? 'Inne' : 'Other', items: [] }] })}>
          + grupa umiejętności
        </button>
      </Section>

      <Section title="Języki, certyfikaty, zainteresowania" defaultOpen={false}>
        <Field label="Języki (np. Angielski – B2, po przecinku)">
          <LazyText
            value={c.languages.map((l) => (l.level ? `${l.name} – ${l.level}` : l.name)).join(', ')}
            onCommit={(t) =>
              setC({
                languages: t.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
                  const [name, level = ''] = s.split(/\s*[–-]\s*/);
                  return { name, level };
                }),
              })
            }
          />
        </Field>
        <Field label="Certyfikaty i kursy (jeden w linii: nazwa – wystawca – data)">
          <LazyText
            multiline
            rows={3}
            value={c.certificates.map((x) => [x.name, x.issuer, x.date].filter(Boolean).join(' – ')).join('\n')}
            onCommit={(t) =>
              setC({
                certificates: t.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
                  const [name, issuer = '', date = ''] = s.split(/\s+–\s+/);
                  return { name, issuer, date };
                }),
              })
            }
          />
        </Field>
        <Field label="Zainteresowania (po przecinku)">
          <LazyText value={c.interests.join(', ')} onCommit={(t) => setC({ interests: t.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>
      </Section>
    </div>
  );
}
