import type { AtsReport } from '../../../../shared/schemas';
import { scoreColor } from '../../components/ui';
import { useT } from '../../i18n';

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

export function ReportView({
  report,
  stale,
  onEvaluate,
  onImprove,
  pending,
}: {
  report: AtsReport | null;
  stale: boolean;
  onEvaluate: () => void;
  onImprove: () => void;
  pending: number;
}) {
  const { t } = useT();
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
          <span className="faint">{t('AI wprowadzi poprawki, które nie wymagają nowych informacji, i oceni CV jeszcze raz.')}</span>
          <button className="btn primary" onClick={onImprove} disabled={pending > 0} title={pending > 0 ? t('Najpierw zdecyduj o żółtych sugestiach') : ''}>
            {t('Popraw automatycznie')}
          </button>
        </div>
        {pending > 0 && (
          <p className="faint" style={{ textAlign: 'right' }}>
            {pending === 1 ? t('Najpierw zdecyduj o 1 żółtej sugestii w edytorze.') : t('Najpierw zdecyduj o {n} żółtych sugestiach w edytorze.', { n: pending })}
          </p>
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
              {r.keywords.missing.map((k) => (
                <span key={k.term} className={`badge ${k.importance === 'must' ? 'bad' : 'warn'}`}>
                  ✕ {k.term} <span className="faint">({k.importance === 'must' ? t('wymagane') : t('mile widziane')})</span>
                </span>
              ))}
            </div>
            <p className="faint" style={{ marginTop: 6 }}>
              {t('Jeśli coś z tej listy znasz, dopisz to w profilu albo w edytorze - wtedy CV dostanie te punkty. Jeśli nie znasz, nie dopisuj.')}
            </p>
          </div>
        )}
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
                  <li key={i}><span className="ic bad-ic">–</span>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card stack">
            <h2>{t('Proponowane poprawki')}</h2>
            {review.fixes.map((f, i) => (
              <div key={i} className="fix">
                <div className="row between">
                  <span className="badge">{f.section}</span>
                  {f.needsUserInput && <span className="badge warn">{t('wymaga Twoich danych')}</span>}
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
              </div>
            ))}
            <p className="faint">
              {t('Poprawki oznaczone „wymaga Twoich danych” potrzebują informacji, których AI nie zna (np. liczb). Dopisz je w profilu lub w edytorze.')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
