import type { AtsReport } from '../../../../shared/schemas';
import { scoreColor } from '../../components/ui';

const CRITERIA: Record<string, string> = {
  must_have_match: 'Spełnienie wymagań obowiązkowych',
  achievements: 'Konkretne osiągnięcia i efekty',
  summary_fit: 'Dopasowanie nagłówka i podsumowania',
  clarity: 'Czytelność i zwięzłość',
  red_flags: 'Brak czerwonych flag',
};

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
  if (!report) {
    return (
      <div className="card empty">
        <h2>Ta wersja nie ma jeszcze oceny</h2>
        <button className="btn primary" onClick={onEvaluate}>
          Oceń CV
        </button>
      </div>
    );
  }
  const r = report;
  const review = r.ai?.review;
  const verdictTone = review ? (review.wouldInterview === 'tak' || review.wouldInterview === 'raczej tak' ? 'good' : 'bad') : '';

  return (
    <div className="stack lg">
      {stale && (
        <div className="callout warn row between">
          <span>CV zmieniło się od ostatniej oceny - wynik może być nieaktualny.</span>
          <button className="btn sm" onClick={onEvaluate}>
            Oceń ponownie
          </button>
        </div>
      )}

      <div className="card">
        <div className="grid2" style={{ alignItems: 'center' }}>
          <div className="score-big">
            <div className="score-ring" style={{ ['--v' as any]: r.total, ['--c' as any]: scoreColor(r.total) }}>
              <div>{r.total}</div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h2>Ocena łączna</h2>
              {!r.ai && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>niepełna - bez oceny AI</span>}
              {review && (
                <span className={`badge ${verdictTone}`} style={{ alignSelf: 'flex-start' }}>
                  AI-rekruter: {review.wouldInterview === 'tak' || review.wouldInterview === 'raczej tak' ? 'zaprosiłby na rozmowę' : 'raczej nie zaprosiłby'} ({review.wouldInterview})
                </span>
              )}
              {review && <p className="small">{review.verdict}</p>}
            </div>
          </div>
          <div className="stack">
            <Meter label="Słowa kluczowe ATS" value={r.keywords.score} max={r.keywords.max} hint="Czy CV zawiera słowa, których szuka filtr ATS." />
            <Meter label="Format i czytelność dla ATS" value={r.format.score} max={r.format.max} hint="Sprawdzone na gotowym PDF - tak, jak czyta go ATS." />
            {r.ai ? (
              <Meter label="Ocena AI-rekrutera" value={r.ai.score} max={r.ai.max} hint="Jak oceniłby Cię automatyczny screening AI." />
            ) : (
              <div className="callout warn small">Ocena AI nie powiodła się: {r.aiError}</div>
            )}
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <span className="faint">AI wprowadzi poprawki, które nie wymagają nowych informacji, i oceni CV jeszcze raz.</span>
          <button className="btn primary" onClick={onImprove} disabled={pending > 0} title={pending > 0 ? 'Najpierw zdecyduj o żółtych sugestiach' : ''}>
            Popraw automatycznie
          </button>
        </div>
        {pending > 0 && <p className="faint" style={{ textAlign: 'right' }}>Najpierw zdecyduj o {pending} żółtych sugestiach w edytorze.</p>}
      </div>

      <div className="card stack">
        <h2>Słowa kluczowe z ogłoszenia</h2>
        <p className="muted small">
          Filtr ATS szuka w CV konkretnych słów z ogłoszenia. Wymagane liczą się 3× mocniej niż mile widziane. Polskie odmiany i skróty są rozpoznawane.
        </p>
        <div>
          <b className="small">Znalezione ({r.keywords.matched.length})</b>
          <div className="chips" style={{ marginTop: 6 }}>
            {r.keywords.matched.map((k) => (
              <span key={k.term} className="badge good" title={`Znalezione jako „${k.foundAs}”`}>
                ✓ {k.term} {k.count > 1 && <span className="faint">×{k.count}</span>}
              </span>
            ))}
          </div>
        </div>
        {r.keywords.missing.length > 0 && (
          <div>
            <b className="small">Brakujące ({r.keywords.missing.length})</b>
            <div className="chips" style={{ marginTop: 6 }}>
              {r.keywords.missing.map((k) => (
                <span key={k.term} className={`badge ${k.importance === 'must' ? 'bad' : 'warn'}`}>
                  ✕ {k.term} <span className="faint">({k.importance === 'must' ? 'wymagane' : 'mile widziane'})</span>
                </span>
              ))}
            </div>
            <p className="faint" style={{ marginTop: 6 }}>
              Jeśli coś z tej listy znasz, dopisz to w profilu albo w edytorze - wtedy CV dostanie te punkty. Jeśli nie znasz, nie dopisuj.
            </p>
          </div>
        )}
        {r.keywords.stuffing.length > 0 && (
          <div className="callout warn small">Za dużo powtórzeń (wygląda na upychanie słów): {r.keywords.stuffing.join(', ')}.</div>
        )}
      </div>

      <div className="card stack">
        <h2>Format i czytelność dla ATS</h2>
        <p className="muted small">Strony: {r.format.pages}. Kontrole na tekście odczytanym z gotowego pliku PDF.</p>
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
            <h2>Ocena AI-rekrutera</h2>
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
              <h3>Mocne strony</h3>
              <ul className="check-list" style={{ marginTop: 10 }}>
                {review.strengths.map((s, i) => (
                  <li key={i}><span className="ic ok-ic">+</span>{s}</li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>Słabe strony</h3>
              <ul className="check-list" style={{ marginTop: 10 }}>
                {review.weaknesses.map((s, i) => (
                  <li key={i}><span className="ic bad-ic">–</span>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card stack">
            <h2>Proponowane poprawki</h2>
            {review.fixes.map((f, i) => (
              <div key={i} className="fix">
                <div className="row between">
                  <span className="badge">{f.section}</span>
                  {f.needsUserInput && <span className="badge warn">wymaga Twoich danych</span>}
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
              Poprawki oznaczone „wymaga Twoich danych” potrzebują informacji, których AI nie zna (np. liczb). Dopisz je w profilu lub w edytorze.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
