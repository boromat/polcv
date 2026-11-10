import { useEffect, useRef, useState } from 'react';
import type { AtsReport, ImproveOption, ImproveOptions } from '../../../../shared/schemas';
import { ErrorBox, scoreColor } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../../../shared/errors';

type T = ReturnType<typeof useT>['t'];

// Nazwy kryteriów oceny AI; funkcja zamiast stałej, żeby brały aktualny język.
const criteria = (t: T): Record<string, string> => ({
  must_have_match: t('Spełnienie wymagań obowiązkowych'),
  achievements: t('Konkretne osiągnięcia i efekty'),
  summary_fit: t('Dopasowanie nagłówka i podsumowania'),
  clarity: t('Czytelność i zwięzłość'),
  red_flags: t('Brak czerwonych flag'),
});

// Werdykt AI to wartość z ustalonego zbioru (dane), tłumaczymy tylko to, co widać.
const verdictLabels = (t: T): Record<string, string> => ({
  tak: t('tak'),
  'raczej tak': t('raczej tak'),
  'raczej nie': t('raczej nie'),
  nie: t('nie'),
});

// Sekcje CV, w których znaleziono słowo kluczowe.
const whereLabels = (t: T): Record<string, string> => ({
  summary: t('podsumowanie'),
  experience: t('doświadczenie'),
  projects: t('projekty'),
  education: t('wykształcenie'),
  certificates: t('certyfikaty'),
  languages: t('języki'),
  skills: t('umiejętności'),
  headline: t('nagłówek'),
  technologies: t('technologie projektu'),
  interests: t('zainteresowania'),
});

function Meter({ label, value, max, hint }: { label: string; value: number; max: number; hint: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="meter">
      <div className="row">
        <b>{label}</b>
        <span>
          <b>{value}</b>
          <span className="faint">/{max}</span>
        </span>
      </div>
      <div className="bar">
        <div style={{ width: `${pct}%`, background: scoreColor(pct) }} />
      </div>
      <span className="faint">{hint}</span>
    </div>
  );
}

/** Odpowiedź kandydata w raporcie: trafia do profilu jako potwierdzony fakt. */
function FactForm({ question, placeholder, onSave, onCancel }: { question: string; placeholder: string; onSave: (answer: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(text.trim());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="callout info stack" style={{ marginTop: 8, gap: 8 }}>
      <b>{question}</b>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus aria-label={question} />
      <ErrorBox error={error} onClose={() => setError(null)} />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button className="btn sm" onClick={onCancel} disabled={busy}>
          {t('Anuluj')}
        </button>
        <button className="btn sm primary" onClick={save} disabled={busy || !text.trim()}>
          {busy ? t('Zapisuję…') : t('Zapisz w profilu')}
        </button>
      </div>
    </div>
  );
}

/** Pytanie z poprawki "wymaga Twoich danych" (rekruter pisze je w "why"); jak fixQuestion na serwerze. */
const fixQuestion = (f: { why: string; replace: string }) => f.why.trim() || f.replace.trim();

/**
 * Wybór przed "Popraw automatycznie": kandydat zaznacza, co AI ma zmienić. Nic nie jest zaznaczone z góry,
 * a AI zmienia tylko zaznaczone miejsca.
 */
function ImprovePicker({
  load,
  stale,
  onEvaluate,
  onApply,
  onClose,
}: {
  load: () => Promise<ImproveOptions>;
  stale: boolean;
  onEvaluate: () => void;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const CRITERIA = criteria(t);
  const [data, setData] = useState<ImproveOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), []);
  // Lista jest liczona z bieżącej oceny: po ponownej ocenie wczytuje się od nowa.
  useEffect(() => {
    if (stale) return;
    let live = true;
    setData(null);
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);
  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const title = (o: ImproveOption) =>
    o.kind === 'criterion'
      ? t('Kryterium: {name}', { name: CRITERIA[o.criterion ?? ''] ?? o.criterion ?? '' })
      : o.kind === 'fix'
        ? t('Poprawka rekrutera: {section}', { section: o.title })
        : o.title;

  return (
    <div ref={box} className="callout info stack" style={{ marginTop: 12, gap: 10 }}>
      <div className="row between">
        <h3>{t('Co AI ma poprawić?')}</h3>
        <button className="btn ghost sm" onClick={onClose}>
          {t('Zamknij')}
        </button>
      </div>
      {stale ? (
        <div className="row between">
          <span>{t('CV zmieniło się od ostatniej oceny. Oceń je ponownie, żeby wybrać aktualne poprawki.')}</span>
          <button className="btn sm" onClick={onEvaluate}>
            {t('Oceń ponownie')}
          </button>
        </div>
      ) : (
        <>
          <p className="small">{t('Zaznacz, co chcesz zmienić. AI poprawi tylko te miejsca, a resztę CV zostawi tak, jak jest. Potem program oceni nową wersję i zostawi lepszą.')}</p>
          <ErrorBox error={error} onClose={() => setError(null)} />
          {!data && !error && <p className="faint">{t('Wczytuję poprawki…')}</p>}
          {data && !data.options.length && (
            <div className="small">
              {t('Raport nie wskazuje niczego, co AI mogłoby poprawić bez nowych informacji.')}
              {data.needsInput.length > 0 && (
                <>
                  {' '}
                  {t('Możesz dopisać w profilu:')}
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {data.needsInput.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {data && data.options.length > 0 && (
            <>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={() => setChosen(new Set(data.options.map((o) => o.id)))}>
                  {t('Zaznacz wszystkie')}
                </button>
                <button className="btn ghost sm" onClick={() => setChosen(new Set())} disabled={!chosen.size}>
                  {t('Odznacz wszystkie')}
                </button>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {data.options.map((o) => (
                  <label key={o.id} className="fix" style={{ cursor: 'pointer', background: 'var(--card)' }}>
                    <span className="check">
                      <input type="checkbox" checked={chosen.has(o.id)} onChange={() => toggle(o.id)} aria-label={title(o)} />
                      <b>{title(o)}</b>
                    </span>
                    {o.find && (
                      <div className="small">
                        <del>{o.find}</del>
                      </div>
                    )}
                    {o.replace && (
                      <div className="small">
                        <ins>{o.replace}</ins>
                      </div>
                    )}
                    {o.detail && <span className="faint">{o.detail}</span>}
                  </label>
                ))}
              </div>
            </>
          )}
          {data && data.pages > 1 && <p className="faint">{t('CV ma {n} strony: skrócisz je przyciskiem „Skróć do 1 strony” w zakładce Edytor CV.', { n: data.pages })}</p>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button className="btn sm" onClick={onClose}>
              {t('Anuluj')}
            </button>
            <button className="btn sm primary" onClick={() => onApply([...chosen])} disabled={!chosen.size}>
              {chosen.size ? t('Wprowadź zaznaczone ({n})', { n: chosen.size }) : t('Wprowadź zaznaczone')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ReportView({
  report,
  stale,
  onEvaluate,
  picker,
  onPicker,
  loadOptions,
  onImprove,
  pending,
  factTopics,
  onAddFact,
}: {
  report: AtsReport | null;
  stale: boolean;
  onEvaluate: () => void;
  /** czy lista wyboru poprawek jest otwarta */
  picker: boolean;
  onPicker: (open: boolean) => void;
  loadOptions: () => Promise<ImproveOptions>;
  /** poprawa zaznaczonych pozycji (id z listy wyboru) */
  onImprove: (ids: string[]) => void;
  pending: number;
  /** tematy już potwierdzone w profilu przy tej aplikacji */
  factTopics: string[];
  onAddFact: (topic: string, answer: string) => Promise<void>;
}) {
  const { t } = useT();
  // Otwarty formularz: "kw:<słowo>" albo "fix:<nr poprawki>".
  const [open, setOpen] = useState<string | null>(null);
  // Gdzie ostatnio zapisano odpowiedź: tam pokazujemy, co dalej.
  const [saved, setSaved] = useState<'kw' | 'fix' | null>(null);
  // Każde otwarcie wyboru wczytuje go od nowa (np. po zapisaniu odpowiedzi w profilu dochodzą nowe pozycje).
  const [pickerKey, setPickerKey] = useState(0);
  const openPicker = () => {
    setPickerKey((k) => k + 1);
    onPicker(true);
  };
  const inProfile = (topic: string) => factTopics.some((x) => x.trim().toLowerCase() === topic.trim().toLowerCase());
  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key));
  const addFact = async (where: 'kw' | 'fix', topic: string, answer: string) => {
    await onAddFact(topic, answer);
    setOpen(null);
    setSaved(where);
  };
  if (!report) {
    return (
      <div className="card empty">
        <h2>{t('Ta wersja nie ma jeszcze oceny')}</h2>
        <button className="btn primary" onClick={onEvaluate}>
          {t('Oceń CV')}
        </button>
      </div>
    );
  }
  const r = report;
  const review = r.ai?.review;
  const positive = review ? review.wouldInterview === 'tak' || review.wouldInterview === 'raczej tak' : false;
  const verdictTone = review ? (positive ? 'good' : 'bad') : '';
  const CRITERIA = criteria(t);
  const VERDICTS = verdictLabels(t);
  const WHERE = whereLabels(t);
  // Bez części AI nie ma wyniku łącznego; pokazujemy tylko punkty, które da się policzyć.
  const total = r.total;
  const partial = r.keywords.score + r.format.score;
  const partialMax = r.keywords.max + r.format.max;
  const openKeyword = r.keywords.missing.find((k) => open === `kw:${k.term}`);
  const savedNote = (where: 'kw' | 'fix') =>
    saved === where && (
    <div className="callout good row between">
      <span>{t('Zapisane w profilu. Kliknij „Popraw automatycznie” i zaznacz, co AI ma dodać do CV.')}</span>
      <button className="btn sm primary" onClick={openPicker} disabled={pending > 0}>
        {t('Popraw automatycznie')}
      </button>
    </div>
  );

  return (
    <div className="stack lg">
      {stale && (
        <div className="callout warn row between">
          <span>{t('CV zmieniło się od ostatniej oceny - wynik może być nieaktualny.')}</span>
          <button className="btn sm" onClick={onEvaluate}>
            {t('Oceń ponownie')}
          </button>
        </div>
      )}

      <div className="card">
        <div className="grid2" style={{ alignItems: 'center' }}>
          <div className="score-big">
            <div className="score-ring" style={{ ['--v' as any]: total ?? 0, ['--c' as any]: total == null ? 'var(--faint)' : scoreColor(total) }}>
              <div>{total ?? '?'}</div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h2>{t('Ocena łączna')}</h2>
              {total == null && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{t('niepełna - bez oceny AI')}</span>}
              {total == null && (
                <p className="small muted">
                  {t('Bez oceny AI nie ma wyniku łącznego. Słowa kluczowe i format: {got}/{max} pkt.', { got: partial, max: partialMax })}
                </p>
              )}
              {review && (
                <span className={`badge ${verdictTone}`} style={{ alignSelf: 'flex-start' }}>
                  {t('AI-rekruter:')} {positive ? t('zaprosiłby na rozmowę') : t('raczej nie zaprosiłby')} ({VERDICTS[review.wouldInterview] ?? review.wouldInterview})
                </span>
              )}
              {review && <p className="small">{review.verdict}</p>}
            </div>
          </div>
          <div className="stack">
            <Meter label={t('Słowa kluczowe ATS')} value={r.keywords.score} max={r.keywords.max} hint={t('Czy CV zawiera słowa, których szuka filtr ATS.')} />
            <Meter label={t('Format i czytelność dla ATS')} value={r.format.score} max={r.format.max} hint={t('Sprawdzone na gotowym PDF - tak, jak czyta go ATS.')} />
            {r.ai ? (
              <Meter label={t('Ocena AI-rekrutera')} value={r.ai.score} max={r.ai.max} hint={t('Jak oceniłby Cię automatyczny screening AI.')} />
            ) : (
              <div className="callout warn small">{t('Ocena AI nie powiodła się:')} {r.aiError}</div>
            )}
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <span className="faint">{t('Wybierzesz, co AI ma poprawić. Zmieni tylko te miejsca, oceni nową wersję i zostawi lepszą.')}</span>
          <button className="btn primary" onClick={openPicker} disabled={pending > 0 || picker} title={pending > 0 ? t('Najpierw zdecyduj o żółtych sugestiach') : ''}>
            {t('Popraw automatycznie')}
          </button>
        </div>
        {pending > 0 && (
          <p className="faint" style={{ textAlign: 'right' }}>
            {pending === 1 ? t('Najpierw zdecyduj o 1 żółtej sugestii w edytorze.') : t('Najpierw zdecyduj o {n} żółtych sugestiach w edytorze.', { n: pending })}
          </p>
        )}
        {picker && pending === 0 && (
          <ImprovePicker key={pickerKey} load={loadOptions} stale={stale} onEvaluate={onEvaluate} onApply={onImprove} onClose={() => onPicker(false)} />
        )}
      </div>

      <div className="card stack">
        <h2>{t('Słowa kluczowe z ogłoszenia')}</h2>
        <p className="muted small">
          {t('Filtr ATS szuka w CV konkretnych słów z ogłoszenia. Wymagane liczą się 3× mocniej niż mile widziane, kompetencje miękkie zawsze 1×. Polskie odmiany i skróty są rozpoznawane, a klauzula RODO się nie liczy.')}
        </p>
        <div>
          <b className="small">{t('Znalezione ({n})', { n: r.keywords.matched.length })}</b>
          <div className="chips" style={{ marginTop: 6 }}>
            {r.keywords.matched.map((k) => {
              // Starsze raporty nie mają sekcji ani punktacji częściowej: wtedy pełne punkty.
              const credit = k.credit ?? 1;
              const where = (k.where ?? []).map((w) => WHERE[w] ?? w).join(', ');
              return (
                <span key={k.term} className={`badge ${credit >= 1 ? 'good' : 'warn'}`} title={t('Znalezione jako „{term}”', { term: k.foundAs })}>
                  {credit >= 1 ? '✓' : credit > 0 ? '½' : '0'} {k.term} {k.count > 1 && <span className="faint">×{k.count}</span>}
                  {where && <span className="faint">({where})</span>}
                </span>
              );
            })}
          </div>
          {r.keywords.matched.some((k) => (k.credit ?? 1) < 1) && (
            <p className="faint" style={{ marginTop: 6 }}>
              {t('½ - słowo jest tylko na liście umiejętności, w nagłówku albo w technologiach projektu. Pełne punkty daje użycie w opisie doświadczenia, projektu, wykształcenia lub w podsumowaniu.')}{' '}
              {r.keywords.matched.some((k) => k.credit === 0) && t('0 - kompetencja miękka bez przykładu w opisie doświadczenia lub projektu.')}
            </p>
          )}
        </div>
        {r.keywords.missing.length > 0 && (
          <div>
            <b className="small">{t('Brakujące ({n})', { n: r.keywords.missing.length })}</b>
            <div className="chips" style={{ marginTop: 6 }}>
              {r.keywords.missing.map((k) => {
                const known = inProfile(k.term);
                return (
                  <button
                    key={k.term}
                    type="button"
                    className={`badge badge-btn ${known ? 'good' : k.importance === 'must' ? 'bad' : 'warn'}`}
                    onClick={() => toggle(`kw:${k.term}`)}
                    aria-expanded={open === `kw:${k.term}`}
                    title={known ? t('Zapisane w profilu - kliknij, żeby zmienić') : t('Kliknij, jeśli to znasz')}
                  >
                    {known ? '✓' : '✕'} {k.term}{' '}
                    <span className="faint">({known ? t('w profilu') : k.importance === 'must' ? t('wymagane') : t('mile widziane')})</span>
                  </button>
                );
              })}
            </div>
            {openKeyword && (
              <FactForm
                key={openKeyword.term}
                question={t('Gdzie i jak używasz: {term}?', { term: openKeyword.term })}
                placeholder={t('Np. projekt na studiach, staż albo kurs i co było Twoim zadaniem.')}
                onSave={(answer) => addFact('kw', openKeyword.term, answer)}
                onCancel={() => setOpen(null)}
              />
            )}
            <p className="faint" style={{ marginTop: 6 }}>
              {t('Kliknij słowo, które znasz, i napisz krótko, gdzie tego używasz. Odpowiedź trafi do profilu, a „Popraw automatycznie” doda je do CV. Czego nie znasz, nie dopisuj.')}
            </p>
          </div>
        )}
        {savedNote('kw')}
        {r.keywords.stuffing.length > 0 && (
          <div className="callout warn small">{t('Za dużo powtórzeń (wygląda na upychanie słów): {terms}.', { terms: r.keywords.stuffing.join(', ') })}</div>
        )}
      </div>

      <div className="card stack">
        <h2>{t('Format i czytelność dla ATS')}</h2>
        <p className="muted small">{t('Strony: {n}. Kontrole na tekście odczytanym z gotowego pliku PDF.', { n: r.format.pages })}</p>
        <ul className="check-list">
          {r.format.checks.map((c) => (
            <li key={c.name}>
              <span className={`ic ${c.ok ? 'ok-ic' : 'bad-ic'}`}>{c.ok ? '✓' : '✕'}</span>
              <span>
                <b>{c.name}</b> - <span className="muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {review && (
        <>
          <div className="card stack">
            <h2>{t('Ocena AI-rekrutera')}</h2>
            {review.criteria.map((c) => (
              <div key={c.key} className="meter">
                <div className="row">
                  <b>{CRITERIA[c.key] ?? c.key}</b>
                  <span>
                    <b>{c.score}</b>
                    <span className="faint">/10</span>
                  </span>
                </div>
                <div className="bar">
                  <div style={{ width: `${c.score * 10}%`, background: scoreColor(c.score * 10) }} />
                </div>
                <span className="small muted">{c.comment}</span>
              </div>
            ))}
          </div>

          <div className="grid2">
            <div className="card">
              <h3>{t('Mocne strony')}</h3>
              <ul className="check-list" style={{ marginTop: 10 }}>
                {review.strengths.map((s, i) => (
                  <li key={i}><span className="ic ok-ic">+</span>{s}</li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>{t('Słabe strony')}</h3>
              <ul className="check-list" style={{ marginTop: 10 }}>
                {review.weaknesses.map((s, i) => (
                  <li key={i}><span className="ic bad-ic">-</span>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card stack">
            <h2>{t('Proponowane poprawki')}</h2>
            {review.fixes.map((f, i) => {
              const question = fixQuestion(f);
              const known = f.needsUserInput && inProfile(question);
              return (
                <div key={i} className="fix">
                  <div className="row between">
                    <span className="badge">{f.section}</span>
                    {f.needsUserInput && (
                      <span className="row" style={{ gap: 6 }}>
                        <span className={`badge ${known ? 'good' : 'warn'}`}>{known ? t('✓ w profilu') : t('wymaga Twoich danych')}</span>
                        <button className="btn sm" onClick={() => toggle(`fix:${i}`)} aria-expanded={open === `fix:${i}`}>
                          {known ? t('Zmień') : t('Uzupełnij')}
                        </button>
                      </span>
                    )}
                  </div>
                  {f.find && (
                    <div className="small">
                      <del>{f.find}</del>
                    </div>
                  )}
                  <div className="small">
                    <ins>{f.replace}</ins>
                  </div>
                  <span className="faint">{f.why}</span>
                  {open === `fix:${i}` && (
                    <FactForm
                      question={question}
                      placeholder={t('Wpisz te dane, np. liczby, skalę albo efekt.')}
                      onSave={(answer) => addFact('fix', question, answer)}
                      onCancel={() => setOpen(null)}
                    />
                  )}
                </div>
              );
            })}
            <p className="faint">
              {t('Poprawki oznaczone „wymaga Twoich danych” potrzebują informacji, których AI nie zna (np. liczb). Kliknij „Uzupełnij”: odpowiedź trafi do profilu i do następnej poprawki.')}
            </p>
            {savedNote('fix')}
          </div>
        </>
      )}
    </div>
  );
}
