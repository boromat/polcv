import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Profile } from '../../../shared/schemas';
import { api } from '../api';
import { useApp } from '../ctx';
import { Busy, ErrorBox, Field, LazyText } from '../components/ui';

const rid = () => Math.random().toString(36).slice(2, 12);

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
  addLabel,
}: {
  title: string;
  hint?: string;
  items: T[];
  onChange: (items: T[]) => void;
  make: () => T;
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode;
  newIds: Set<string>;
  addLabel: string;
}) {
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
        {items.length === 0 && <p className="faint">Brak pozycji.</p>}
        {items.map((it, i) => (
          <div key={it.id} className={`entry-card ${newIds.has(it.id) ? 'new-item' : ''}`}>
            {newIds.has(it.id) && <span className="badge good" style={{ alignSelf: 'flex-start' }}>nowe z CV</span>}
            {render(it, (patch) => onChange(items.map((x) => (x.id === it.id ? { ...x, ...patch } : x))))}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="W górę">↑</button>
              <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="W dół">↓</button>
              <button className="btn ghost sm danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
                Usuń
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const Dates = ({ start, end, current, set }: { start: string; end: string; current: boolean; set: (p: { start?: string; end?: string; current?: boolean }) => void }) => (
  <div className="grid3">
    <Field label="Od (RRRR-MM)">
      <input type="text" value={start} onChange={(e) => set({ start: e.target.value })} placeholder="2024-03" />
    </Field>
    <Field label="Do (RRRR-MM)">
      <input type="text" value={current ? '' : end} disabled={current} onChange={(e) => set({ end: e.target.value })} placeholder="2025-06" />
    </Field>
    <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
      <input type="checkbox" checked={current} onChange={(e) => set({ current: e.target.checked, end: e.target.checked ? '' : end })} /> trwa obecnie
    </label>
  </div>
);

export function ProfilePage() {
  const { current, reloadProfiles } = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [photoBust, setPhotoBust] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (current) api.profile(current.id).then(setP).catch((e) => setError(e.message));
  }, [current?.id]);

  // Ostrzeżenie przy zamykaniu karty z niezapisanymi zmianami.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!p || !current) return <div className="container">{error ? <ErrorBox error={error} /> : 'Ładowanie…'}</div>;

  const set = (patch: Partial<Profile>) => {
    setP({ ...p, ...patch });
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    try {
      const saved = await api.saveProfile(p.id, p);
      setP(saved);
      setDirty(false);
      setNewIds(new Set());
      setInfo('Profil zapisany.');
      setTimeout(() => setInfo(null), 3000);
      await reloadProfiles();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    setBusy('Czytam Twoje CV i wypełniam profil…');
    try {
      const { mode, proposal, newIds } = await api.importCv(p.id, file);
      setP({ ...p, ...proposal });
      setNewIds(new Set(newIds));
      setDirty(true);
      setInfo(
        mode === 'new'
          ? 'AI wypełniło profil na podstawie CV. Sprawdź dane, popraw, co trzeba, i kliknij „Zapisz profil”.'
          : 'AI połączyło nowe CV z profilem. Nowe pozycje są oznaczone na zielono. Sprawdź i kliknij „Zapisz profil”.',
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    setError(null);
    try {
      const saved = await api.uploadPhoto(p.id, file);
      setP({ ...p, photo: saved.photo });
      setPhotoBust(String(Date.now()));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const empty = !p.experience.length && !p.education.length && !p.skills.length;

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      {busy && <Busy message={busy} />}
      <div className="page-head">
        <div>
          <h1>Mój profil</h1>
          <p className="sub">Wszystko, co o Tobie wie program. AI wybiera z tego to, co pasuje do danego ogłoszenia - im więcej szczegółów, tym lepsze CV.</p>
        </div>
        <div className="row">
          {dirty && <span className="badge warn">niezapisane zmiany</span>}
          <button className="btn primary" onClick={save} disabled={!dirty}>
            Zapisz profil
          </button>
        </div>
      </div>

      <div className="stack lg">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {info && <div className="callout good">{info}</div>}

        <div className="card">
          <h2>{empty ? 'Krok 1: wgraj swoje obecne CV' : 'Wgraj nowsze CV'}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            PDF albo DOCX. Plik zostaje zapisany w profilu, a AI przepisze z niego dane do formularza poniżej.
            {!empty && ' Nowe informacje zostaną dołączone do obecnego profilu - niczego nie usuwamy.'}
          </p>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            style={{ marginTop: 12 }}
            onClick={() => fileRef.current?.click()}
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
            <b>Kliknij albo przeciągnij tutaj plik CV</b>
            <div className="faint">PDF, DOCX lub TXT, do 12 MB</div>
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
          {p.files.length > 0 && <p className="faint" style={{ marginTop: 8 }}>Wgrane pliki: {p.files.map((f) => f.original).join(', ')}</p>}
        </div>

        <div className="card">
          <h2>Dane kontaktowe</h2>
          <div className="grid2" style={{ marginTop: 12 }}>
            <Field label="Imię i nazwisko">
              <input type="text" value={p.contact.fullName} onChange={(e) => set({ contact: { ...p.contact, fullName: e.target.value } })} />
            </Field>
            <Field label="E-mail">
              <input type="email" value={p.contact.email} onChange={(e) => set({ contact: { ...p.contact, email: e.target.value } })} />
            </Field>
            <Field label="Telefon">
              <input type="tel" value={p.contact.phone} onChange={(e) => set({ contact: { ...p.contact, phone: e.target.value } })} />
            </Field>
            <Field label="Miejscowość">
              <input type="text" value={p.contact.location} onChange={(e) => set({ contact: { ...p.contact, location: e.target.value } })} />
            </Field>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            <span className="small muted" style={{ fontWeight: 500 }}>Linki (LinkedIn, GitHub, portfolio)</span>
            {p.contact.links.map((l, i) => (
              <div key={i} className="row">
                <input type="text" style={{ width: 140 }} value={l.label} placeholder="LinkedIn" onChange={(e) => set({ contact: { ...p.contact, links: p.contact.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
                <input type="url" style={{ flex: 1, minWidth: 180 }} value={l.url} placeholder="https://…" onChange={(e) => set({ contact: { ...p.contact, links: p.contact.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) } })} />
                <button className="icon-btn" onClick={() => set({ contact: { ...p.contact, links: p.contact.links.filter((_, j) => j !== i) } })} aria-label="Usuń link">✕</button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ contact: { ...p.contact, links: [...p.contact.links, { label: '', url: '' }] } })}>
              + Link
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Zdjęcie</h2>
              <p className="faint">Opcjonalne. Program sam zdecyduje przy każdym ogłoszeniu, czy je dodać (polskie oferty - tak, zagraniczne - nie).</p>
            </div>
          </div>
          <div className="row">
            {p.photo ? (
              <img src={api.photoUrl(p.id, photoBust)} alt="Zdjęcie profilowe" style={{ width: 84, height: 105, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
            ) : (
              <div className="faint">Brak zdjęcia</div>
            )}
            <button className="btn sm" onClick={() => photoRef.current?.click()}>
              {p.photo ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
            </button>
            {p.photo && (
              <button
                className="btn ghost sm danger"
                onClick={async () => {
                  await api.deletePhoto(p.id);
                  setP({ ...p, photo: '' });
                }}
              >
                Usuń
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
          <h2>Kim jesteś</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            <Field label="Nagłówek" hint="Np. „Student informatyki, 3. rok” - AI i tak dopasuje go do każdego ogłoszenia.">
              <input type="text" value={p.headline} onChange={(e) => set({ headline: e.target.value })} />
            </Field>
            <Field label="Krótko o sobie">
              <textarea rows={3} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />
            </Field>
          </div>
        </div>

        <ListSection
          title="Doświadczenie"
          hint="Praca, staże, praktyki, wolontariat, zlecenia. Wpisz wszystko - AI wybierze to, co pasuje."
          items={p.experience}
          newIds={newIds}
          addLabel="Pozycja"
          onChange={(experience) => set({ experience })}
          make={() => ({ id: rid(), kind: 'praca' as const, role: '', company: '', location: '', start: '', end: '', current: false, description: '', achievements: [] })}
          render={(x, s) => (
            <>
              <div className="grid3">
                <Field label="Stanowisko"><input type="text" value={x.role} onChange={(e) => s({ role: e.target.value })} /></Field>
                <Field label="Firma"><input type="text" value={x.company} onChange={(e) => s({ company: e.target.value })} /></Field>
                <Field label="Rodzaj">
                  <select value={x.kind} onChange={(e) => s({ kind: e.target.value as typeof x.kind })}>
                    {['praca', 'staż', 'praktyki', 'wolontariat', 'freelance', 'inne'].map((k) => <option key={k}>{k}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Miejscowość"><input type="text" value={x.location} onChange={(e) => s({ location: e.target.value })} /></Field>
              <Dates start={x.start} end={x.end} current={x.current} set={s} />
              <Field label="Opis (opcjonalnie)"><textarea rows={2} value={x.description} onChange={(e) => s({ description: e.target.value })} /></Field>
              <Field label="Obowiązki i osiągnięcia" hint="Jedna rzecz w linii. Liczby są bardzo cenne (np. „obsługa 40 klientów dziennie”).">
                <LinesField value={x.achievements} onChange={(achievements) => s({ achievements })} rows={4} />
              </Field>
            </>
          )}
        />

        <ListSection
          title="Projekty"
          hint="Studenckie, własne, z kół naukowych, hackathony. Dla juniora to często najmocniejsza część CV."
          items={p.projects}
          newIds={newIds}
          addLabel="Projekt"
          onChange={(projects) => set({ projects })}
          make={() => ({ id: rid(), name: '', role: '', start: '', end: '', description: '', technologies: [], link: '', achievements: [] })}
          render={(x, s) => (
            <>
              <div className="grid2">
                <Field label="Nazwa"><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
                <Field label="Twoja rola"><input type="text" value={x.role} onChange={(e) => s({ role: e.target.value })} /></Field>
              </div>
              <div className="grid2">
                <Field label="Od"><input type="text" value={x.start} onChange={(e) => s({ start: e.target.value })} placeholder="2024-10" /></Field>
                <Field label="Do"><input type="text" value={x.end} onChange={(e) => s({ end: e.target.value })} placeholder="2025-01" /></Field>
              </div>
              <Field label="Opis"><textarea rows={2} value={x.description} onChange={(e) => s({ description: e.target.value })} /></Field>
              <Field label="Technologie / narzędzia (po przecinku)"><CommaField value={x.technologies} onChange={(technologies) => s({ technologies })} /></Field>
              <Field label="Link"><input type="url" value={x.link} onChange={(e) => s({ link: e.target.value })} /></Field>
              <Field label="Zadania i efekty (jedno w linii)"><LinesField value={x.achievements} onChange={(achievements) => s({ achievements })} /></Field>
            </>
          )}
        />

        <ListSection
          title="Wykształcenie"
          items={p.education}
          newIds={newIds}
          addLabel="Szkoła"
          onChange={(education) => set({ education })}
          make={() => ({ id: rid(), school: '', degree: '', field: '', start: '', end: '', current: false, details: '' })}
          render={(x, s) => (
            <>
              <div className="grid3">
                <Field label="Uczelnia / szkoła"><input type="text" value={x.school} onChange={(e) => s({ school: e.target.value })} /></Field>
                <Field label="Stopień"><input type="text" value={x.degree} onChange={(e) => s({ degree: e.target.value })} placeholder="licencjat" /></Field>
                <Field label="Kierunek"><input type="text" value={x.field} onChange={(e) => s({ field: e.target.value })} /></Field>
              </div>
              <Dates start={x.start} end={x.end} current={x.current} set={s} />
              <Field label="Szczegóły" hint="Specjalizacja, ważne przedmioty, praca dyplomowa, koła naukowe, średnia."><textarea rows={2} value={x.details} onChange={(e) => s({ details: e.target.value })} /></Field>
            </>
          )}
        />

        <ListSection
          title="Umiejętności"
          items={p.skills}
          newIds={newIds}
          addLabel="Umiejętność"
          onChange={(skills) => set({ skills })}
          make={() => ({ id: rid(), name: '', category: 'techniczne' as const, level: '' })}
          render={(x, s) => (
            <div className="grid3">
              <Field label="Nazwa"><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label="Kategoria">
                <select value={x.category} onChange={(e) => s({ category: e.target.value as typeof x.category })}>
                  {['techniczne', 'narzędzia', 'miękkie', 'inne'].map((k) => <option key={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Poziom (opcjonalnie)"><input type="text" value={x.level} onChange={(e) => s({ level: e.target.value })} placeholder="średni" /></Field>
            </div>
          )}
        />

        <ListSection
          title="Języki obce"
          items={p.languages}
          newIds={newIds}
          addLabel="Język"
          onChange={(languages) => set({ languages })}
          make={() => ({ id: rid(), name: '', level: '' })}
          render={(x, s) => (
            <div className="grid2">
              <Field label="Język"><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label="Poziom (A1–C2)"><input type="text" value={x.level} onChange={(e) => s({ level: e.target.value })} placeholder="B2" /></Field>
            </div>
          )}
        />

        <ListSection
          title="Certyfikaty, kursy, szkolenia"
          items={p.certificates}
          newIds={newIds}
          addLabel="Pozycja"
          onChange={(certificates) => set({ certificates })}
          make={() => ({ id: rid(), kind: 'kurs' as const, name: '', issuer: '', date: '' })}
          render={(x, s) => (
            <div className="grid3">
              <Field label="Nazwa"><input type="text" value={x.name} onChange={(e) => s({ name: e.target.value })} /></Field>
              <Field label="Wystawca"><input type="text" value={x.issuer} onChange={(e) => s({ issuer: e.target.value })} /></Field>
              <Field label="Data"><input type="text" value={x.date} onChange={(e) => s({ date: e.target.value })} placeholder="2025-05" /></Field>
            </div>
          )}
        />

        <div className="card">
          <h2>Zainteresowania</h2>
          <div style={{ marginTop: 10 }}>
            <CommaField value={p.interests} onChange={(interests) => set({ interests })} placeholder="np. fotografia, bieganie, gry planszowe" />
          </div>
        </div>

        <div className="card">
          <h2>Twoje odpowiedzi na pytania AI</h2>
          <p className="faint" style={{ marginTop: 4 }}>
            Gdy ogłoszenie wymaga czegoś, czego nie było w profilu, AI pyta, a odpowiedzi zapisują się tutaj i są używane w kolejnych CV.
          </p>
          <div className="stack" style={{ marginTop: 12 }}>
            {p.extraFacts.length === 0 && <p className="faint">Na razie brak.</p>}
            {p.extraFacts.map((f) => (
              <div key={f.id} className="entry-card">
                <div className="row between">
                  <b>{f.topic}</b>
                  <div className="row">
                    <span className={`badge ${f.has ? 'good' : ''}`}>{f.has ? 'znam' : 'nie znam'}</span>
                    <button className="icon-btn" onClick={() => set({ extraFacts: p.extraFacts.filter((x) => x.id !== f.id) })} aria-label="Usuń">✕</button>
                  </div>
                </div>
                <textarea rows={2} value={f.answer} onChange={(e) => set({ extraFacts: p.extraFacts.map((x) => (x.id === f.id ? { ...x, answer: e.target.value } : x)) })} />
                <span className="faint">{f.source} · {f.date}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Własny klucz OpenRouter (opcjonalnie)</h2>
          <p className="faint" style={{ marginTop: 4 }}>
            Jeśli ten profil ma płacić ze swojego konta (np. profil kolegi), wklej tu jego klucz. Puste = używany jest klucz z Ustawień.
          </p>
          <input type="password" style={{ marginTop: 10 }} value={p.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-or-…" autoComplete="off" />
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary lg" onClick={save} disabled={!dirty}>
            Zapisz profil
          </button>
        </div>
      </div>
    </div>
  );
}
