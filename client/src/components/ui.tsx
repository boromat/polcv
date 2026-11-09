import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pronoun } from '../../../shared/schemas';
import { goworkSearchUrl } from '../../../shared/gowork';
import { getLang, useT } from '../i18n';

/** Po tylu sekundach podpowiedź o zwykłym czasie pracy AI przestaje być prawdą. */
const LONG_WAIT_S = 60;

export function Busy({ message, hint }: { message: string; hint?: string }) {
  const { t } = useT();
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  // Zamknięcie lub odświeżenie karty w trakcie pracy pyta o potwierdzenie (wynik AI by przepadł).
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);
  // Kolejne kroki (np. pisanie i ocena CV) liczą się razem, więc po minucie zastępujemy też podpowiedź kroku.
  const text = sec >= LONG_WAIT_S ? t('Jeszcze pracuję - to może potrwać do ok. 3 minut. Nie zamykaj tej strony.') : (hint ?? t('AI pracuje - zwykle trwa to 15-60 sekund.'));
  return (
    <div className="busy-overlay" role="status" aria-live="polite">
      <div className="busy-box">
        <div className="spinner" />
        <h3>{message}</h3>
        <p className="muted small">{text}</p>
        <p className="faint">{sec} s</p>
      </div>
    </div>
  );
}

/** Czy fokus jest w polu, w którym się pisze (tam go nie zabieramy, żeby nie gubić znaków). */
function typingIn(el: Element | null) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

export function ErrorBox({ error, onClose }: { error: string | null; onClose?: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  // Błąd po długiej akcji bywa nad widocznym fragmentem strony: przewijamy do niego i przenosimy fokus.
  useEffect(() => {
    const el = ref.current;
    if (!error || !el) return;
    const active = document.activeElement;
    if (!typingIn(active)) {
      back.current = active instanceof HTMLElement && active !== document.body && !el.contains(active) ? active : null;
      el.focus({ preventScroll: true });
    }
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const r = el.getBoundingClientRect();
    if (r.top < top || r.bottom > window.innerHeight) {
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    }
  }, [error]);
  if (!error) return null;
  // Po zamknięciu fokus wraca tam, skąd go zabraliśmy (np. na przycisk „Napisz CV”).
  const close = () => {
    const el = back.current;
    onClose?.();
    if (el?.isConnected) el.focus();
  };
  return (
    <div ref={ref} tabIndex={-1} className="callout error row between" role="alert">
      <span>{error}</span>
      {onClose && (
        <button className="icon-btn" onClick={close} aria-label={t('Zamknij')}>
          ✕
        </button>
      )}
    </div>
  );
}

/** Kolor wyniku: zielony od 75, żółty od 55. */
export const scoreTone = (s: number | null | undefined) => (s == null ? '' : s >= 75 ? 'good' : s >= 55 ? 'warn' : 'bad');
export const scoreColor = (s: number) => (s >= 75 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');

/** Wynik CV; "niepełna" = raport bez części AI, czyli bez wyniku łącznego. */
export function ScoreBadge({ score, incomplete = false }: { score: number | null | undefined; incomplete?: boolean }) {
  const { t } = useT();
  if (score == null && incomplete) return <span className="badge warn">{t('ocena niepełna')}</span>;
  if (score == null) return <span className="badge">{t('brak oceny')}</span>;
  return <span className={`badge ${scoreTone(score)}`}>{score}/100</span>;
}

/** Opinie o firmie na GoWork.pl: link otwiera wyszukiwanie, program nic z GoWork nie pobiera. */
export function GoworkLink({ company, className }: { company: string; className?: string }) {
  const { t } = useT();
  const url = goworkSearchUrl(company);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={className} title={t('Opinie o firmie na GoWork.pl (wyszukiwanie w Google)')}>
      {t('opinie na GoWork')} ↗
    </a>
  );
}

/** Jak kandydat się określa (te same wartości co Pronouns w shared/schemas; klient importuje stamtąd tylko typy). */
export const PRONOUNS: Pronoun[] = ['on', 'ona', 'ono'];

/** Liczba nowości z profilu na przycisku: starsze wersje CV liczą wszystko od swojego powstania, więc bywa duża. */
export const newsLabel = (n: number) => (n > 9 ? '9+' : String(n));

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

/**
 * Otwiera adres w nowej karcie, gdy `ready` się zakończy (np. zapis zmian przed podglądem PDF).
 * Kartę otwieramy od razu przy kliknięciu, bo po czekaniu przeglądarka mogłaby ją zablokować jako wyskakujące okno.
 */
export async function openWhenReady(ready: Promise<unknown>, url: () => string) {
  const tab = window.open('', '_blank');
  try {
    await ready;
  } catch (e) {
    tab?.close();
    throw e;
  }
  const href = new URL(url(), window.location.href).href;
  if (tab) {
    tab.opener = null;
    tab.location.href = href;
  } else window.open(href, '_blank', 'noopener');
}

/** Pobiera plik bez opuszczania strony (przejście pod adres pliku wywołałoby pytanie z `Busy` o zamknięcie karty). */
export function downloadFile(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
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
