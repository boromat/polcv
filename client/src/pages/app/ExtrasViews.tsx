import { useEffect, useRef, useState } from 'react';
import type { Application, CourseAdvice, CoverLetter, InterviewPrep } from '../../../../shared/schemas';
import { api } from '../../api';
import { ErrorBox, LazyText } from '../../components/ui';
import { useT } from '../../i18n';

/** Wczytuje zapisany wynik AI. Błąd wczytania nie może wyglądać jak brak wyniku (pusty stan zachęca do płatnego nadpisania). */
function useSaved<T>(has: boolean, load: () => Promise<T | null>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(has);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = data !== null;
  useEffect(() => {
    // Wynik wygenerowany na tej stronie już mamy, nie wczytujemy go drugi raz.
    if (!has || loaded) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [has, loaded, attempt]);
  return { data, setData, loading, error, retry: () => setAttempt((n) => n + 1) };
}

function LoadState({ title, loading, error, retry }: { title: string; loading: boolean; error: string | null; retry: () => void }) {
  const { t } = useT();
  return (
    <div className="card empty">
      <h2>{title}</h2>
      {error ? (
        <>
          <ErrorBox error={t('Nie udało się wczytać zapisanej wersji: {error}', { error })} />
          <button className="btn" onClick={retry}>
            {t('Spróbuj ponownie')}
          </button>
        </>
      ) : (
        loading && <p>{t('Ładowanie…')}</p>
      )}
    </div>
  );
}

export function PostingView({ app }: { app: Application }) {
  const { t } = useT();
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
  // 'wklejony tekst' to zapisana wartość (dane), pozostałe metody to nazwy techniczne (html, json-ld, browser).
  const source = app.fetchMethod === 'wklejony tekst' ? t('wklejony tekst') : app.fetchMethod;
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>{p.title}</h2>
          {app.url && (
            <a href={app.url} target="_blank" rel="noreferrer" className="btn sm">
              {t('Otwórz ogłoszenie')} ↗
            </a>
          )}
        </div>
        <div className="chips">
          {[p.company, p.location, p.workMode, p.seniority, p.industry].filter(Boolean).map((x) => (
            <span key={x} className="badge">{x}</span>
          ))}
          <span className="badge accent">{t('język: {language}', { language: p.language === 'pl' ? t('polski') : t('angielski') })}</span>
          {p.coverLetterRequired && <span className="badge warn">{t('wymaga listu motywacyjnego')}</span>}
        </div>
        <p>{p.summary}</p>
        {p.applicationNotes && <div className="callout info small"><b>{t('Instrukcje dla kandydata:')}</b> {p.applicationNotes}</div>}
      </div>
      <div className="card stack">
        <List title={t('Wymagania obowiązkowe')} items={p.requirementsMust} />
        <List title={t('Mile widziane')} items={p.requirementsNice} />
        <List title={t('Obowiązki')} items={p.responsibilities} />
      </div>
      <div className="card stack">
        <h3>{t('Słowa kluczowe ATS (z synonimami)')}</h3>
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
        <summary>{t('Pobrana treść ogłoszenia (źródło: {source})', { source })}</summary>
        <div className="pre small muted" style={{ marginTop: 10 }}>{app.rawText}</div>
      </details>
    </div>
  );
}

export function InterviewView({ pid, app, run }: { pid: string; app: Application; run: (msg: string, fn: () => Promise<void>, hint?: string) => void }) {
  const { t } = useT();
  const saved = useSaved<InterviewPrep>(app.hasInterviewPrep, () => api.interview(pid, app.id));
  const prep = saved.data;

  const make = () => {
    if (prep && !confirm(t('Przygotować rozmowę od nowa? Obecne pytania i odpowiedzi zostaną zastąpione.'))) return;
    run(
      t('Przygotowuję pytania i odpowiedzi na rozmowę…'),
      async () => saved.setData(await api.makeInterview(pid, app.id)),
      t('Analizuję ogłoszenie, Twoje CV i profil - to potrwa około minuty.'),
    );
  };

  // Kategoria pytania to wartość z ustalonego zbioru (dane), tłumaczymy tylko napis.
  const categories: Record<string, string> = {
    techniczne: t('techniczne'),
    behawioralne: t('behawioralne'),
    'o doświadczenie': t('o doświadczenie'),
    'motywacja i firma': t('motywacja i firma'),
    trudne: t('trudne'),
  };

  if (!prep && (saved.loading || saved.error)) return <LoadState title={t('Przygotowanie do rozmowy')} loading={saved.loading} error={saved.error} retry={saved.retry} />;
  if (!prep) {
    return (
      <div className="card empty">
        <h2>{t('Przygotowanie do rozmowy')}</h2>
        <p style={{ maxWidth: 520 }}>
          {t('Gdy firma zaprosi Cię na rozmowę, kliknij poniżej. AI przygotuje pytania, które najpewniej padną (o wymagania z ogłoszenia, Twoje projekty i sytuacje z pracy), z propozycjami odpowiedzi opartymi na Twoim doświadczeniu, oraz listę tematów do powtórki.')}
        </p>
        <button className="btn primary lg" onClick={make}>
          {t('Przygotuj mnie do rozmowy')}
        </button>
      </div>
    );
  }

  const groups = [...new Set(prep.questions.map((q) => q.category))];
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>{t('Przygotowanie do rozmowy')}</h2>
          <button className="btn sm" onClick={make}>
            {t('Wygeneruj od nowa')}
          </button>
        </div>
        <p>{prep.overview}</p>
      </div>
      {groups.map((g) => (
        <div key={g} className="card stack">
          <h3 style={{ textTransform: 'capitalize' }}>{t('Pytania: {category}', { category: categories[g] ?? g })}</h3>
          {prep.questions
            .filter((q) => q.category === g)
            .map((q, i) => (
              <details key={i} className="qa">
                <summary>{q.question}</summary>
                <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                  <span className="faint">{t('Co chcą sprawdzić:')} {q.whyAsked}</span>
                  <div className="callout info small pre">{q.suggestedAnswer}</div>
                  {q.tips && <span className="small">💡 {q.tips}</span>}
                </div>
              </details>
            ))}
        </div>
      ))}
      <div className="grid2">
        <div className="card">
          <h3>{t('Tematy do powtórki')}</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            {prep.topicsToReview.map((x, i) => (
              <div key={i}>
                <b>{x.topic}</b>
                <div className="small muted">{x.why}</div>
                <div className="small">→ {x.howToPrepare}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>{t('Twoje słabe punkty i jak o nich mówić')}</h3>
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
        <h3>{t('Pytania, które warto zadać pracodawcy')}</h3>
        <ul style={{ margin: '10px 0 0', paddingLeft: 20 }}>
          {prep.questionsToAsk.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Wyszukiwanie kursu: AI nie podaje linków (mogłoby je zmyślić), więc link buduje program. */
const courseSearchUrl = (name: string, provider: string) => `https://www.google.com/search?q=${encodeURIComponent(`${name} ${provider}`.trim())}`;

export function CoursesView({ pid, app, run }: { pid: string; app: Application; run: (msg: string, fn: () => Promise<void>, hint?: string) => void }) {
  const { t } = useT();
  const saved = useSaved<CourseAdvice>(!!app.hasCourses, () => api.courses(pid, app.id));
  const advice = saved.data;

  const make = () => {
    if (advice && !confirm(t('Przygotować propozycje od nowa? Obecna lista zostanie zastąpiona.'))) return;
    run(
      t('Szukam kursów i certyfikatów pod to ogłoszenie…'),
      async () => saved.setData(await api.makeCourses(pid, app.id)),
      t('Porównuję wymagania z ogłoszenia z Twoim profilem - to zwykle kilkanaście sekund.'),
    );
  };

  // Koszt i rodzaj to wartości z ustalonego zbioru (dane), tłumaczymy tylko napis.
  const costs: Record<string, string> = { bezpłatny: t('bezpłatny'), płatny: t('płatny'), 'częściowo płatny': t('częściowo płatny') };
  const kinds: Record<string, string> = { kurs: t('kurs'), certyfikat: t('certyfikat') };

  if (!advice && (saved.loading || saved.error)) return <LoadState title={t('Kursy i certyfikaty')} loading={saved.loading} error={saved.error} retry={saved.retry} />;
  if (!advice) {
    return (
      <div className="card empty">
        <h2>{t('Kursy i certyfikaty')}</h2>
        <p style={{ maxWidth: 520 }}>
          {t('AI porówna wymagania z ogłoszenia z Twoim profilem i zaproponuje kursy i certyfikaty, które najbardziej pomogą w tej rekrutacji: najpierw te, które uzupełniają wymagania obowiązkowe.')}
        </p>
        <button className="btn primary lg" onClick={make}>
          {t('Zaproponuj kursy i certyfikaty')}
        </button>
      </div>
    );
  }

  const ordered = [...advice.items].sort((a, b) => Number(b.importance === 'must') - Number(a.importance === 'must'));
  return (
    <div className="stack lg">
      <div className="card stack">
        <div className="row between">
          <h2>{t('Kursy i certyfikaty')}</h2>
          <button className="btn sm" onClick={make}>
            {t('Wygeneruj od nowa')}
          </button>
        </div>
        <p>{advice.overview}</p>
      </div>
      {ordered.map((c, i) => (
        <div key={i} className="card stack" style={{ gap: 8 }}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 2 }}>
              <b>{c.name}</b>
              {c.provider && <span className="faint">{c.provider}</span>}
            </div>
            <a href={courseSearchUrl(c.name, c.provider)} target="_blank" rel="noreferrer" className="small" style={{ whiteSpace: 'nowrap' }}>
              {t('Szukaj')} ↗
            </a>
          </div>
          <div className="chips">
            <span className={`badge ${c.importance === 'must' ? 'bad' : 'warn'}`}>{c.importance === 'must' ? t('wymagane') : t('mile widziane')}</span>
            <span className="badge">{kinds[c.kind] ?? c.kind}</span>
            <span className={`badge ${c.cost === 'bezpłatny' ? 'good' : ''}`}>{costs[c.cost] ?? c.cost}</span>
            {c.time && <span className="badge">{c.time}</span>}
          </div>
          <p className="small">{c.why}</p>
          {c.covers.length > 0 && (
            <span className="faint small">
              {t('Pokrywa:')} {c.covers.join(', ')}
            </span>
          )}
        </div>
      ))}
      {advice.alreadyCovered.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <h3>{t('Tego nie musisz uzupełniać')}</h3>
          <div className="chips">
            {advice.alreadyCovered.map((x, i) => (
              <span key={i} className="badge good">
                ✓ {x}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="faint small">{t('Nazwy, ceny i terminy sprawdź na stronie wydawcy - AI mogło coś pomylić albo kurs mógł się zmienić. Ukończony kurs dopisz w profilu, a kolejne CV go wykorzystają.')}</p>
    </div>
  );
}

export function LetterView({ pid, app, run }: { pid: string; app: Application; run: (msg: string, fn: () => Promise<void>, hint?: string) => void }) {
  const { t } = useT();
  const saved = useSaved<CoverLetter>(app.hasCoverLetter, () => api.letter(pid, app.id));
  const letter = saved.data;
  const [bust, setBust] = useState(String(Date.now()));
  const [saveError, setSaveError] = useState<string | null>(null);
  // Zapisy listu idą po kolei; `failed` = ostatni zapis się nie udał (każdy zapis wysyła cały list, więc kolejny udany to naprawia).
  const chain = useRef(Promise.resolve());
  const failed = useRef(false);

  const save = (l: CoverLetter) => {
    saved.setData(l);
    chain.current = chain.current.then(async () => {
      try {
        await api.saveLetter(pid, app.id, l);
        failed.current = false;
        setSaveError(null);
        setBust(String(Date.now()));
      } catch (e: any) {
        failed.current = true;
        setSaveError(t('Nie udało się zapisać listu: {error}', { error: e.message }));
      }
    });
  };

  const make = () => {
    if (letter && !confirm(t('Napisać list od nowa? Obecna treść listu razem z Twoimi poprawkami zostanie zastąpiona.'))) return;
    run(t('Piszę list motywacyjny…'), async () => {
      // Zapis w toku nie może nadpisać nowego listu starą treścią.
      await chain.current;
      saved.setData(await api.makeLetter(pid, app.id));
      failed.current = false;
      setSaveError(null);
      setBust(String(Date.now()));
    });
  };

  // PDF dopiero po zapisaniu ostatnich poprawek (pole zatwierdza się przy kliknięciu przycisku).
  const download = async () => {
    await chain.current;
    if (failed.current && letter) {
      save(letter);
      await chain.current;
    }
    if (!failed.current) window.location.href = api.letterPdfUrl(pid, app.id, true);
  };

  if (!letter && (saved.loading || saved.error)) return <LoadState title={t('List motywacyjny')} loading={saved.loading} error={saved.error} retry={saved.retry} />;
  if (!letter) {
    return (
      <div className="card empty">
        <h2>{t('List motywacyjny')}</h2>
        <p style={{ maxWidth: 560 }}>
          {t('To krótki list (do 1 strony) wysyłany razem z CV: piszesz w nim,')} <b>{t('dlaczego chcesz pracować właśnie w tej firmie')}</b> {t('i')}{' '}
          <b>{t('dlaczego pasujesz do stanowiska')}</b>
          {t(', podając 2-3 konkretne przykłady. Część ogłoszeń go wymaga, w innych pomaga się wyróżnić.')}
        </p>
        {app.posting?.coverLetterRequired && <div className="callout warn">{t('To ogłoszenie wymaga listu motywacyjnego.')}</div>}
        <button className="btn primary lg" onClick={make}>
          {t('Napisz list motywacyjny')}
        </button>
      </div>
    );
  }

  return (
    <div className="editor-split">
      <div className="editor-form">
        <div className="card stack">
          <div className="row between">
            <h3>{t('Treść listu')}</h3>
            <button className="btn sm" onClick={make}>
              {t('Napisz od nowa')}
            </button>
          </div>
          <LazyText value={letter.greeting} onCommit={(greeting) => save({ ...letter, greeting })} />
          {letter.paragraphs.map((p, i) => (
            <LazyText key={i} multiline rows={6} value={p} onCommit={(text) => save({ ...letter, paragraphs: letter.paragraphs.map((x, j) => (j === i ? text : x)) })} />
          ))}
          <LazyText value={letter.closing} onCommit={(closing) => save({ ...letter, closing })} />
        </div>
        <ErrorBox error={saveError} onClose={() => setSaveError(null)} />
        <button className="btn primary" onClick={download}>
          {t('Pobierz list jako PDF')}
        </button>
      </div>
      <div className="preview-pane">
        <iframe className="preview-frame" title={t('Podgląd listu')} src={api.letterPreviewUrl(pid, app.id, bust)} />
      </div>
    </div>
  );
}
