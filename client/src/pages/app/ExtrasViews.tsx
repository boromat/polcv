import { useEffect, useState } from 'react';
import type { Application, CoverLetter, InterviewPrep } from '../../../../shared/schemas';
import { api } from '../../api';
import { LazyText } from '../../components/ui';

export function PostingView({ app }: { app: Application }) {
  const p = app.posting!;
  const List = ({ title, items }: { title: string; items: string[] }) =>
    items.length ? (
      <div>
        <h3>{title}</h3>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>{p.title}</h2>
          {app.url && (
            <a href={app.url} target="_blank" rel="noreferrer" className="btn sm">
              Otwórz ogłoszenie ↗
            </a>
          )}
        </div>
        <div className="chips">
          {[p.company, p.location, p.workMode, p.seniority, p.industry].filter(Boolean).map((x) => (
            <span key={x} className="badge">{x}</span>
          ))}
          <span className="badge accent">język: {p.language === 'pl' ? 'polski' : 'angielski'}</span>
          {p.coverLetterRequired && <span className="badge warn">wymaga listu motywacyjnego</span>}
        </div>
        <p>{p.summary}</p>
        {p.applicationNotes && <div className="callout info small"><b>Instrukcje dla kandydata:</b> {p.applicationNotes}</div>}
      </div>
      <div className="card stack">
        <List title="Wymagania obowiązkowe" items={p.requirementsMust} />
        <List title="Mile widziane" items={p.requirementsNice} />
        <List title="Obowiązki" items={p.responsibilities} />
      </div>
      <div className="card stack">
        <h3>Słowa kluczowe ATS (z synonimami)</h3>
        <div className="stack" style={{ gap: 6 }}>
          {p.keywords.map((k) => (
            <div key={k.term} className="row small">
              <span className={`badge ${k.importance === 'must' ? 'accent' : ''}`}>{k.term}</span>
              <span className="faint">{k.synonyms.join(', ')}</span>
            </div>
          ))}
        </div>
      </div>
      <details className="card">
        <summary>Pobrana treść ogłoszenia (źródło: {app.fetchMethod})</summary>
        <div className="pre small muted" style={{ marginTop: 10 }}>{app.rawText}</div>
      </details>
    </div>
  );
}

export function InterviewView({ pid, app, run }: { pid: string; app: Application; run: (msg: string, fn: () => Promise<void>, hint?: string) => void }) {
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  useEffect(() => {
    if (app.hasInterviewPrep) api.interview(pid, app.id).then(setPrep);
  }, [app.id, app.hasInterviewPrep]);

  const make = () =>
    run('Przygotowuję pytania i odpowiedzi na rozmowę…', async () => setPrep(await api.makeInterview(pid, app.id)), 'Analizuję ogłoszenie, Twoje CV i profil — to potrwa około minuty.');

  if (!prep) {
    return (
      <div className="card empty">
        <h2>Przygotowanie do rozmowy</h2>
        <p style={{ maxWidth: 520 }}>
          Gdy firma zaprosi Cię na rozmowę, kliknij poniżej. AI przygotuje pytania, które najpewniej padną (o wymagania z ogłoszenia, Twoje projekty i sytuacje z pracy),
          z propozycjami odpowiedzi opartymi na Twoim doświadczeniu, oraz listę tematów do powtórki.
        </p>
        <button className="btn primary lg" onClick={make}>
          Przygotuj mnie do rozmowy
        </button>
      </div>
    );
  }

  const groups = [...new Set(prep.questions.map((q) => q.category))];
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>Przygotowanie do rozmowy</h2>
          <button className="btn sm" onClick={make}>
            Wygeneruj od nowa
          </button>
        </div>
        <p>{prep.overview}</p>
      </div>
      {groups.map((g) => (
        <div key={g} className="card stack">
          <h3 style={{ textTransform: 'capitalize' }}>Pytania: {g}</h3>
          {prep.questions
            .filter((q) => q.category === g)
            .map((q, i) => (
              <details key={i} className="qa">
                <summary>{q.question}</summary>
                <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                  <span className="faint">Co chcą sprawdzić: {q.whyAsked}</span>
                  <div className="callout info small pre">{q.suggestedAnswer}</div>
                  {q.tips && <span className="small">💡 {q.tips}</span>}
                </div>
              </details>
            ))}
        </div>
      ))}
      <div className="grid2">
        <div className="card">
          <h3>Tematy do powtórki</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            {prep.topicsToReview.map((t, i) => (
              <div key={i}>
                <b>{t.topic}</b>
                <div className="small muted">{t.why}</div>
                <div className="small">→ {t.howToPrepare}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Twoje słabe punkty i jak o nich mówić</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            {prep.weakSpots.map((w, i) => (
              <div key={i}>
                <b>{w.issue}</b>
                <div className="small">→ {w.howToAddress}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Pytania, które warto zadać pracodawcy</h3>
        <ul style={{ margin: '10px 0 0', paddingLeft: 20 }}>
          {prep.questionsToAsk.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LetterView({ pid, app, run }: { pid: string; app: Application; run: (msg: string, fn: () => Promise<void>, hint?: string) => void }) {
  const [letter, setLetter] = useState<CoverLetter | null>(null);
  const [bust, setBust] = useState(String(Date.now()));
  useEffect(() => {
    if (app.hasCoverLetter) api.letter(pid, app.id).then(setLetter);
  }, [app.id, app.hasCoverLetter]);

  const make = () =>
    run('Piszę list motywacyjny…', async () => {
      setLetter(await api.makeLetter(pid, app.id));
      setBust(String(Date.now()));
    });

  const save = async (l: CoverLetter) => {
    setLetter(l);
    await api.saveLetter(pid, app.id, l);
    setBust(String(Date.now()));
  };

  if (!letter) {
    return (
      <div className="card empty">
        <h2>List motywacyjny</h2>
        <p style={{ maxWidth: 560 }}>
          To krótki list (do 1 strony) wysyłany razem z CV: piszesz w nim, <b>dlaczego chcesz pracować właśnie w tej firmie</b> i <b>dlaczego pasujesz do stanowiska</b>,
          podając 2–3 konkretne przykłady. Część ogłoszeń go wymaga, w innych pomaga się wyróżnić.
        </p>
        {app.posting?.coverLetterRequired && <div className="callout warn">To ogłoszenie wymaga listu motywacyjnego.</div>}
        <button className="btn primary lg" onClick={make}>
          Napisz list motywacyjny
        </button>
      </div>
    );
  }

  return (
    <div className="editor-split">
      <div className="editor-form">
        <div className="card stack">
          <div className="row between">
            <h3>Treść listu</h3>
            <button className="btn sm" onClick={make}>
              Napisz od nowa
            </button>
          </div>
          <LazyText value={letter.greeting} onCommit={(greeting) => save({ ...letter, greeting })} />
          {letter.paragraphs.map((p, i) => (
            <LazyText key={i} multiline rows={6} value={p} onCommit={(t) => save({ ...letter, paragraphs: letter.paragraphs.map((x, j) => (j === i ? t : x)) })} />
          ))}
          <LazyText value={letter.closing} onCommit={(closing) => save({ ...letter, closing })} />
        </div>
        <a className="btn primary" href={api.letterPdfUrl(pid, app.id, true)}>
          Pobierz list jako PDF
        </a>
      </div>
      <div className="preview-pane">
        <iframe className="preview-frame" title="Podgląd listu" src={api.letterPreviewUrl(pid, app.id, bust)} />
      </div>
    </div>
  );
}
