import { useEffect, useState, type ReactNode } from 'react';
import { getLang, useT } from '../i18n';

export function Busy({ message, hint }: { message: string; hint?: string }) {
  const { t } = useT();
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-box">
        <div className="spinner" />
        <h3>{message}</h3>
        <p className="muted small">{hint ?? t('AI pracuje - zwykle trwa to 15–60 sekund.')}</p>
        <p className="faint">{sec} s</p>
      </div>
    </div>
  );
}

export function ErrorBox({ error, onClose }: { error: string | null; onClose?: () => void }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <div className="callout error row between" role="alert">
      <span>{error}</span>
      {onClose && (
        <button className="icon-btn" onClick={onClose} aria-label={t('Zamknij')}>
          ✕
        </button>
      )}
    </div>
  );
}

/** Kolor wyniku: zielony od 75, żółty od 55. */
export const scoreTone = (s: number | null | undefined) => (s == null ? '' : s >= 75 ? 'good' : s >= 55 ? 'warn' : 'bad');
export const scoreColor = (s: number) => (s >= 75 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const { t } = useT();
  if (score == null) return <span className="badge">{t('brak oceny')}</span>;
  return <span className={`badge ${scoreTone(score)}`}>{score}/100</span>;
}

export const usd = (n: number) => {
  const v = n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2);
  return getLang() === 'en' ? `$${v}` : `${v} $`;
};
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="faint">{hint}</span>}
    </label>
  );
}

/** Pole tekstowe, które zapisuje zmianę dopiero po opuszczeniu (mniej zapisów i odświeżeń podglądu). */
export function LazyText({
  value,
  onCommit,
  multiline,
  rows,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return multiline ? (
    <textarea value={v} rows={rows ?? 2} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <input type="text" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  );
}

export const STATUS_LABELS: Record<string, string> = {
  szkic: 'Szkic',
  przygotowane: 'Przygotowane',
  wysłane: 'Wysłane',
  rozmowa: 'Rozmowa',
  odrzucone: 'Odrzucone',
  oferta: 'Oferta',
};
export const STATUSES = Object.keys(STATUS_LABELS);
export const statusTone = (s: string) =>
  s === 'oferta' ? 'good' : s === 'rozmowa' ? 'accent' : s === 'odrzucone' ? 'bad' : s === 'wysłane' ? 'warn' : '';

export const SECTION_LABELS: Record<string, string> = {
  summary: 'Podsumowanie',
  experience: 'Doświadczenie',
  projects: 'Projekty',
  education: 'Wykształcenie',
  skills: 'Umiejętności',
  certificates: 'Certyfikaty i kursy',
  languages: 'Języki',
  interests: 'Zainteresowania',
};

export const TEMPLATES = [
  { id: 'modern', name: 'Nowoczesny', desc: 'Granatowe akcenty, czytelny' },
  { id: 'classic', name: 'Klasyczny', desc: 'Czarno-biały, elegancki' },
  { id: 'compact', name: 'Kompaktowy', desc: 'Więcej treści na stronie' },
] as const;
