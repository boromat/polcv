import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CvVersion, GapAnswer, ImproveResult, TemplateId } from '../../../shared/schemas';
import { api, type AppDetail, type VersionDetail } from '../api';
import { useApp } from '../ctx';
import { plFew, translate, useT } from '../i18n';
import { Busy, downloadFile, ErrorBox, fmtDate, GoworkLink, newsLabel, openWhenReady, ScoreBadge, STATUS_LABELS, STATUSES, usd } from '../components/ui';
import { GapStep } from './app/GapStep';
import { CvEditor, pendingCount } from './app/CvEditor';
import { ReportView } from './app/ReportView';
import { CoursesView, InterviewView, LetterView, PostingView } from './app/ExtrasViews';

type Tab = 'cv' | 'report' | 'posting' | 'interview' | 'letter' | 'courses';
type Patch = Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>;

/** Porównanie odpowiedzi bez względu na kolejność kluczy w obiektach. */
const answersKey = (list: GapAnswer[]) => JSON.stringify(list.map((a) => [a.questionId, a.has, a.answer]));

export function ApplicationPage() {
  const { aid = '' } = useParams();
  const { current } = useApp();
  const { t } = useT();
  const pid = current!.id;
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [vd, setVd] = useState<VersionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('cv');
  const [busy, setBusy] = useState<{ message: string; hint?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bust, setBust] = useState(String(Date.now()));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const gapStarted = useRef(false);
  const saveChain = useRef(Promise.resolve());
  // Pola CV, których zapis się nie udał (do ponowienia przed akcją AI albo PDF).
  const unsaved = useRef<{ v: number; patch: Patch; error: string } | null>(null);
  // Ostatnio zapisane odpowiedzi na pytania (null = jeszcze nic nie wysłano z tej strony).
  const savedAnswers = useRef<string | null>(null);

  const loadDetail = useCallback(async () => {
    const d = await api.application(pid, aid);
    setDetail(d);
    return d;
  }, [pid, aid]);

  const loadVersion = useCallback(
    async (v: number) => {
      if (!v) return setVd(null);
      setVd(await api.version(pid, aid, v));
      setBust(String(Date.now()));
    },
    [pid, aid],
  );

  // Zmiany CV zapisujemy po kolei; nieudany zapis zostaje w `unsaved` do ponowienia.
  const queueSave = useCallback(
    (v: number, p: Patch) => {
      saveChain.current = saveChain.current.then(async () => {
        try {
          const { profileUpdates } = await api.saveVersion(pid, aid, v, p);
          if (profileUpdates?.length) setNotice(translate('Zapisano też w profilu: {what}.', { what: profileUpdates.join(', ') }));
        } catch (e: any) {
          const prev = unsaved.current?.v === v ? unsaved.current.patch : {};
          unsaved.current = { v, patch: { ...prev, ...p }, error: e.message };
          setError(e.message);
          return;
        }
        if (unsaved.current?.v === v) {
          const rest: Patch = { ...unsaved.current.patch };
          for (const k of Object.keys(p) as (keyof Patch)[]) delete rest[k];
          unsaved.current = Object.keys(rest).length ? { ...unsaved.current, patch: rest } : null;
        }
        try {
          const fresh = await api.version(pid, aid, v);
          // Lokalna treść CV jest źródłem prawdy podczas edycji; z serwera bierzemy tylko wyliczenia.
          setVd((prev) => (prev && prev.cv.version === v ? { ...fresh, cv: prev.cv, pending: pendingCount(prev.cv) } : prev));
          setBust(String(Date.now()));
        } catch (e: any) {
          setError(e.message);
        }
      });
    },
    [pid, aid],
  );

  /** Czeka na zapis edycji (pole zatwierdza się dopiero przy kliknięciu przycisku), żeby AI i PDF nie czytały starszej wersji z dysku. */
  const flushSaves = useCallback(async () => {
    await saveChain.current;
    if (unsaved.current) {
      queueSave(unsaved.current.v, unsaved.current.patch);
      await saveChain.current;
    }
    if (unsaved.current) throw new Error(translate('Nie udało się zapisać zmian w CV: {error}', { error: unsaved.current.error }));
  }, [queueSave]);

  const run = useCallback(async (message: string, fn: (step: (m: string, hint?: string) => void) => Promise<void>, hint?: string) => {
    setError(null);
    setNotice(null);
    setBusy({ message, hint });
    try {
      await flushSaves();
      await fn((m, h) => setBusy({ message: m, hint: h }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [flushSaves]);

  useEffect(() => {
    loadDetail()
      .then((d) => loadVersion(d.application.currentVersion))
      .catch((e) => setError(e.message));
  }, [loadDetail, loadVersion]);

  // Po utworzeniu aplikacji od razu porównujemy ogłoszenie z profilem.
  useEffect(() => {
    const a = detail?.application;
    if (!a || !a.posting || a.gap || a.currentVersion || gapStarted.current) return;
    gapStarted.current = true;
    run(t('Porównuję ogłoszenie z Twoim profilem…'), async () => {
      await api.gap(pid, aid);
      await loadDetail();
    });
  }, [detail, pid, aid, run, loadDetail, t]);

  // Wiadomości z podglądu: kliknięcie żółtej sugestii i liczba stron.
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'cv-suggested-click') {
        setFocusId(e.data.id);
        setTab('cv');
      } else if (e.data?.type === 'cv-pages') setPages(e.data.pages);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  if (!detail) return <div className="container">{error ? <ErrorBox error={error} /> : t('Ładowanie…')}</div>;
  const app = detail.application;

  const evaluateAndReload = async (v: number, step: (m: string, hint?: string) => void) => {
    step(t('Oceniam CV jak ATS i AI-rekruter…'), t('Tworzę PDF, odczytuję go jak system ATS i daję do oceny AI.'));
    await api.evaluate(pid, aid, v);
    await loadDetail();
    await loadVersion(v);
  };

  const generate = (answers: GapAnswer[], opts: { language?: 'pl' | 'en'; template: TemplateId }) => {
    // Odpowiedzi wysyłamy tylko po zmianie: ponowna próba po błędzie nie dopisuje do profilu tych samych faktów.
    const key = answersKey(answers);
    const send = key !== (savedAnswers.current ?? answersKey(app.gap?.answers ?? []));
    const writing = t('Piszę CV pod to ogłoszenie…');
    const writingHint = t('Wybieram z profilu to, co pasuje, i piszę językiem ogłoszenia. To zwykle 30–60 sekund.');
    return run(send ? t('Zapisuję odpowiedzi w profilu…') : writing, async (step) => {
      if (send) {
        await api.answers(pid, aid, answers);
        savedAnswers.current = key;
      }
      step(writing, writingHint);
      const cv = await api.generate(pid, aid, opts);
      await evaluateAndReload(cv.version, step);
      setTab('cv');
    }, send ? undefined : writingHint);
  };

  const regenerate = () => {
    if (!confirm(t('Napisać CV od nowa? AI napisze całe CV jeszcze raz, więc ręczne poprawki z obecnej wersji do niego nie przejdą (ta wersja zostanie na liście wersji). Nowe rzeczy z profilu z zachowaniem poprawek dopisuje „Synchronizuj z profilem”.'))) return;
    run(t('Piszę CV od nowa…'), async (step) => {
      const cv = await api.generate(pid, aid, { template: vd?.cv.template });
      await evaluateAndReload(cv.version, step);
    });
  };

  /** Komunikat po poprawie: wyniki ze świeżej oceny serwera, przed i po. */
  const improveNotice = (r: ImproveResult) => {
    if (r.kept === 'none') return r.message;
    const { before: from, after: to } = r;
    let text: string;
    if (r.kept === 'new') text = from != null && to != null ? t('Nowa wersja CV: wynik {from} → {to}.', { from, to }) : t('Gotowe - powstała nowa wersja CV.');
    else if (from != null && to != null) text = t('Nowa wersja wyszła gorzej ({to} < {from}) - zostawiam poprzednią. Możesz ją podejrzeć w wyborze wersji.', { from, to });
    else if (from != null) text = t('Nowa wersja nie dostała pełnej oceny AI - zostawiam poprzednią ({from}). Możesz ją podejrzeć w wyborze wersji.', { from });
    else text = t('Nowa wersja nie wypadła lepiej - zostawiam poprzednią. Możesz ją podejrzeć w wyborze wersji.');
    if (!r.needsInput.length) return text;
    return [text, t('Żeby podnieść wynik bardziej, możesz dopisać w profilu:'), ...r.needsInput.map((q) => `- ${q}`)].join('\n');
  };

  const improve = () =>
    run(
      t('Poprawiam CV na podstawie raportu…'),
      async () => {
        // Nowa wersja mogła się zapisać, nawet jeśli jej ocena się nie udała - lista wersji ma ją pokazać.
        const res = await api.improve(pid, aid).catch(async (e) => {
          await loadDetail().catch(() => null);
          throw e;
        });
        const d = await loadDetail();
        await loadVersion(d.application.currentVersion);
        setNotice(improveNotice(res));
        setTab('report');
      },
      t('AI poprawia CV według raportu, a potem program ocenia nową wersję i zostawia lepszą. To zwykle 1–2 minuty.'),
    );

  const evaluate = () => run(t('Oceniam CV…'), async (step) => evaluateAndReload(app.currentVersion, step));

  /** Polecenie dla AI z pola na dole edytora; true = gotowe (pole może się wyczyścić). */
  const instruct = async (instruction: string) => {
    let done = false;
    await run(
      t('AI zmienia CV według Twojego polecenia…'),
      async () => {
        const res = await api.instructCv(pid, aid, app.currentVersion, instruction);
        const d = await loadDetail();
        await loadVersion(d.application.currentVersion);
        setNotice([t('Nowa wersja {v} według Twojego polecenia. Poprzednia zostaje na liście wersji.', { v: res.version }), res.message].filter(Boolean).join('\n'));
        done = true;
      },
      t('AI korzysta tylko z Twojego profilu i pilnuje jednej strony. To zwykle kilkanaście sekund.'),
    );
    return done;
  };

  const syncProfile = () =>
    run(
      t('Dopisuję do CV nowe rzeczy z profilu…'),
      async () => {
        const res = await api.syncProfile(pid, aid);
        const d = await loadDetail();
        await loadVersion(d.application.currentVersion);
        setNotice(res.version ? [t('Nowa wersja {v} z rzeczami z profilu. Poprzednia zostaje na liście wersji.', { v: res.version }), res.message].filter(Boolean).join('\n') : res.message);
      },
      t('Twoje poprawki w CV zostają. Zmienione nazwy i daty PolCV przepisze z profilu, a AI dopisze tylko nowe rzeczy (np. z rozmowy z doradcą), jeśli pasują do ogłoszenia. Z AI to zwykle kilkanaście sekund.'),
    );

  const shorten = () =>
    run(
      t('Skracam CV do jednej strony…'),
      async () => {
        const { cv } = await api.shorten(pid, aid, app.currentVersion);
        const d = await loadDetail();
        await loadVersion(d.application.currentVersion);
        setNotice(
          cv
            ? t('AI skróciło CV: to nowa wersja {v}, a poprzednia zostaje na liście wersji.', { v: cv.version })
            : t('To CV mieści się już na jednej stronie.'),
        );
      },
      t('AI skraca najmniej trafne punkty i zostawia słowa kluczowe z ogłoszenia. To zwykle kilkanaście sekund.'),
    );

  const exportPdf = () =>
    run(t('Zapisuję PDF…'), async () => {
      await api.exportPdf(pid, aid);
      await loadDetail();
      downloadFile(api.downloadUrl(pid, aid));
      setNotice(t('PDF zapisany w historii i pobrany. Status zmieniono na „Wysłane” - zmień go, jeśli CV nie zostało jeszcze wysłane.'));
    });

  const switchVersion = (v: number) =>
    run(t('Przełączam wersję…'), async () => {
      await api.patchApplication(pid, aid, { currentVersion: v });
      await loadDetail();
      await loadVersion(v);
    });

  // Zmiany od razu pokazujemy lokalnie, a zapisujemy po kolei (żeby szybkie edycje się nie nadpisywały).
  const patch = (p: Patch) => {
    if (!vd) return;
    setVd((prev) => {
      if (!prev) return prev;
      const cv = { ...prev.cv, ...p };
      return { ...prev, cv, reportStale: !!prev.report, pending: pendingCount(cv) };
    });
    queueSave(vd.cv.version, p);
  };

  const setStatus = async (status: string) => {
    await api.patchApplication(pid, aid, { status }).catch((e) => setError(e.message));
    await loadDetail();
  };

  // Notatka idzie do tej samej kolejki, żeby akcja AI (zapisuje całą aplikację) nie nadpisała jej starszą wersją.
  const saveNotes = (notes: string) => {
    saveChain.current = saveChain.current.then(async () => {
      try {
        await api.patchApplication(pid, aid, { notes });
        setDetail((d) => (d ? { ...d, application: { ...d.application, notes } } : d));
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  const previewPdf = () => openWhenReady(flushSaves(), () => api.pdfUrl(pid, aid, app.currentVersion)).catch((e) => setError(e.message));

  const pagesLabel = (n: number) => (n === 1 ? t('{n} strona', { n }) : plFew(n) ? t('{n} strony', { n }) : t('{n} stron', { n }));
  const pendingNote = (n: number) =>
    n === 1
      ? t('AI zaproponowało 1 odważniejsze sformułowanie (na żółto). Zdecyduj o nim w edytorze, zanim pobierzesz PDF.')
      : plFew(n)
        ? t('AI zaproponowało {n} odważniejsze sformułowania (na żółto). Zdecyduj o nich w edytorze, zanim pobierzesz PDF.', { n })
        : t('AI zaproponowało {n} odważniejszych sformułowań (na żółto). Zdecyduj o nich w edytorze, zanim pobierzesz PDF.', { n });
  const decideFirst = t('Najpierw zdecyduj o żółtych sugestiach');

  const hasCv = app.currentVersion > 0 && vd;
  const steps = [
    { label: t('Ogłoszenie'), done: !!app.posting },
    { label: t('Pytania'), done: !!app.gap && hasCv },
    { label: 'CV', done: !!hasCv },
    { label: t('Ocena'), done: !!vd?.report },
    { label: 'PDF', done: !!app.pdfFile },
  ];

  return (
    <div className={`container ${hasCv && (tab === 'cv' || tab === 'letter') ? 'wide' : ''}`}>
      {busy && <Busy message={busy.message} hint={busy.hint} />}

      <div className="page-head">
        <div>
          <div className="faint">
            <Link to="/history">← {t('Historia')}</Link> · {fmtDate(app.createdAt)} · {t('koszt AI')} {usd(detail.costUsd)}
          </div>
          <h1 style={{ marginTop: 4 }}>{app.posting?.title ?? t('Ogłoszenie')}</h1>
          <p className="sub">
            {app.posting?.company}
            {app.posting?.location ? ` · ${app.posting.location}` : ''}
            {app.url && (
              <>
                {' · '}
                <a href={app.url} target="_blank" rel="noreferrer">
                  {t('ogłoszenie')} ↗
                </a>
              </>
            )}
            {app.posting?.company && (
              <>
                {' · '}
                <GoworkLink company={app.posting.company} />
              </>
            )}
          </p>
          <div className="steps" style={{ marginTop: 8 }}>
            {steps.map((s, i) => (
              <span key={s.label} className={s.done ? 'done' : steps.findIndex((x) => !x.done) === i ? 'on' : ''}>
                {s.done ? '✓' : `${i + 1}.`} {s.label}
                {i < steps.length - 1 && <span className="faint"> → </span>}
              </span>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div className="row">
            <span className="faint">{t('Status:')}</span>
            <select value={app.status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_LABELS[s])}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            defaultValue={app.notes}
            placeholder={t('Notatka (np. data rozmowy)')}
            onBlur={(e) => e.target.value !== app.notes && saveNotes(e.target.value)}
            style={{ width: 260 }}
          />
        </div>
      </div>

      <div className="stack">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {notice && <div className="callout good row between"><span style={{ whiteSpace: 'pre-line' }}>{notice}</span><button className="icon-btn" onClick={() => setNotice(null)}>✕</button></div>}

        {!app.posting && <div className="callout error">{t('Nie udało się przeanalizować ogłoszenia. Usuń tę aplikację i spróbuj ponownie.')}</div>}

        {app.posting && !hasCv && app.gap && <GapStep app={app} onGenerate={generate} />}
        {app.posting && !hasCv && !app.gap && !busy && (
          <div className="card empty">
            <p>{t('Nie udało się porównać ogłoszenia z profilem.')}</p>
            <button
              className="btn primary"
              onClick={() =>
                run(t('Porównuję ogłoszenie z Twoim profilem…'), async () => {
                  await api.gap(pid, aid);
                  await loadDetail();
                })
              }
            >
              {t('Spróbuj ponownie')}
            </button>
          </div>
        )}

        {hasCv && vd && (
          <>
            <div className="card tight row between">
              <div className="row">
                <span className="faint">{t('Wersja:')}</span>
                <select value={app.currentVersion} onChange={(e) => switchVersion(Number(e.target.value))} style={{ width: 'auto' }}>
                  {detail.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} - {v.origin === 'improved' ? t('poprawiona') : v.origin === 'synced' ? t('z profilu') : t('wygenerowana')}
                      {v.score != null ? ` (${v.score}/100)` : v.scoreIncomplete ? ` (${t('ocena niepełna')})` : ''}
                    </option>
                  ))}
                </select>
                <ScoreBadge score={vd.report?.total} incomplete={!!vd.report && vd.report.total == null} />
                {vd.reportStale && <span className="badge warn">{t('ocena nieaktualna')}</span>}
                {pages != null && tab === 'cv' && <span className={`badge ${pages > 1 ? 'warn' : ''}`}>{pagesLabel(pages)}</span>}
                {pages != null && pages > 1 && tab === 'cv' && (
                  <button className="btn sm" onClick={shorten} title={t('AI skróci to CV tak, żeby zmieściło się na jednej stronie A4. Obecna wersja zostanie na liście.')}>
                    {t('Skróć do 1 strony')}
                  </button>
                )}
              </div>
              <div className="row">
                <button
                  className="btn sm"
                  onClick={syncProfile}
                  disabled={!detail.profileNews}
                  title={detail.profileNews ? t('Dopisz do CV to, co doszło do profilu od tej wersji') : t('Od tej wersji w profilu nie doszło nic nowego')}
                >
                  {detail.profileNews ? t('Synchronizuj z profilem ({n})', { n: newsLabel(detail.profileNews) }) : t('Synchronizuj z profilem')}
                </button>
                <button className="btn ghost sm" onClick={regenerate}>
                  {t('Napisz od nowa')}
                </button>
                {(vd.reportStale || !vd.report) && (
                  <button className="btn sm" onClick={evaluate}>
                    {t('Oceń ponownie')}
                  </button>
                )}
                <button className="btn sm" onClick={improve} disabled={vd.pending > 0} title={vd.pending > 0 ? decideFirst : ''}>
                  {t('Popraw automatycznie')}
                </button>
                <button className="btn sm" onClick={previewPdf}>
                  {t('Podgląd PDF')}
                </button>
                <button className="btn primary sm" onClick={exportPdf} disabled={vd.pending > 0} title={vd.pending > 0 ? decideFirst : ''}>
                  {t('Pobierz PDF')}
                </button>
              </div>
            </div>
            {vd.pending > 0 && <div className="callout warn small">{pendingNote(vd.pending)}</div>}

            <div className="tabs" role="tablist">
              {(
                [
                  ['cv', t('Edytor CV')],
                  ['report', `${t('Raport ATS/AI')}${vd.report ? ` (${vd.report.total ?? t('ocena niepełna')})` : ''}`],
                  ['posting', t('Ogłoszenie')],
                  ['interview', t('Rozmowa')],
                  ['letter', t('List motywacyjny')],
                  ['courses', t('Kursy i certyfikaty')],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'cv' && (
              <div className="editor-split">
                <CvEditor cv={vd.cv} onPatch={patch} hasPhoto={detail.hasPhoto} unverifiedSkills={vd.unverifiedSkills} focusId={focusId} onInstruct={instruct} />
                <div className="preview-pane">
                  <iframe className="preview-frame" title={t('Podgląd CV')} src={api.previewUrl(pid, aid, app.currentVersion, bust)} />
                  <p className="faint" style={{ marginTop: 6 }}>
                    {t('Podgląd na żywo. Czerwona linia = koniec strony A4. Kliknij żółty fragment, żeby o nim zdecydować.')}
                  </p>
                </div>
              </div>
            )}
            {tab === 'report' && (
              <ReportView
                report={vd.report}
                stale={vd.reportStale}
                onEvaluate={evaluate}
                onImprove={improve}
                pending={vd.pending}
                factTopics={detail.factTopics ?? []}
                onAddFact={async (topic, answer) => {
                  await api.facts(pid, aid, [{ topic, answer }]);
                  await loadDetail();
                }}
              />
            )}
            {tab === 'posting' && <PostingView app={app} />}
            {tab === 'interview' && <InterviewView key={app.id} pid={pid} app={app} run={(m, fn, h) => run(m, async () => { await fn(); await loadDetail(); }, h)} />}
            {tab === 'courses' && <CoursesView key={app.id} pid={pid} app={app} run={(m, fn, h) => run(m, async () => { await fn(); await loadDetail(); }, h)} />}
            {tab === 'letter' && <LetterView key={app.id} pid={pid} app={app} run={(m, fn, h) => run(m, async () => { await fn(); await loadDetail(); }, h)} />}
          </>
        )}
      </div>
    </div>
  );
}
