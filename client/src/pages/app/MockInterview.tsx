import { Fragment, useEffect, useState } from 'react';
import type { Application, MockInterview, MockInterviewView, MockSavedGrade, MockSummary } from '../../../../shared/schemas';
import { api } from '../../api';
import { ErrorBox, usd } from '../../components/ui';
import { useT } from '../../i18n';

type Run = (msg: string, fn: () => Promise<void>, hint?: string) => void;

/** Miejsca do uzupełnienia w mocniejszej wersji ("[ile dokumentów tygodniowo]") wyróżnione na żółto. */
function WithGaps({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]{1,100}\])/g);
  return (
    <>
      {parts.map((p, i) => (/^\[.*\]$/.test(p) ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function GradeCard({ g, onAddFact }: { g: MockSavedGrade; onAddFact: (index: number) => void }) {
  const { t } = useT();
  const criteria: [keyof MockSavedGrade['criteria'], string][] = [
    ['concrete', t('Konkret i liczby')],
    ['fit', t('Dopasowanie do ogłoszenia')],
    ['structure', t('Struktura')],
    ['correctness', t('Poprawność')],
    ['length', t('Długość')],
  ];
  return (
    <div className="card stack mock-grade" aria-label={t('Ocena odpowiedzi')}>
      <div className="row between">
        <h3>{t('Ocena: {score}/5', { score: g.score })}</h3>
        <span className="small faint">{criteria.map(([k, label]) => `${label} ${g.criteria[k]}`).join(' · ')}</span>
      </div>
      {g.good.length > 0 && (
        <div className="small">
          <b>{t('Dobre:')}</b> {g.good.join(' ')}
        </div>
      )}
      {g.missing.length > 0 && (
        <div className="small">
          <b>{t('Zabrakło:')}</b> {g.missing.join(' ')}
        </div>
      )}
      {g.stronger ? (
        <div className="callout info small pre">
          <b>{t('Mocniejsza wersja:')}</b> <WithGaps text={g.stronger} />
        </div>
      ) : (
        <div className="callout warn small">{t('Mocniejszej wersji nie udało się przygotować tylko z Twoich faktów. Dopisz sam konkretny przykład i jego efekt.')}</div>
      )}
      {g.placeholders.length > 0 && <p className="faint small">{t('Fragmenty w nawiasach uzupełnij własnymi danymi: AI ich nie zgaduje.')}</p>}
      {g.factualErrors.map((e, i) => (
        <div key={i} className="callout warn small">
          <b>{t('Błąd merytoryczny:')}</b> {e.claim}
          <div>→ {e.correction}</div>
          <div className="faint">{t('Gdzie to sprawdzić: {where}', { where: e.whereToCheck })}</div>
        </div>
      ))}
      {g.companyChecks.length > 0 && (
        <div className="small">
          <b>{t('Sprawdź przed rozmową:')}</b> {g.companyChecks.join('; ')}
        </div>
      )}
      {g.facts.map((f, i) => (
        <div key={i} className="row small" style={{ gap: 8 }}>
          <span>
            {t('Nowy fakt:')} <b>{f.topic}</b>: {f.answer}
          </span>
          {f.added ? (
            <span className="badge good">{t('dopisano do profilu')}</span>
          ) : (
            <button className="btn sm" onClick={() => onAddFact(i)}>
              {t('Dopisz do profilu')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ s }: { s: MockSummary }) {
  const { t } = useT();
  return (
    <div className="card stack">
      <h3>{s.average === null ? t('Podsumowanie rozmowy') : t('Podsumowanie: średnio {avg}/5', { avg: s.average })}</h3>
      <p className="small faint">{t('Odpowiedzi: {answered}, pominięte: {skipped}, koszt: {cost}', { answered: s.answered, skipped: s.skipped, cost: usd(s.costUsd) })}</p>
      <div className="grid2">
        <div>
          <b>{t('Mocne strony')}</b>
          <ul>{s.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
        <div>
          <b>{t('Do poprawy przed prawdziwą rozmową')}</b>
          <ul>{s.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      </div>
      {s.placeholders.length > 0 && (
        <div>
          <b>{t('Do przygotowania (miejsca w nawiasach)')}</b>
          <ul>
            {s.placeholders.map((p, i) => (
              <li key={i}>
                {p.question}: {p.items.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.topicsToReview.length > 0 && (
        <div>
          <b>{t('Tematy do powtórki')}</b>
          <ul>{s.topicsToReview.map((x, i) => <li key={i}>{x.topic}: {x.why}</li>)}</ul>
        </div>
      )}
      <div className="small">
        <b>{t('Twoje pytania do firmy:')}</b> {s.candidateQuestions}
      </div>
    </div>
  );
}

/** Próbna rozmowa w zakładce Rozmowa: rekruter pyta po jednym pytaniu, a każda odpowiedź dostaje ocenę. */
export function MockInterviewCard({ pid, app, run }: { pid: string; app: Application; run: Run }) {
  const { t } = useT();
  const [view, setView] = useState<MockInterviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    api.mock(pid, app.id).then(setView).catch((e) => setError(e.message));
  }, [pid, app.id]);

  // Po błędzie AI odpowiedź kandydata jest już zapisana: wczytujemy stan, żeby było widać, co ponowić.
  const act = (message: string, fn: () => Promise<MockInterviewView>, after?: () => void) =>
    run(message, async () => {
      try {
        setView(await fn());
        after?.();
      } catch (e) {
        setView(await api.mock(pid, app.id).catch(() => view));
        throw e;
      }
    });

  /** `restart`: nowa rozmowa zamiast bieżącej; pytamy tylko wtedy, gdy bieżąca jeszcze trwa. */
  const start = (restart: boolean) => {
    if (restart && view?.current?.status === 'active' && !confirm(t('Zacząć próbną rozmowę od nowa? Obecna rozmowa zostanie usunięta, podsumowania zakończonych podejść zostają.'))) return;
    act(t('Rekruter układa pytania pod to ogłoszenie…'), () => api.startMock(pid, app.id, restart));
  };
  const send = () => act(t('Rekruter ocenia odpowiedź…'), () => api.answerMock(pid, app.id, answer), () => setAnswer(''));
  const retry = () => act(t('Rekruter ocenia odpowiedź…'), () => api.answerMock(pid, app.id, ''));
  const skip = () => act(t('Następne pytanie…'), () => api.skipMock(pid, app.id));
  const finish = () => {
    if (!confirm(t('Zakończyć rozmowę? Dostaniesz podsumowanie tego, na co już odpowiedziano.'))) return;
    act(t('Podsumowuję rozmowę…'), () => api.finishMock(pid, app.id));
  };
  const addFact = (answerId: string, index: number) => act(t('Dopisuję fakt do profilu…'), () => api.addMockFact(pid, app.id, answerId, index));

  if (error) return <ErrorBox error={error} onClose={() => setError(null)} />;
  if (!view) return null;
  const m: MockInterview | null = view.current;
  const active = m?.status === 'active';
  const last = m?.turns.at(-1);
  const waiting = active && last?.role === 'interviewer';

  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>{t('Próbna rozmowa')}</h2>
          <div className="row" style={{ gap: 6 }}>
            {active ? (
              <>
                <button className="btn sm" onClick={finish}>{t('Zakończ rozmowę')}</button>
                <button className="btn ghost sm" onClick={() => start(true)}>{t('Zacznij od nowa')}</button>
              </>
            ) : (
              <button className="btn primary sm" onClick={() => start(!!m)}>
                {view.history.length ? t('Zacznij kolejne podejście') : t('Zacznij próbną rozmowę')}
              </button>
            )}
          </div>
        </div>
        <p className="small muted" style={{ maxWidth: 640 }}>
          {t('AI-rekruter zadaje 6-8 pytań pod to ogłoszenie, po jednym. Po każdej odpowiedzi dostajesz ocenę i mocniejszą wersję opartą tylko na Twoim profilu, CV i tym, co powiesz. O firmie rekruter wie tylko to, co jest w ogłoszeniu.')}
        </p>
        {m && <p className="small faint">{t('Koszt tej rozmowy: {cost}', { cost: usd(view.costUsd) })}</p>}
        {m && m.plan.companyChecks.length > 0 && (
          <div className="small">
            <b>{t('Sprawdź przed rozmową:')}</b> {m.plan.companyChecks.join('; ')}
          </div>
        )}
        {m && m.probes.length > 0 && (
          <details className="small">
            <summary className="muted">{t('O co rekruter może dopytać ({n})', { n: m.probes.length })}</summary>
            <ul>{m.probes.map((p, i) => <li key={i}>{p.detail}</li>)}</ul>
          </details>
        )}
      </div>

      {m && (
        <div className="stack">
          {m.turns.map((turn) => {
            const grade = m.grades.find((g) => g.answerId === turn.id);
            return (
              <Fragment key={turn.id}>
                <div className={`mock-turn ${turn.role}`}>
                  <b>{turn.role === 'interviewer' ? t('Rekruter:') : t('Ty:')}</b>{' '}
                  {turn.kind === 'skip' ? <i>{t('pytanie pominięte')}</i> : <span className="pre">{turn.content}</span>}
                </div>
                {grade && <GradeCard g={grade} onAddFact={(i) => addFact(grade.answerId, i)} />}
              </Fragment>
            );
          })}
        </div>
      )}

      {active && waiting && (
        <div className="card stack">
          <label className="small muted" htmlFor="mock-answer">{t('Twoja odpowiedź')}</label>
          <textarea id="mock-answer" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t('Odpowiedz tak, jak na prawdziwej rozmowie.')} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn primary" disabled={!answer.trim()} onClick={send}>{t('Wyślij odpowiedź')}</button>
            <button className="btn ghost" onClick={skip}>{t('Pomiń pytanie')}</button>
          </div>
        </div>
      )}
      {active && !waiting && (
        <div className="callout warn small">
          {t('Odpowiedź jest zapisana, ale ocena się nie udała.')}{' '}
          <button className="btn sm" onClick={retry}>{t('Oceń ponownie')}</button>
        </div>
      )}

      {m?.summary && <SummaryCard s={m.summary} />}

      {view.history.length > 0 && (
        <div className="card stack">
          <h3>{t('Poprzednie podejścia')}</h3>
          <ul className="small">
            {view.history.map((h) => (
              <li key={h.interviewId}>
                {new Date(h.at).toLocaleDateString()}: {h.average === null ? t('bez ocenionych odpowiedzi') : t('średnio {avg}/5', { avg: h.average })} ·{' '}
                {t('odpowiedzi: {n}', { n: h.answered })} · {usd(h.costUsd)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
