import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Career, CareerPrefs, JobLead, RoleProposal } from '../../../shared/schemas';
import { api } from '../api';
import { useApp } from '../ctx';
import { Busy, ErrorBox, Field, fmtDate, scoreTone } from '../components/ui';

const CONTRACTS = ['umowa o pracę', 'umowa zlecenie', 'B2B', 'staż / praktyki'] as const;
const RADII = [10, 20, 30, 50, 75, 100];
const PORTAL_NAMES: Record<JobLead['portal'], string> = { pracuj: 'pracuj.pl', justjoin: 'justjoin.it', nofluff: 'nofluffjobs' };
const FIT_TONE: Record<RoleProposal['fit'], string> = { wysokie: 'good', średnie: 'accent', ambitne: 'warn' };
const WEAK_MATCH = 30;
const MAX_MESSAGE = 15_000; // tak samo jak na serwerze

const LEVELS: Record<RoleProposal['seniority'], { pracuj: string; justjoin: string; nofluff: string }> = {
  staż: { pracuj: '1,3', justjoin: 'junior', nofluff: 'trainee,junior' },
  junior: { pracuj: '1,3,17', justjoin: 'junior', nofluff: 'trainee,junior' },
  mid: { pracuj: '17,4', justjoin: 'mid', nofluff: 'junior,mid' },
};

/** Linki do wyszukiwarek portali z frazą, miastem i poziomem — otwiera je kandydat, program niczego nie pobiera. */
function portalLinks(role: RoleProposal, prefs: CareerPrefs) {
  const phrase = role.keywords[0] || role.title;
  const q = encodeURIComponent(phrase);
  const city = prefs.city.trim();
  const local = !!city && (prefs.onsite || prefs.hybrid);
  const remoteOnly = !local && prefs.remote;
  const citySlug = city.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  const lv = LEVELS[role.seniority];

  const pracuj = new URLSearchParams({ et: lv.pracuj });
  if (remoteOnly) pracuj.set('wm', 'home-office');
  if (local) pracuj.set('rd', String(prefs.radiusKm));
  const nofluff = [`keyword=${phrase}`, `seniority=${lv.nofluff}`, remoteOnly ? 'city=remote' : local ? `city=${citySlug}` : ''].filter(Boolean).join(' ');
  return [
    { name: 'pracuj.pl', url: `https://www.pracuj.pl/praca/${q};kw${local ? `/${encodeURIComponent(city.toLowerCase())};wp` : ''}?${pracuj}` },
    { name: 'justjoin.it', url: `https://justjoin.it/job-offers/${remoteOnly ? 'remote' : local ? citySlug : 'all-locations'}?keyword=${q}&experience-level=${lv.justjoin}` },
    { name: 'nofluffjobs', url: `https://nofluffjobs.com/pl/?criteria=${encodeURIComponent(nofluff)}` },
  ];
}

function ChatPanel({
  career,
  sending,
  draft,
  setDraft,
  error,
  onSend,
  onRetry,
  onReset,
}: {
  career: Career;
  sending: boolean;
  draft: string;
  setDraft: (t: string) => void;
  error: string | null;
  onSend: (m: string) => void;
  onRetry: () => void;
  onReset: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [career.chat.length, sending, error]);

  const tooLong = draft.length > MAX_MESSAGE;
  const send = () => {
    if (!draft.trim() || sending || tooLong) return;
    onSend(draft);
  };
  // Ostatnia wiadomość od kandydata bez odpowiedzi = poprzednia próba się nie udała.
  const unanswered = !sending && career.chat.at(-1)?.role === 'user';

  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Rozmowa z doradcą</h2>
        {career.chat.length > 0 && (
          <button className="btn ghost sm" onClick={onReset} disabled={sending}>
            Zacznij od nowa
          </button>
        )}
      </div>
      <div className="chat" aria-live="polite">
        {career.chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="msg assistant typing">Doradca pisze…</div>}
        {(error || unanswered) && (
          <div className="callout error small row between" role="alert">
            <span>{error ?? 'Doradca nie odpowiedział na Twoją ostatnią wiadomość.'}</span>
            {unanswered && (
              <button className="btn sm" onClick={onRetry}>
                Spróbuj ponownie
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-input">
        <textarea
          rows={2}
          value={draft}
          placeholder="Napisz odpowiedź… (Enter — wyślij, Shift+Enter — nowa linia)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
          autoFocus
        />
        <button className="btn primary" onClick={send} disabled={sending || !draft.trim() || tooLong}>
          Wyślij
        </button>
      </div>
      {draft.length > MAX_MESSAGE * 0.8 && (
        <p className={`small ${tooLong ? 'bad-ic' : 'faint'}`} style={{ marginTop: -6 }}>
          {draft.length} / {MAX_MESSAGE} znaków{tooLong ? ' — skróć wiadomość albo podziel ją na dwie.' : ''}
        </p>
      )}
      <p className="faint">
        Konkretne informacje o Twoim doświadczeniu zapisują się w profilu („Twoje odpowiedzi na pytania AI”) i trafią do kolejnych CV.
      </p>
    </div>
  );
}

function PrefsPanel({ prefs, onSave }: { prefs: CareerPrefs; onSave: (p: CareerPrefs) => Promise<void> }) {
  const [draft, setDraft] = useState(prefs);
  const [rolesText, setRolesText] = useState(prefs.targetRoles.join(', '));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  // Doradca aktualizuje preferencje w trakcie rozmowy — pokazujemy je, o ile nie ma niezapisanych zmian.
  useEffect(() => {
    if (dirty) return;
    setDraft(prefs);
    setRolesText(prefs.targetRoles.join(', '));
  }, [prefs]);

  const set = (patch: Partial<CareerPrefs>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const local = draft.onsite || draft.hybrid;

  return (
    <div className="card stack">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h2>Czego szukasz</h2>
        {saved && <span className="badge good">zapisano</span>}
      </div>
      <p className="faint" style={{ marginTop: -6 }}>Doradca uzupełnia to w trakcie rozmowy. Możesz też zmienić wszystko ręcznie.</p>
      <Field label="Stanowiska / kierunki (po przecinku)">
        <input
          type="text"
          value={rolesText}
          onChange={(e) => {
            setRolesText(e.target.value);
            setDirty(true);
          }}
          placeholder="np. analityk danych, marketing"
        />
      </Field>
      <div>
        <span className="small muted" style={{ fontWeight: 500 }}>Tryb pracy</span>
        <div className="row" style={{ marginTop: 6 }}>
          <label className="check"><input type="checkbox" checked={draft.onsite} onChange={(e) => set({ onsite: e.target.checked })} /> stacjonarnie</label>
          <label className="check"><input type="checkbox" checked={draft.hybrid} onChange={(e) => set({ hybrid: e.target.checked })} /> hybrydowo</label>
          <label className="check"><input type="checkbox" checked={draft.remote} onChange={(e) => set({ remote: e.target.checked })} /> zdalnie</label>
        </div>
      </div>
      <div className="grid2">
        <Field label="Miasto" hint={local ? 'Dla pracy stacjonarnej i hybrydowej.' : 'Zaznacz stacjonarnie lub hybrydowo, żeby szukać w okolicy.'}>
          <input type="text" value={draft.city} onChange={(e) => set({ city: e.target.value })} placeholder="np. Warszawa" disabled={!local} />
        </Field>
        <Field label="Promień od miasta">
          <select value={draft.radiusKm} onChange={(e) => set({ radiusKm: Number(e.target.value) })} disabled={!local}>
            {RADII.map((r) => (
              <option key={r} value={r}>do {r} km</option>
            ))}
          </select>
        </Field>
      </div>
      {draft.remote && <p className="faint" style={{ marginTop: -6 }}>Praca zdalna jest szukana w całej Polsce — niezależnie od miasta.</p>}
      <div className="grid2">
        <Field label="Min. wynagrodzenie (zł brutto / mies.)" hint="0 = bez wymagań. Oferty bez podanej kwoty zostają.">
          <input type="text" inputMode="numeric" value={draft.salaryMin || ''} onChange={(e) => set({ salaryMin: Number(e.target.value.replace(/\D/g, '')) || 0 })} placeholder="np. 5000" />
        </Field>
        <Field label="Poziom">
          <select value={draft.seniority} onChange={(e) => set({ seniority: e.target.value as CareerPrefs['seniority'] })}>
            <option value="staż">Staż / praktyki</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="dowolny">Dowolny</option>
          </select>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Wymiar pracy">
          <select value={draft.workTime} onChange={(e) => set({ workTime: e.target.value as CareerPrefs['workTime'] })}>
            <option value="dowolny">Dowolny</option>
            <option value="pełny etat">Pełny etat</option>
            <option value="część etatu">Część etatu</option>
          </select>
        </Field>
        <div>
          <span className="small muted" style={{ fontWeight: 500 }}>Forma umowy (pusto = dowolna)</span>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {CONTRACTS.map((c) => (
              <label key={c} className="check">
                <input
                  type="checkbox"
                  checked={draft.contracts.includes(c)}
                  onChange={(e) => set({ contracts: e.target.checked ? [...draft.contracts, c] : draft.contracts.filter((x) => x !== c) })}
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      </div>
      <Field label="Inne oczekiwania">
        <textarea rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="np. nie chcę sprzedaży telefonicznej" />
      </Field>
      <button
        className="btn primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={!dirty}
        onClick={async () => {
          await onSave({ ...draft, targetRoles: rolesText.split(',').map((s) => s.trim()).filter(Boolean) });
          setDirty(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
      >
        Zapisz preferencje
      </button>
    </div>
  );
}

function OfferRow({ lead, onMakeCv }: { lead: JobLead; onMakeCv: (l: JobLead) => void }) {
  return (
    <div className="offer">
      <div className="offer-main">
        <a href={lead.url} target="_blank" rel="noreferrer" className="offer-title">
          {lead.title} ↗
        </a>
        <div className="faint">
          {[lead.company, lead.location, lead.workModes.join(' / '), lead.contracts.join(', ')].filter(Boolean).join(' · ')}
        </div>
        {lead.salary && <div className="small">{lead.salary}</div>}
        {lead.matchReason && <div className="small muted">{lead.matchReason}</div>}
      </div>
      <div className="offer-side">
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {lead.excludedBy && <span className="badge warn">poza filtrem: {lead.excludedBy}</span>}
          {lead.match != null && <span className={`badge ${scoreTone(lead.match)}`}>{lead.match}%</span>}
          <span className="badge">{PORTAL_NAMES[lead.portal]}</span>
        </div>
        <button className="btn sm primary" onClick={() => onMakeCv(lead)}>
          Zrób CV pod to
        </button>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  prefs,
  offers,
  canSearch,
  searching,
  onSearch,
  onMakeCv,
}: {
  role: RoleProposal;
  prefs: CareerPrefs;
  offers: Career['offers'][string] | undefined;
  canSearch: boolean;
  searching: boolean;
  onSearch: () => void;
  onMakeCv: (l: JobLead) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showWeak, setShowWeak] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const all = offers?.items ?? [];
  // Słabo dopasowane (poniżej 30%) chowamy — wyszukiwarki zwracają też oferty luźno związane z frazą.
  const weak = all.filter((l) => l.match != null && l.match < WEAK_MATCH);
  const items = showWeak ? all : all.filter((l) => l.match == null || l.match >= WEAK_MATCH);
  const shown = showAll ? items : items.slice(0, 6);
  const excluded = (offers?.excluded ?? []).filter((l) => l.match == null || l.match >= WEAK_MATCH);
  const stats = Object.entries(offers?.stats ?? {}).filter(([k]) => k !== 'duplikaty');
  return (
    <div className="card stack">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h3>{role.title}</h3>
          <div className="row" style={{ gap: 6 }}>
            <span className={`badge ${FIT_TONE[role.fit]}`}>dopasowanie: {role.fit}</span>
            <span className="badge">{role.seniority}</span>
            {role.keywords.map((k) => (
              <span key={k} className="badge">„{k}”</span>
            ))}
          </div>
        </div>
        {canSearch && (
          <button className="btn sm" onClick={onSearch} disabled={searching}>
            {searching ? 'Szukam…' : offers ? 'Odśwież oferty' : 'Szukaj ofert'}
          </button>
        )}
      </div>
      <p className="small">{role.why}</p>
      {role.gaps.length > 0 && (
        <div className="small">
          <b>Czego brakuje:</b> {role.gaps.join('; ')}
          <div className="muted" style={{ marginTop: 2 }}>→ {role.howToClose}</div>
        </div>
      )}
      <div className="small">
        Otwórz wyszukiwanie:{' '}
        {portalLinks(role, prefs).map((l, i) => (
          <span key={l.name}>
            {i > 0 && ' · '}
            <a href={l.url} target="_blank" rel="noreferrer">{l.name}</a>
          </span>
        ))}
      </div>
      {searching && <div className="callout info small">Szukam ofert na nofluffjobs i oceniam dopasowanie… (ok. 10–30 s)</div>}
      {offers && !searching && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="faint">
            Sprawdzono {offers.scanned} ofert, pasuje do Twoich preferencji: {all.length}
            {weak.length > 0 && !showWeak ? ` (w tym ${weak.length} słabo dopasowanych — ukryte)` : ''}. Wyszukano {fmtDate(offers.fetchedAt)}.
            {stats.length > 0 && <> Odrzucone: {stats.map(([k, v]) => `${k} ${v}`).join(', ')}.</>}
          </div>
          {offers.errors.map((e) => (
            <div key={e} className="callout warn small">{e}</div>
          ))}
          {items.length === 0 && (
            <div className="callout info small">
              Brak ofert spełniających wszystkie Twoje preferencje.
              {excluded.length > 0 ? ' Poniżej są dopasowane oferty, które odpadły przez filtry — może warto je poluzować.' : ' Spróbuj zwiększyć promień, dopuścić pracę zdalną albo inne formy umowy.'}
            </div>
          )}
          {shown.map((l) => (
            <OfferRow key={l.id} lead={l} onMakeCv={onMakeCv} />
          ))}
          <div className="row">
            {items.length > 6 && (
              <button className="btn ghost sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Pokaż mniej' : `Pokaż wszystkie (${items.length})`}
              </button>
            )}
            {weak.length > 0 && (
              <button className="btn ghost sm" onClick={() => setShowWeak(!showWeak)}>
                {showWeak ? 'Ukryj słabiej dopasowane' : `Pokaż słabiej dopasowane (${weak.length})`}
              </button>
            )}
          </div>
          {excluded.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowExcluded(!showExcluded)}>
                {showExcluded ? 'Ukryj oferty poza Twoimi filtrami' : `Pokaż dopasowane oferty poza Twoimi filtrami (${excluded.length})`}
              </button>
              {(showExcluded || items.length === 0) && excluded.map((l) => <OfferRow key={l.id} lead={l} onMakeCv={onMakeCv} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CareerPage() {
  const { current, settings } = useApp();
  const pid = current!.id;
  const canSearch = !!settings?.jobSearch;
  const nav = useNavigate();
  const [career, setCareer] = useState<Career | null>(null);
  const [tab, setTab] = useState<'chat' | 'offers'>('chat');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [searching, setSearching] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    api
      .career(pid)
      .then((c) => {
        setCareer(c);
        if (c.proposals && c.done) setTab('offers');
      })
      .catch((e) => setError(e.message));
  }, [pid]);

  // Wpisany tekst przeżywa zmianę zakładki i odświeżenie strony.
  const draftKey = `cvmaker.careerDraft.${pid}`;
  const [draft, setDraftState] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  });
  const setDraft = (t: string) => {
    setDraftState(t);
    try {
      if (t) localStorage.setItem(draftKey, t);
      else localStorage.removeItem(draftKey);
    } catch {
      /* bez localStorage szkic żyje do odświeżenia strony */
    }
  };
  const [chatError, setChatError] = useState<string | null>(null);

  const send = async (message: string) => {
    if (!career) return;
    const text = message.trim();
    setChatError(null);
    setSending(true);
    // Wiadomość widać od razu, zanim odpowie doradca.
    if (text) {
      setCareer({ ...career, chat: [...career.chat, { role: 'user', content: text, at: new Date().toISOString() }] });
      setDraft('');
    }
    try {
      setCareer(await api.careerChat(pid, message));
    } catch (e: any) {
      // Serwer zapisuje wiadomość przed zapytaniem AI — sprawdzamy, czy do niego dotarła.
      const fresh = await api.career(pid).catch(() => null);
      const saved = !!fresh && fresh.chat.at(-1)?.role === 'user' && fresh.chat.at(-1)?.content === text;
      if (fresh) setCareer(fresh);
      else setCareer(career);
      if (text && !saved) {
        setDraft(text);
        setChatError(
          fresh
            ? `Wiadomość nie została wysłana (${e.message}). Tekst jest z powrotem w polu poniżej — spróbuj wysłać ponownie.`
            : 'Brak połączenia z programem — sprawdź, czy okno start.bat jest otwarte. Twój tekst jest z powrotem w polu poniżej.',
        );
      } else setChatError(`Doradca nie odpowiedział: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  // Pierwsze wejście: doradca sam zaczyna rozmowę.
  useEffect(() => {
    if (career && career.chat.length === 0 && !opened.current && tab === 'chat') {
      opened.current = true;
      send('');
    }
  }, [career, tab]);

  const reset = async () => {
    if (!confirm('Zacząć rozmowę od nowa? Preferencje i zapisane w profilu informacje zostaną.')) return;
    const c = await api.careerReset(pid);
    opened.current = false;
    setCareer(c);
  };

  const proposals = async () => {
    setError(null);
    setBusy('Dobieram stanowiska do Twojego profilu…');
    let roles: RoleProposal[] = [];
    try {
      const c = await api.careerProposals(pid);
      setCareer(c);
      setTab('offers');
      roles = c.proposals?.roles ?? [];
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
    // Od razu szukamy ofert dla wszystkich stanowisk — wyniki pojawiają się kolejno.
    if (roles.length && canSearch) await searchAll(roles);
  };

  const searchOffers = async (roleId: string) => {
    setError(null);
    setSearching((s) => new Set(s).add(roleId));
    try {
      const c = await api.careerOffers(pid, roleId);
      setCareer((prev) => (prev ? { ...prev, offers: { ...prev.offers, [roleId]: c.offers[roleId] } } : c));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching((s) => {
        const n = new Set(s);
        n.delete(roleId);
        return n;
      });
    }
  };

  const searchAll = async (roles: RoleProposal[] = career?.proposals?.roles ?? []) => {
    // Po dwa stanowiska naraz — szybciej, a portale nie dostają zbyt wielu zapytań jednocześnie.
    const queue = [...roles];
    await Promise.all([0, 1].map(async () => {
      while (queue.length) await searchOffers(queue.shift()!.id);
    }));
  };

  const makeCv = async (lead: JobLead) => {
    setError(null);
    setBusy('Pobieram i analizuję ogłoszenie…');
    try {
      const app = await api.createApplication(pid, lead.url, '');
      nav(`/app/${app.id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  };

  if (!career) return <div className="container">{error ? <ErrorBox error={error} /> : 'Ładowanie…'}</div>;
  const roles = career.proposals?.roles ?? [];

  return (
    <div className="container wide" style={{ maxWidth: 1240 }}>
      {busy && <Busy message={busy} />}
      <div className="page-head">
        <div>
          <h1>Szukaj pracy</h1>
          <p className="sub">Porozmawiaj z doradcą AI o tym, czego szukasz — potem dostaniesz propozycje stanowisk z gotowymi linkami do wyszukiwania na pracuj.pl, justjoin.it i nofluffjobs.</p>
        </div>
        <button className="btn primary" onClick={proposals} disabled={sending}>
          {career.proposals ? 'Zaproponuj stanowiska od nowa' : 'Pokaż propozycje pracy'}
        </button>
      </div>
      <div className="stack">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {career.done && !career.proposals && (
          <div className="callout good row between">
            <span>Doradca ma już wystarczająco informacji.</span>
            <button className="btn sm primary" onClick={proposals}>
              Pokaż propozycje pracy
            </button>
          </div>
        )}
        <div className="tabs" role="tablist">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')} role="tab" aria-selected={tab === 'chat'}>
            Rozmowa
          </button>
          <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')} role="tab" aria-selected={tab === 'offers'}>
            Propozycje i oferty{roles.length ? ` (${roles.length})` : ''}
          </button>
        </div>

        {tab === 'chat' && (
          <div className="career-layout">
            <ChatPanel
              career={career}
              sending={sending}
              draft={draft}
              setDraft={setDraft}
              error={chatError}
              onSend={send}
              onRetry={() => send('')}
              onReset={reset}
            />
            <div className="stack">
              <PrefsPanel prefs={career.prefs} onSave={async (p) => setCareer(await api.careerPrefs(pid, p))} />
              {career.summary && (
                <div className="card">
                  <h3>Co doradca o Tobie wie</h3>
                  <p className="small" style={{ marginTop: 8 }}>{career.summary}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'offers' &&
          (!career.proposals ? (
            <div className="card empty">
              <h2>Jeszcze nie ma propozycji</h2>
              <p style={{ maxWidth: 520 }}>
                Najlepiej najpierw porozmawiaj z doradcą (kilka minut), ale propozycje możesz wygenerować w każdej chwili — na podstawie profilu i preferencji.
              </p>
              <button className="btn primary lg" onClick={proposals}>
                Pokaż propozycje pracy
              </button>
            </div>
          ) : (
            <div className="stack lg">
              <div className="card row between">
                <p style={{ flex: 1, minWidth: 240 }}>{career.proposals.intro}</p>
                {canSearch && (
                  <button className="btn" onClick={() => searchAll()} disabled={searching.size > 0}>
                    Szukaj ofert dla wszystkich
                  </button>
                )}
              </div>
              {!canSearch && (
                <div className="callout info small">
                  Przy każdym stanowisku są linki do wyszukiwarek portali. Znalezioną ofertę wklej w <Link to="/new">Nowe CV</Link>. Automatyczne wyszukiwanie i ocenę ofert na nofluffjobs możesz włączyć w <Link to="/settings">Ustawieniach</Link>.
                </div>
              )}
              {roles.map((r) => (
                <RoleCard
                  key={r.id}
                  role={r}
                  prefs={career.prefs}
                  offers={career.offers[r.id]}
                  canSearch={canSearch}
                  searching={searching.has(r.id)}
                  onSearch={() => searchOffers(r.id)}
                  onMakeCv={makeCv}
                />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
