import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CvVersion, GapAnswer, TemplateId } from '../../../shared/schemas';
import { api, type AppDetail, type VersionDetail } from '../api';
import { useApp } from '../ctx';
import { Busy, ErrorBox, fmtDate, ScoreBadge, STATUS_LABELS, STATUSES, usd } from '../components/ui';
import { GapStep } from './app/GapStep';
import { CvEditor } from './app/CvEditor';
import { ReportView } from './app/ReportView';
import { InterviewView, LetterView, PostingView } from './app/ExtrasViews';

type Tab = 'cv' | 'report' | 'posting' | 'interview' | 'letter';
type Patch = Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>;

export function ApplicationPage() {
  const { aid = '' } = useParams();
  const { current } = useApp();
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

  const run = useCallback(async (message: string, fn: (step: (m: string, hint?: string) => void) => Promise<void>, hint?: string) => {
    setError(null);
    setNotice(null);
    setBusy({ message, hint });
    try {
      await fn((m, h) => setBusy({ message: m, hint: h }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, []);

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
    run('Porównuję ogłoszenie z Twoim profilem…', async () => {
      await api.gap(pid, aid);
      await loadDetail();
    });
  }, [detail, pid, aid, run, loadDetail]);

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

  if (!detail) return <div className="container">{error ? <ErrorBox error={error} /> : 'Ładowanie…'}</div>;
  const app = detail.application;

  const evaluateAndReload = async (v: number, step: (m: string, hint?: string) => void) => {
    step('Oceniam CV jak ATS i AI-rekruter…', 'Tworzę PDF, odczytuję go jak system ATS i daję do oceny AI.');
    await api.evaluate(pid, aid, v);
    await loadDetail();
    await loadVersion(v);
  };

  const generate = (answers: GapAnswer[], opts: { language?: 'pl' | 'en'; template: TemplateId }) =>
    run('Zapisuję odpowiedzi w profilu…', async (step) => {
      if (answers.length) await api.answers(pid, aid, answers);
      step('Piszę CV pod to ogłoszenie…', 'Wybieram z profilu to, co pasuje, i piszę językiem ogłoszenia. To zwykle 30–60 sekund.');
      const cv = await api.generate(pid, aid, opts);
      await evaluateAndReload(cv.version, step);
      setTab('cv');
    });

  const regenerate = () => {
    if (!confirm('Napisać CV od nowa? Obecna wersja zostanie zachowana na liście wersji.')) return;
    run('Piszę CV od nowa…', async (step) => {
      const cv = await api.generate(pid, aid, { template: vd?.cv.template });
      await evaluateAndReload(cv.version, step);
    });
  };

  const improve = () => {
    const before = vd?.report?.total ?? null;
    run('Poprawiam CV na podstawie raportu…', async (step) => {
      const cv = await api.improve(pid, aid);
      await evaluateAndReload(cv.version, step);
      const after = (await api.version(pid, aid, cv.version)).report?.total ?? null;
      setNotice(before != null && after != null ? `Nowa wersja CV: wynik ${before} → ${after}.` : 'Gotowe - powstała nowa wersja CV.');
      setTab('report');
    });
  };

  const evaluate = () => run('Oceniam CV…', async (step) => evaluateAndReload(app.currentVersion, step));

  const exportPdf = () =>
    run('Zapisuję PDF…', async () => {
      await api.exportPdf(pid, aid);
      await loadDetail();
      window.location.href = api.downloadUrl(pid, aid);
      setNotice('PDF zapisany w historii i pobrany. Status zmieniono na „Wysłane” - zmień go, jeśli CV nie zostało jeszcze wysłane.');
    });

  const switchVersion = (v: number) =>
    run('Przełączam wersję…', async () => {
      await api.patchApplication(pid, aid, { currentVersion: v });
      await loadDetail();
      await loadVersion(v);
    });

  // Zmiany zapisujemy po kolei i od razu pokazujemy lokalnie (żeby szybkie edycje się nie nadpisywały).
  const patch = (p: Patch) => {
    if (!vd) return;
    setVd((prev) => (prev ? { ...prev, cv: { ...prev.cv, ...p }, reportStale: !!prev.report } : prev));
    const v = vd.cv.version;
    saveChain.current = saveChain.current
      .then(async () => {
        await api.saveVersion(pid, aid, v, p);
        const fresh = await api.version(pid, aid, v);
        // Lokalna treść CV jest źródłem prawdy podczas edycji; z serwera bierzemy tylko wyliczenia.
        setVd((prev) => (prev && prev.cv.version === v ? { ...fresh, cv: prev.cv } : prev));
        setBust(String(Date.now()));
      })
      .catch((e) => setError(e.message));
  };

  const setStatus = async (status: string) => {
    await api.patchApplication(pid, aid, { status }).catch((e) => setError(e.message));
    await loadDetail();
  };

  const saveNotes = async (notes: string) => {
    await api.patchApplication(pid, aid, { notes }).catch((e) => setError(e.message));
  };

  const hasCv = app.currentVersion > 0 && vd;
  const steps = [
    { label: 'Ogłoszenie', done: !!app.posting },
    { label: 'Pytania', done: !!app.gap && hasCv },
    { label: 'CV', done: !!hasCv },
    { label: 'Ocena', done: !!vd?.report },
    { label: 'PDF', done: !!app.pdfFile },
  ];

  return (
    <div className={`container ${hasCv && (tab === 'cv' || tab === 'letter') ? 'wide' : ''}`}>
      {busy && <Busy message={busy.message} hint={busy.hint} />}

      <div className="page-head">
        <div>
          <div className="faint">
            <Link to="/history">← Historia</Link> · {fmtDate(app.createdAt)} · koszt AI {usd(detail.costUsd)}
          </div>
          <h1 style={{ marginTop: 4 }}>{app.posting?.title ?? 'Ogłoszenie'}</h1>
          <p className="sub">
            {app.posting?.company}
            {app.posting?.location ? ` · ${app.posting.location}` : ''}
            {app.url && (
              <>
                {' · '}
                <a href={app.url} target="_blank" rel="noreferrer">
                  ogłoszenie ↗
                </a>
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
            <span className="faint">Status:</span>
            <select value={app.status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            defaultValue={app.notes}
            placeholder="Notatka (np. data rozmowy)"
            onBlur={(e) => e.target.value !== app.notes && saveNotes(e.target.value)}
            style={{ width: 260 }}
          />
        </div>
      </div>

      <div className="stack">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {notice && <div className="callout good row between"><span>{notice}</span><button className="icon-btn" onClick={() => setNotice(null)}>✕</button></div>}

        {!app.posting && <div className="callout error">Nie udało się przeanalizować ogłoszenia. Usuń tę aplikację i spróbuj ponownie.</div>}

        {app.posting && !hasCv && app.gap && <GapStep app={app} onGenerate={generate} />}
        {app.posting && !hasCv && !app.gap && !busy && (
          <div className="card empty">
            <p>Nie udało się porównać ogłoszenia z profilem.</p>
            <button
              className="btn primary"
              onClick={() =>
                run('Porównuję ogłoszenie z Twoim profilem…', async () => {
                  await api.gap(pid, aid);
                  await loadDetail();
                })
              }
            >
              Spróbuj ponownie
            </button>
          </div>
        )}

        {hasCv && vd && (
          <>
            <div className="card tight row between">
              <div className="row">
                <span className="faint">Wersja:</span>
                <select value={app.currentVersion} onChange={(e) => switchVersion(Number(e.target.value))} style={{ width: 'auto' }}>
                  {detail.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} - {v.origin === 'improved' ? 'poprawiona' : 'wygenerowana'}
                      {v.score != null ? ` (${v.score}/100)` : ''}
                    </option>
                  ))}
                </select>
                <ScoreBadge score={vd.report?.total} />
                {vd.reportStale && <span className="badge warn">ocena nieaktualna</span>}
                {pages != null && tab === 'cv' && <span className={`badge ${pages > 1 ? 'warn' : ''}`}>{pages} {pages === 1 ? 'strona' : 'strony'}</span>}
              </div>
              <div className="row">
                <button className="btn ghost sm" onClick={regenerate}>
                  Napisz od nowa
                </button>
                {(vd.reportStale || !vd.report) && (
                  <button className="btn sm" onClick={evaluate}>
                    Oceń ponownie
                  </button>
                )}
                <button className="btn sm" onClick={improve} disabled={vd.pending > 0} title={vd.pending > 0 ? 'Najpierw zdecyduj o żółtych sugestiach' : ''}>
                  Popraw automatycznie
                </button>
                <a className="btn sm" href={api.pdfUrl(pid, aid, app.currentVersion)} target="_blank" rel="noreferrer">
                  Podgląd PDF
                </a>
                <button className="btn primary sm" onClick={exportPdf} disabled={vd.pending > 0} title={vd.pending > 0 ? 'Najpierw zdecyduj o żółtych sugestiach' : ''}>
                  Pobierz PDF
                </button>
              </div>
            </div>
            {vd.pending > 0 && (
              <div className="callout warn small">
                AI zaproponowało {vd.pending} odważniejsze sformułowania (na żółto). Zdecyduj o nich w edytorze, zanim pobierzesz PDF.
              </div>
            )}

            <div className="tabs" role="tablist">
              {(
                [
                  ['cv', 'Edytor CV'],
                  ['report', `Raport ATS/AI${vd.report ? ` (${vd.report.total})` : ''}`],
                  ['posting', 'Ogłoszenie'],
                  ['interview', 'Rozmowa'],
                  ['letter', 'List motywacyjny'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'cv' && (
              <div className="editor-split">
                <CvEditor cv={vd.cv} onPatch={patch} hasPhoto={detail.hasPhoto} unverifiedSkills={vd.unverifiedSkills} focusId={focusId} />
                <div className="preview-pane">
                  <iframe className="preview-frame" title="Podgląd CV" src={api.previewUrl(pid, aid, app.currentVersion, bust)} />
                  <p className="faint" style={{ marginTop: 6 }}>
                    Podgląd na żywo. Czerwona linia = koniec strony A4. Kliknij żółty fragment, żeby o nim zdecydować.
                  </p>
                </div>
              </div>
            )}
            {tab === 'report' && <ReportView report={vd.report} stale={vd.reportStale} onEvaluate={evaluate} onImprove={improve} pending={vd.pending} />}
            {tab === 'posting' && <PostingView app={app} />}
            {tab === 'interview' && <InterviewView pid={pid} app={app} run={(m, fn, h) => run(m, async () => { await fn(); await loadDetail(); }, h)} />}
            {tab === 'letter' && <LetterView pid={pid} app={app} run={(m, fn, h) => run(m, async () => { await fn(); await loadDetail(); }, h)} />}
          </>
        )}
      </div>
    </div>
  );
}
