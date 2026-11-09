import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Profile, Pronoun } from '../../../shared/schemas';
import { githubUserFromLinks } from '../../../shared/github';
import { api } from '../api';
import { useApp } from '../ctx';
import { Busy, ErrorBox, Field, LazyText, PRONOUNS } from '../components/ui';
import { plFew, useT } from '../i18n';

const rid = () => Math.random().toString(36).slice(2, 12);

/** Po tylu ms od ostatniej zmiany profil zapisuje się sam. */
const AUTOSAVE_MS = 1000;

/** Lista jako tekst "jedna pozycja w linii" - zatwierdzana po wyjściu z pola. */
function LinesField({ value, onChange, rows = 3, placeholder }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  return (
    <LazyText
      multiline
      rows={rows}
      placeholder={placeholder}
      value={value.join('\n')}
      onCommit={(t) => onChange(t.split('\n').map((s) => s.trim()).filter(Boolean))}
    />
  );
}

function CommaField({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <LazyText
      value={value.join(', ')}
      placeholder={placeholder}
      onCommit={(t) => onChange(t.split(',').map((s) => s.trim()).filter(Boolean))}
    />
  );
}

function ListSection<T extends { id: string }>({
  title,
  hint,
  items,
  onChange,
  make,
  render,
  newIds,
  newLabel,
  addLabel,
}: {
  title: string;
  hint?: string;
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode;
  newIds: Set<string>;
  /** plakietka przy nowych pozycjach, np. „nowe z CV” */
  newLabel: string;
  addLabel: string;
}) {
  const { t } = useT();
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {hint && <p className="faint">{hint}</p>}
        </div>
        <button className="btn sm" onClick={() => onChange([...items, make()])}>
          + {addLabel}
        </button>
      </div>
      <div className="stack">
        {items.length === 0 && <p className="faint">{t('Brak pozycji.')}</p>}
        {items.map((it, i) => (
          <div key={it.id} className={`entry-card ${newIds.has(it.id) ? 'new-item' : ''}`}>
            {newIds.has(it.id) && <span className="badge good" style={{ alignSelf: 'flex-start' }}>{newLabel}</span>}
            {render(it, (patch) => onChange(items.map((x) => (x.id === it.id ? { ...x, ...patch } : x))))}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title={t('W górę')}>↑</button>
              <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} title={t('W dół')}>↓</button>
              <button className="btn ghost sm danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
                {t('Usuń')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dates({ start, end, current, set }: { start: string; end: string; current: boolean; set: (p: { start?: string; end?: string; current?: boolean }) => void }) {
  const { t } = useT();
  return (
    <div className="grid3">
      <Field label={t('Od (RRRR-MM)')}>
        <input type="text" value={start} onChange={(e) => set({ start: e.target.value })} placeholder="2024-03" />
      </Field>
      <Field label={t('Do (RRRR-MM)')}>
        <input type="text" value={current ? '' : end} disabled={current} onChange={(e) => set({ end: e.target.value })} placeholder="2025-06" />
      </Field>
      <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
        <input type="checkbox" checked={current} onChange={(e) => set({ current: e.target.checked, end: e.target.checked ? '' : end })} /> {t('trwa obecnie')}
      </label>
    </div>
  );
}

export function ProfilePage() {
  const { t } = useT();
  const { current, reloadProfiles } = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Skąd są nowe pozycje (plakietka przy nich).
  const [newFrom, setNewFrom] = useState<'cv' | 'github'>('cv');
  // Pole GitHuba; null = jeszcze nieruszone, podpowiadamy konto z linków w profilu.
  const [github, setGithub] = useState<string | null>(null);
  const [photoBust, setPhotoBust] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // Autozapis. `latest` to aktualny stan formularza; `rev` liczy zmiany użytkownika,
  // `queuedRev` to ostatnia wysłana do zapisu, `savedRev` ostatnia zapisana. Zapisy idą po kolei.
  const latest = useRef<Profile | null>(null);
  const rev = useRef(0);
  const queuedRev = useRef(0);
  const savedRev = useRef(0);
  const chain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Ids odpowiedzi (extraFacts), które formularz już widział. Serwer zachowa te, których nie zna
  // (np. dopisane w tym czasie przez doradcę kariery), a usunięte tutaj usunie.
  const knownFacts = useRef<Set<string>>(new Set());

  /** Zmiana formularza bez zapisu (np. dane, które serwer już ma). */
  const local = (fn: (x: Profile) => Profile) => {
    if (!latest.current) return;
    latest.current = fn(latest.current);
    setP(latest.current);
  };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const snap = latest.current;
    const r = rev.current;
    if (!snap || r === queuedRev.current) return chain.current;
    queuedRev.current = r;
    setSaveState('saving');
    for (const f of snap.extraFacts) knownFacts.current.add(f.id);
    const body: Profile & { extraFactsBase: string[] } = { ...snap, extraFactsBase: [...knownFacts.current] };
    chain.current = chain.current.then(async () => {
      try {
        const saved = await api.saveProfile(snap.id, body);
        savedRev.current = Math.max(savedRev.current, r);
        // Z odpowiedzi bierzemy tylko listę plików (import CV dopisuje plik) i nowe odpowiedzi z serwera:
        // użytkownik mógł w tym czasie pisać dalej.
        if (latest.current?.id === snap.id) {
          const cur = latest.current;
          const fresh = saved.extraFacts.filter((f) => !knownFacts.current.has(f.id) && !cur.extraFacts.some((x) => x.id === f.id));
          for (const f of fresh) knownFacts.current.add(f.id);
          latest.current = { ...cur, files: saved.files, extraFacts: [...cur.extraFacts, ...fresh] };
          setP(latest.current);
        }
        if (rev.current === savedRev.current) setSaveState('saved');
        reloadProfiles().catch(() => {});
      } catch (e: any) {
        // Następny flush (kolejna zmiana albo „Spróbuj ponownie”) wyśle zapis jeszcze raz.
        if (queuedRev.current === r) queuedRev.current = -1;
        setSaveState('error');
        setError(e.message);
      }
    });
    return chain.current;
  }, [reloadProfiles]);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    api
      .profile(current.id)
      .then((x) => {
        if (!alive) return;
        latest.current = x;
        knownFacts.current = new Set(x.extraFacts.map((f) => f.id));
        setGithub(null);
        queuedRev.current = savedRev.current = rev.current;
        setP(x);
        setSaveState('idle');
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      // Wyjście ze strony albo zmiana profilu: zapisujemy to, co zostało wpisane.
      flush();
    };
  }, [current?.id, flush]);

  // Zapis także przy wyjściu z okna lub karty; zamknięcie karty przed zapisem pyta o potwierdzenie.
  useEffect(() => {
    const blur = () => void flush();
    const hidden = () => document.visibilityState === 'hidden' && flush();
    const leave = (e: BeforeUnloadEvent) => {
      if (rev.current === savedRev.current) return;
      flush();
      e.preventDefault();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', leave);
    };
  }, [flush]);

  if (!p || !current) return <div className="container">{error ? <ErrorBox error={error} /> : t('Ładowanie…')}</div>;

  const set = (patch: Partial<Profile>) => {
    local((x) => ({ ...x, ...patch }));
    rev.current++;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };

  const importFile = async (file: File) => {
    setError(null);
    setBusy(t('Czytam Twoje CV i wypełniam profil…'));
    try {
      // Serwer buduje propozycję z zapisanego profilu, więc najpierw zapisujemy ręczne zmiany.
      await flush();
      if (rev.current !== savedRev.current) throw new Error(t('Nie udało się zapisać zmian w profilu, więc CV nie zostało wczytane. Spróbuj ponownie.'));
      const { mode, proposal, newIds } = await api.importCv(p.id, file);
      // Propozycja trafia do bieżącego stanu formularza i od razu się zapisuje (import kosztuje).
      set(proposal);
      flush();
      setNewIds(new Set(newIds));
      setNewFrom('cv');
      setInfo(
        mode === 'new'
          ? t('AI wypełniło profil na podstawie CV i zapisało go. Sprawdź dane i popraw, co trzeba.')
          : t('AI połączyło nowe CV z profilem i zapisało zmiany. Nowe pozycje są oznaczone na zielono - sprawdź je.'),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const githubInput = github ?? githubUserFromLinks(p.contact.links);

  const importGithub = async () => {
    const username = githubInput.trim();
    if (!username || busy) return;
    setError(null);
    setInfo(null);
    setBusy(t('Czytam projekty z GitHuba…'));
    try {
      // Serwer dopisuje projekty do zapisanego profilu, więc najpierw zapisujemy ręczne zmiany.
      await flush();
      if (rev.current !== savedRev.current) throw new Error(t('Nie udało się zapisać zmian w profilu, więc projekty z GitHuba nie zostały dodane. Spróbuj ponownie.'));
      const { profile: saved, added, newIds: ids } = await api.importGithub(p.id, username);
      const cur = latest.current;
      if (!cur || cur.id !== saved.id) return;
      if (rev.current === savedRev.current) {
        // Serwer już zapisał profil: jego wersja staje się stanem formularza, więc następny autozapis nie cofnie projektów.
        for (const f of saved.extraFacts) knownFacts.current.add(f.id);
        latest.current = saved;
        setP(saved);
        setSaveState('saved');
      } else {
        // Zmiany wpisane w trakcie importu zostają: dokładamy do nich nowe pozycje i zapisujemy całość.
        const fresh = new Set(ids);
        set({
          projects: [...cur.projects, ...saved.projects.filter((x) => fresh.has(x.id))],
          skills: [...cur.skills, ...saved.skills.filter((x) => fresh.has(x.id))],
          contact: { ...cur.contact, links: [...cur.contact.links, ...saved.contact.links.filter((l) => !cur.contact.links.some((x) => x.url === l.url))] },
        });
      }
      reloadProfiles().catch(() => {});
      setNewIds(new Set(ids));
      setNewFrom('github');
      const n = added.projects.length;
      const k = added.skills.length;
      const projects = n === 1 ? t('1 projekt') : plFew(n) ? t('{n} projekty', { n }) : t('{n} projektów', { n });
      const skills = k === 1 ? t('1 umiejętność') : t('{n} umiejętności', { n: k });
      setInfo(
        !n
          ? t('Wszystkie projekty z GitHuba są już w profilu - nie ma nic nowego do dodania.')
          : `${k ? t('Dodano {projects} i {skills} z GitHuba.', { projects, skills }) : t('Dodano {projects} z GitHuba.', { projects })} ${t('Nowe pozycje są oznaczone na zielono - sprawdź je.')}`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    setError(null);
    // Serwer zmniejsza duże zdjęcie (ok. 600×750 px), żeby PDF nie ważył kilku MB - to chwilę trwa.
    setBusy(t('Zapisuję zdjęcie…'));
    try {
      // Po zapisie w toku, żeby zapis formularza nie cofnął zdjęcia na serwerze.
      await flush();
      const saved = await api.uploadPhoto(p.id, file);
      local((x) => ({ ...x, photo: saved.photo }));
      setPhotoBust(String(Date.now()));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const deletePhoto = async () => {
    setError(null);
    try {
      await flush();
      await api.deletePhoto(p.id);
      local((x) => ({ ...x, photo: '' }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveStatus =
    saveState === 'saving' ? (
      <span className="badge">{t('zapisuję…')}</span>
    ) : saveState === 'saved' ? (
      <span className="badge good">{t('zapisano')}</span>
    ) : saveState === 'error' ? (
      <>
        <span className="badge bad">{t('nie zapisano')}</span>
        <button className="btn sm" onClick={() => flush()}>
          {t('Spróbuj ponownie')}
        </button>
      </>
    ) : (
      <span className="faint">{t('Zmiany zapisują się same.')}</span>
    );

  const empty = !p.experience.length && !p.education.length && !p.skills.length;
  const newLabel = newFrom === 'github' ? t('nowe z GitHuba') : t('nowe z CV');

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      {busy && <Busy message={busy} />}
      <div className="page-head">
        <div>
          <h1>{t('Mój profil')}</h1>
          <p className="sub">{t('Wszystko, co o Tobie wie program. AI wybiera z tego to, co pasuje do danego ogłoszenia - im więcej szczegółów, tym lepsze CV.')}</p>
        </div>
        <div className="row" role="status" aria-live="polite">
          {saveStatus}
        </div>
      </div>

      <div className="stack lg">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {info && <div className="callout good">{info}</div>}

        <div className="card">
          <h2>{empty ? t('Krok 1: wgraj swoje obecne CV') : t('Wgraj nowsze CV')}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {t('PDF albo DOCX. Plik zostaje zapisany w profilu, a AI przepisze z niego dane do formularza poniżej.')}
            {!empty && ' ' + t('Nowe informacje zostaną dołączone do obecnego profilu - niczego nie usuwamy.')}
          </p>
          {/* Pole jak przycisk: Tab, Enter i Spacja otwierają wybór pliku; przeciąganie pliku działa jak dotąd. */}
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            style={{ marginTop: 12 }}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) importFile(f);
            }}
          >
            <b>{t('Kliknij albo przeciągnij tutaj plik CV')}</b>
            <div className="faint">{t('PDF, DOCX lub TXT, do 12 MB')}</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
          {p.files.length > 0 && <p className="faint" style={{ marginTop: 8 }}>{t('Wgrane pliki: {files}', { files: p.files.map((f) => f.original).join(', ') })}</p>}
        </div>

        <div className="card">
          <h2>{t('Projekty z GitHuba')}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {t('Wpisz nazwę użytkownika albo link do profilu. Program czyta tylko publiczne repozytoria (bez forków, do 10 ostatnio zmienianych), a do profilu trafiają wyłącznie fakty z ich opisów i plików README. Istniejących projektów nie zmieniamy.')}
          </p>
          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              importGithub();
            }}
          >
            <input
              type="text"
              style={{ flex: 1, minWidth: 200 }}
              value={githubInput}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="github.com/jan-kowalski"
              aria-label={t('Nazwa użytkownika albo link do profilu na GitHubie')}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn" disabled={!githubInput.trim() || !!busy}>
              {t('Dodaj projekty z GitHuba')}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>{t('Dane kontaktowe')}</h2>
          <div className="grid2" style={{ marginTop: 12 }}>
            <Field label={t('Imię i nazwisko')}>
              <input type="text" value={p.contact.fullName} onChange={(e) => set({ contact: { ...p.contact, fullName: e.target.value } })} />
            </Field>
            <Field label={t('Jak się określasz?')} hint={t('Od tego zależą formy, którymi AI się do Ciebie zwraca, np. „wykonywałeś”, „wykonywałaś”, „wykonywałoś”.')}>
              <select value={p.pronouns ?? ''} onChange={(e) => set({ pronouns: (e.target.value || undefined) as Pronoun | undefined })}>
                <option value="">{t('nie podano (AI pisze bez form z rodzajem)')}</option>
                {PRONOUNS.map((x) => (
                  <option key={x} value={x}>
                    {t(x)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('E-mail')}>
              <input type="email" value={p.contact.email} onChange={(e) => set({ contact: { ...p.contact, email: e.target.value } })} />
            </Field>
            <Field label={t('Telefon')}>
              <input type="tel" value={p.contact.phone} onChange={(e) => set({ contact: { ...p.contact, phone: e.target.value } })} />
            </Field>
            <Field label={t('Miejscowość')}>
              <input type="text" value={p.contact.location} onChange={(e) => set({ contact: { ...p.contact, location: e.target.value } })} />
            </Field>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            <span className="small muted" style={{ fontWeight: 500 }}>{t('Linki (LinkedIn, GitHub, portfolio)')}</span>
            {p.contact.links.map((l, i) => (
              <div key={i} className="row">
                <input type="text" style={{ width: 140 }} value={l.label} placeholder="LinkedIn" onChange={(e) => set({ contact: { ...p.contact, links: p.contact.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
                <input type="url" style={{ flex: 1, minWidth: 180 }} value={l.url} placeholder="https://…" onChange={(e) => set({ contact: { ...p.contact, links: p.contact.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) } })} />
                <button className="icon-btn" onClick={() => set({ contact: { ...p.contact, links: p.contact.links.filter((_, j) => j !== i) } })} aria-label={t('Usuń link')}>✕</button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ contact: { ...p.contact, links: [...p.contact.links, { label: '', url: '' }] } })}>
              + {t('Link')}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>{t('Zdjęcie')}</h2>
              <p className="faint">{t('Opcjonalne. Program sam zdecyduje przy każdym ogłoszeniu, czy je dodać (polskie oferty - tak, zagraniczne - nie).')}</p>
            </div>
          </div>
          <div className="row">
            {p.photo ? (
              <img src={api.photoUrl(p.id, photoBust)} alt={t('Zdjęcie profilowe')} style={{ width: 84, height: 105, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
            ) : (
              <div className="faint">{t('Brak zdjęcia')}</div>
            )}
            <button className="btn sm" onClick={() => photoRef.current?.click()}>
              {p.photo ? t('Zmień zdjęcie') : t('Dodaj zdjęcie')}
            </button>
            {p.photo && (
              <button className="btn ghost sm danger" onClick={deletePhoto}>
                {t('Usuń')}
              </button>
            )}
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="card">
          <h2>{t('Kim jesteś')}</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            <Field label={t('Nagłówek')} hint={t('Np. „Student informatyki, 3. rok” - AI i tak dopasuje go do każdego ogłoszenia.')}>
              <input type="text" value={p.headline} onChange={(e) => set({ headline: e.target.value })} />
            </Field>
            <Field label={t('Krótko o sobie')}>
              <textarea rows={3} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />
            </Field>
          </div>
        </div>

        <ListSection
          title={t('Doświadczenie')}
          hint={t('Praca, staże, praktyki, wolontariat, zlecenia. Wpisz wszystko - AI wybierze to, co pasuje.')}
          items={p.experience}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Pozycja')}
          onChange={(experience) => set({ experience })}
          make={() => ({ id: rid(), kind: 'praca' as const, role: '', company: '', location: '', start: '', end: '', current: false, description: '', achievements: [] })}
          render={(x, s) => (
            <>
              <div className="grid3">
                <Field label={t('Stanowisko')}><input type="text" value={x.role} onChange={(e) => s({ role: e.target.value })} /></Field>
                <Field label={t('Firma')}><input type="text" value={x.company} onChange={(e) => s({ company: e.target.value })} /></Field>
                <Field label={t('Rodzaj')}>
                  <select value={x.kind} onChange={(e) => s({ kind: e.target.value as typeof x.kind })}>
                    {/* Wartość zostaje po polsku (zapisywana w profilu), tłumaczymy tylko napis. */}
                    {['praca', 'staż', 'praktyki', 'wolontariat', 'freelance', 'inne'].map((k) => <option key={k} value={k}>{t(k)}</option>)}
                  </select>
                </Field>
              </div>
              <Field label={t('Miejscowość')}><input type="text" value={x.location} onChange={(e) => s({ location: e.target.value })} /></Field>
              <Dates start={x.start} end={x.end} current={x.current} set={s} />
              <Field label={t('Opis (opcjonalnie)')}><textarea rows={2} value={x.description} onChange={(e) => s({ description: e.target.value })} /></Field>
              <Field label={t('Obowiązki i osiągnięcia')} hint={t('Jedna rzecz w linii. Liczby są bardzo cenne (np. „obsługa 40 klientów dziennie”).')}>
                <LinesField value={x.achievements} onChange={(achievements) => s({ achievements })} rows={4} />
              </Field>
            </>
          )}
        />

        <ListSection
          title={t('Projekty')}
          hint={t('Studenckie, własne, z kół naukowych, hackathony. Dla juniora to często najmocniejsza część CV.')}
          items={p.projects}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Projekt')}
          onChange={(projects) => set({ projects })}
          make={() => ({ id: rid(), name: '', role: '', start: '', end: '', description: '', technologies: [], link: '', achievements: [] })}
          render={(x, s) => (
            <>
              <div className="grid2">
                <Field label={t('Nazwa')}><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
                <Field label={t('Twoja rola')}><input type="text" value={x.role} onChange={(e) => s({ role: e.target.value })} /></Field>
              </div>
              <div className="grid2">
                <Field label={t('Od')}><input type="text" value={x.start} onChange={(e) => s({ start: e.target.value })} placeholder="2024-10" /></Field>
                <Field label={t('Do')}><input type="text" value={x.end} onChange={(e) => s({ end: e.target.value })} placeholder="2025-01" /></Field>
              </div>
              <Field label={t('Opis')}><textarea rows={2} value={x.description} onChange={(e) => s({ description: e.target.value })} /></Field>
              <Field label={t('Technologie / narzędzia (po przecinku)')}><CommaField value={x.technologies} onChange={(technologies) => s({ technologies })} /></Field>
              <Field label={t('Link')}><input type="url" value={x.link} onChange={(e) => s({ link: e.target.value })} /></Field>
              <Field label={t('Zadania i efekty (jedno w linii)')}><LinesField value={x.achievements} onChange={(achievements) => s({ achievements })} /></Field>
            </>
          )}
        />

        <ListSection
          title={t('Wykształcenie')}
          items={p.education}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Szkoła')}
          onChange={(education) => set({ education })}
          make={() => ({ id: rid(), school: '', degree: '', field: '', start: '', end: '', current: false, details: '' })}
          render={(x, s) => (
            <>
              <div className="grid3">
                <Field label={t('Uczelnia / szkoła')}><input type="text" value={x.school} onChange={(e) => s({ school: e.target.value })} /></Field>
                <Field label={t('Stopień')}><input type="text" value={x.degree} onChange={(e) => s({ degree: e.target.value })} placeholder={t('licencjat')} /></Field>
                <Field label={t('Kierunek')}><input type="text" value={x.field} onChange={(e) => s({ field: e.target.value })} /></Field>
              </div>
              <Dates start={x.start} end={x.end} current={x.current} set={s} />
              <Field label={t('Szczegóły')} hint={t('Specjalizacja, ważne przedmioty, praca dyplomowa, koła naukowe, średnia.')}><textarea rows={2} value={x.details} onChange={(e) => s({ details: e.target.value })} /></Field>
            </>
          )}
        />

        <ListSection
          title={t('Umiejętności')}
          items={p.skills}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Umiejętność')}
          onChange={(skills) => set({ skills })}
          make={() => ({ id: rid(), name: '', category: 'techniczne' as const, level: '' })}
          render={(x, s) => (
            <div className="grid3">
              <Field label={t('Nazwa')}><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label={t('Kategoria')}>
                <select value={x.category} onChange={(e) => s({ category: e.target.value as typeof x.category })}>
                  {['techniczne', 'narzędzia', 'miękkie', 'inne'].map((k) => <option key={k} value={k}>{t(k)}</option>)}
                </select>
              </Field>
              <Field label={t('Poziom (opcjonalnie)')}><input type="text" value={x.level} onChange={(e) => s({ level: e.target.value })} placeholder={t('średni')} /></Field>
            </div>
          )}
        />

        <ListSection
          title={t('Języki obce')}
          items={p.languages}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Język')}
          onChange={(languages) => set({ languages })}
          make={() => ({ id: rid(), name: '', level: '' })}
          render={(x, s) => (
            <div className="grid2">
              <Field label={t('Język')}><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label={t('Poziom (A1–C2)')}><input type="text" value={x.level} onChange={(e) => s({ level: e.target.value })} placeholder="B2" /></Field>
            </div>
          )}
        />

        <ListSection
          title={t('Certyfikaty, kursy, szkolenia')}
          items={p.certificates}
          newIds={newIds}
          newLabel={newLabel}
          addLabel={t('Pozycja')}
          onChange={(certificates) => set({ certificates })}
          make={() => ({ id: rid(), kind: 'kurs' as const, name: '', issuer: '', date: '' })}
          render={(x, s) => (
            <div className="grid3">
              <Field label={t('Nazwa')}><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label={t('Wystawca')}><input type="text" value={x.issuer} onChange={(e) => s({ issuer: e.target.value })} /></Field>
              <Field label={t('Data')}><input type="text" value={x.date} onChange={(e) => s({ date: e.target.value })} placeholder="2025-05" /></Field>
            </div>
          )}
        />

        <div className="card">
          <h2>{t('Zainteresowania')}</h2>
          <div style={{ marginTop: 10 }}>
            <CommaField value={p.interests} onChange={(interests) => set({ interests })} placeholder={t('np. fotografia, bieganie, gry planszowe')} />
          </div>
        </div>

        <div className="card">
          <h2>{t('Twoje odpowiedzi na pytania AI')}</h2>
          <p className="faint" style={{ marginTop: 4 }}>
            {t('Gdy ogłoszenie wymaga czegoś, czego nie było w profilu, AI pyta, a odpowiedzi zapisują się tutaj i są używane w kolejnych CV.')}
          </p>
          <div className="stack" style={{ marginTop: 12 }}>
            {p.extraFacts.length === 0 && <p className="faint">{t('Na razie brak.')}</p>}
            {p.extraFacts.map((f) => (
              <div key={f.id} className="entry-card">
                <div className="row between">
                  <b>{f.topic}</b>
                  <div className="row">
                    <span className={`badge ${f.has ? 'good' : ''}`}>{f.has ? t('znam') : t('nie znam')}</span>
                    <button className="icon-btn" onClick={() => set({ extraFacts: p.extraFacts.filter((x) => x.id !== f.id) })} aria-label={t('Usuń')}>✕</button>
                  </div>
                </div>
                <textarea rows={2} value={f.answer} onChange={(e) => set({ extraFacts: p.extraFacts.map((x) => (x.id === f.id ? { ...x, answer: e.target.value } : x)) })} />
                <span className="faint">{f.source} · {f.date}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>{t('Własny klucz OpenRouter (opcjonalnie)')}</h2>
          <p className="faint" style={{ marginTop: 4 }}>
            {t('Jeśli ten profil ma płacić ze swojego konta (np. profil kolegi), wklej tu jego klucz. Puste = używany jest klucz z Ustawień.')}
          </p>
          <input type="password" style={{ marginTop: 10 }} value={p.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-or-…" autoComplete="off" />
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {saveStatus}
        </div>
      </div>
    </div>
  );
}
