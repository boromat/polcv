import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApplicationSummary } from '../../../shared/schemas';
import { api } from '../api';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { ErrorBox, fmtDate, GoworkLink, ScoreBadge, STATUS_LABELS, STATUSES, statusTone, usd } from '../components/ui';

export function HistoryPage() {
  const { current } = useApp();
  const { t } = useT();
  const nav = useNavigate();
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = () => current && api.applications(current.id).then(setApps).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [current?.id]);

  if (!current) return null;

  const setStatus = async (a: ApplicationSummary, status: string) => {
    try {
      await api.patchApplication(current.id, a.id, { status });
      setApps((prev) => prev?.map((x) => (x.id === a.id ? { ...x, status: status as any } : x)) ?? null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (a: ApplicationSummary) => {
    if (!confirm(t('Usunąć aplikację „{title}” z historii?', { title: a.posting?.title ?? '' }))) return;
    await api.deleteApplication(current.id, a.id).catch((e) => setError(e.message));
    load();
  };

  const syncProfile = async (a: ApplicationSummary) => {
    setSyncing(a.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.syncProfile(current.id, a.id);
      setNotice(
        res.version
          ? t('„{title}”: nowa wersja CV {v} z rzeczami z profilu.', { title: a.posting?.title ?? '', v: res.version }) + (res.message ? `\n${res.message}` : '')
          : res.message,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(null);
    }
  };

  // Wiersz otwiera się kliknięciem myszą; z klawiatury i środkowym przyciskiem działa link w tytule.
  const openRow = (e: React.MouseEvent, id: string) => {
    if ((e.target as Element).closest('a, button, select, input, textarea, label')) return;
    if (window.getSelection()?.toString()) return; // zaznaczanie tekstu to nie kliknięcie
    nav(`/app/${id}`);
  };

  const shown = apps?.filter((a) => !filter || a.status === filter) ?? [];
  const counts = Object.fromEntries(STATUSES.map((s) => [s, apps?.filter((a) => a.status === s).length ?? 0]));
  const total = apps?.reduce((s, a) => s + a.costUsd, 0) ?? 0;

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>{t('Historia aplikacji')}</h1>
          <p className="sub">
            {apps
              ? apps.length === 1
                ? t('1 aplikacja · koszt AI łącznie {cost}', { cost: usd(total) })
                : t('{n} aplikacji · koszt AI łącznie {cost}', { n: apps.length, cost: usd(total) })
              : t('Ładowanie…')}
          </p>
        </div>
        <Link to="/new" className="btn primary">
          + {t('Nowe CV pod ogłoszenie')}
        </Link>
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {notice && (
        <div className="callout good row between">
          <span style={{ whiteSpace: 'pre-line' }}>{notice}</span>
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label={t('Zamknij')}>
            ✕
          </button>
        </div>
      )}
      {apps && apps.length === 0 && (
        <div className="card empty">
          <h2>{t('Jeszcze nic tu nie ma')}</h2>
          <p>{t('Wklej link do pierwszego ogłoszenia, a program przygotuje CV pod nie.')}</p>
          <Link to="/new" className="btn primary lg">
            {t('Zrób pierwsze CV')}
          </Link>
        </div>
      )}
      {apps && apps.length > 0 && (
        <div className="stack">
          <div className="chips">
            <button className={`btn sm ${filter === '' ? 'primary' : ''}`} onClick={() => setFilter('')}>
              {t('Wszystkie ({n})', { n: apps.length })}
            </button>
            {STATUSES.filter((s) => counts[s]).map((s) => (
              <button key={s} className={`btn sm ${filter === s ? 'primary' : ''}`} onClick={() => setFilter(s)}>
                {t(STATUS_LABELS[s])} ({counts[s]})
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Data')}</th>
                    <th>{t('Stanowisko')}</th>
                    <th>{t('Firma')}</th>
                    <th>{t('Wynik')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Koszt AI')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="clickable" onClick={(e) => openRow(e, a.id)}>
                      <td className="nowrap">{fmtDate(a.createdAt)}</td>
                      <td>
                        <Link to={`/app/${a.id}`} className="row-link">
                          {a.posting?.title ?? '-'}
                        </Link>
                        {a.url && (
                          <div>
                            <a href={a.url} target="_blank" rel="noreferrer" className="faint">
                              {t('ogłoszenie')} ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>
                        {a.posting?.company || '-'}
                        {a.posting?.company && (
                          <div>
                            <GoworkLink company={a.posting.company} className="faint" />
                          </div>
                        )}
                      </td>
                      <td>
                        <ScoreBadge score={a.score} incomplete={a.scoreIncomplete} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select value={a.status} onChange={(e) => setStatus(a, e.target.value)} className={`badge ${statusTone(a.status)}`} style={{ width: 'auto', padding: '3px 8px' }} aria-label={t('Status')}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(STATUS_LABELS[s])}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="nowrap faint">{usd(a.costUsd)}</td>
                      <td onClick={(e) => e.stopPropagation()} className="nowrap">
                        {a.profileNews > 0 && (
                          <button className="btn sm" onClick={() => syncProfile(a)} disabled={syncing !== null} title={t('Dopisz do CV to, co doszło do profilu od tej wersji')}>
                            {syncing === a.id ? t('Synchronizuję…') : t('Synchronizuj z profilem ({n})', { n: a.profileNews })}
                          </button>
                        )}
                        {a.pdfFile && (
                          <a className="btn ghost sm" href={api.downloadUrl(current.id, a.id)}>
                            PDF
                          </a>
                        )}
                        <button className="btn ghost sm danger" onClick={() => remove(a)} aria-label={t('Usuń')}>
                          {t('Usuń')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
