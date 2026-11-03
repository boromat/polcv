import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApplicationSummary } from '../../../shared/schemas';
import { api } from '../api';
import { useApp } from '../ctx';
import { ErrorBox, fmtDate, ScoreBadge, STATUS_LABELS, STATUSES, statusTone, usd } from '../components/ui';

export function HistoryPage() {
  const { current } = useApp();
  const nav = useNavigate();
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    if (!confirm(`Usunąć aplikację „${a.posting?.title ?? ''}” z historii?`)) return;
    await api.deleteApplication(current.id, a.id).catch((e) => setError(e.message));
    load();
  };

  const shown = apps?.filter((a) => !filter || a.status === filter) ?? [];
  const counts = Object.fromEntries(STATUSES.map((s) => [s, apps?.filter((a) => a.status === s).length ?? 0]));
  const total = apps?.reduce((s, a) => s + a.costUsd, 0) ?? 0;

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Historia aplikacji</h1>
          <p className="sub">
            {apps ? `${apps.length} aplikacji · koszt AI łącznie ${usd(total)}` : 'Ładowanie…'}
          </p>
        </div>
        <Link to="/new" className="btn primary">
          + Nowe CV pod ogłoszenie
        </Link>
      </div>
      <ErrorBox error={error} onClose={() => setError(null)} />
      {apps && apps.length === 0 && (
        <div className="card empty">
          <h2>Jeszcze nic tu nie ma</h2>
          <p>Wklej link do pierwszego ogłoszenia, a program przygotuje CV pod nie.</p>
          <Link to="/new" className="btn primary lg">
            Zrób pierwsze CV
          </Link>
        </div>
      )}
      {apps && apps.length > 0 && (
        <div className="stack">
          <div className="chips">
            <button className={`btn sm ${filter === '' ? 'primary' : ''}`} onClick={() => setFilter('')}>
              Wszystkie ({apps.length})
            </button>
            {STATUSES.filter((s) => counts[s]).map((s) => (
              <button key={s} className={`btn sm ${filter === s ? 'primary' : ''}`} onClick={() => setFilter(s)}>
                {STATUS_LABELS[s]} ({counts[s]})
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Stanowisko</th>
                    <th>Firma</th>
                    <th>Wynik</th>
                    <th>Status</th>
                    <th>Koszt AI</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => nav(`/app/${a.id}`)}>
                      <td className="nowrap">{fmtDate(a.createdAt)}</td>
                      <td>
                        <b>{a.posting?.title ?? '—'}</b>
                        {a.url && (
                          <div>
                            <a href={a.url} target="_blank" rel="noreferrer" className="faint" onClick={(e) => e.stopPropagation()}>
                              ogłoszenie ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>{a.posting?.company ?? '—'}</td>
                      <td>
                        <ScoreBadge score={a.score} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select value={a.status} onChange={(e) => setStatus(a, e.target.value)} className={`badge ${statusTone(a.status)}`} style={{ width: 'auto', padding: '3px 8px' }} aria-label="Status">
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="nowrap faint">{usd(a.costUsd)}</td>
                      <td onClick={(e) => e.stopPropagation()} className="nowrap">
                        {a.pdfFile && (
                          <a className="btn ghost sm" href={api.downloadUrl(current.id, a.id)}>
                            PDF
                          </a>
                        )}
                        <button className="btn ghost sm danger" onClick={() => remove(a)} aria-label="Usuń">
                          Usuń
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
