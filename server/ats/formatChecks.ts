import type { CvContent, Profile, SectionKey } from '../../shared/schemas';
import { sectionLabel } from '../cv/render';
import { normalize } from './keywords';
import { tr } from '../i18n';

export const FORMAT_MAX = 20;

export interface FormatCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** ile punktów odejmuje niezaliczona kontrola */
  weight: number;
  /** część kary, gdy błąd jest mniejszy (np. 2 strony zamiast 1) */
  partial?: number;
}

const DATE_PATTERNS = [/^\d{2}\.\d{4}$/, /^\d{2}\/\d{4}$/, /^\d{4}$/, /^(obecnie|present|teraz|now)$/i];

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tekst PDF bez klauzuli RODO: kontrole dotyczą samego CV, a długa klauzula sama nie może ich zaliczyć. */
export function withoutClause(pdfText: string, clause: string): string {
  const words = clause.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return pdfText;
  const full = new RegExp(words.map(escRe).join('\\s+'));
  const m = full.exec(pdfText);
  if (m) return pdfText.slice(0, m.index) + pdfText.slice(m.index + m[0].length);
  // Tekst klauzuli odczytany inaczej: jest ostatnia na stronie, więc ucinamy od ostatniego wystąpienia jej początku.
  const head = new RegExp(words.slice(0, 8).map(escRe).join('\\s+'), 'g');
  const last = [...pdfText.matchAll(head)].pop();
  return last?.index !== undefined ? pdfText.slice(0, last.index) : pdfText;
}

/**
 * Kontrole na tekście odczytanym z GOTOWEGO PDF - tak "widzi" CV system ATS.
 * Wynik tylko z kar: start od 20, każdy prawdziwy błąd odejmuje punkty.
 */
export function checkFormat(
  rawText: string,
  pages: number,
  cv: CvContent,
  profile: Profile,
  clause = '',
): { score: number; max: number; pages: number; checks: FormatCheck[] } {
  const pdfText = withoutClause(rawText, clause);
  const norm = normalize(pdfText);
  const checks: FormatCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, weight: number, partial?: number) =>
    checks.push({ name, ok, detail, weight, partial });

  // Bez czytelnego tekstu ATS nie widzi niczego - kara obejmuje całą kategorię.
  const readable = pdfText.replace(/\s/g, '').length > 300;
  add(
    tr('Tekst da się odczytać'),
    readable,
    readable ? tr('PDF zawiera prawdziwy tekst, nie obrazek.') : tr('W PDF jest bardzo mało tekstu do odczytania.'),
    FORMAT_MAX,
  );

  // Dane są w profilu, ale nie w tekście PDF - to inny błąd niż brak w profilu.
  const notInPdf = () => tr('Nie znaleziono w tekście odczytanym z PDF.');

  const name = profile.contact.fullName.trim();
  const nameOk = !!name && norm.includes(normalize(name));
  add(
    tr('Imię i nazwisko'),
    nameOk,
    nameOk ? tr('Odczytane poprawnie.') : name ? notInPdf() : tr('Brak imienia i nazwiska w profilu - uzupełnij je.'),
    4,
  );

  const email = profile.contact.email.trim();
  const emailOk = !!email && pdfText.toLowerCase().includes(email.toLowerCase());
  add(
    tr('Adres e-mail'),
    emailOk,
    emailOk ? tr('Odczytany poprawnie.') : email ? notInPdf() : tr('Brak e-maila w profilu - ATS nie będzie mógł się z Tobą skontaktować.'),
    4,
  );

  const phoneDigits = profile.contact.phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 9 && pdfText.replace(/\D/g, '').includes(phoneDigits.slice(-9));
  add(
    tr('Numer telefonu'),
    phoneOk,
    phoneOk ? tr('Odczytany poprawnie.') : phoneDigits.length >= 9 ? notInPdf() : tr('Brak telefonu w profilu (albo jest niepełny).'),
    2,
  );

  // Nagłówek = osobna linia w tekście PDF (słowo "projects" w treści podsumowania to nie nagłówek).
  // Porównanie dosłowne (bez usuwania kropek): zawinięta linia "projects." to nie nagłówek "Projects".
  const rawLines = pdfText.split('\n').map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase());
  const lines = pdfText.split('\n').map((l) => normalize(l));
  const byLines = lines.length >= 5;
  // Gdy PDF nie ma podziału na linie, wracamy do szukania w całym tekście.
  const headingLine = (k: SectionKey) => {
    const label = sectionLabel(cv.language, k);
    return byLines ? rawLines.indexOf(label.toLowerCase()) : norm.indexOf(normalize(label));
  };
  const used = cv.sectionOrder.filter((k) => hasContent(cv, k));
  const foundHeadings = used.filter((k) => headingLine(k) >= 0);
  add(
    tr('Standardowe nagłówki sekcji'),
    foundHeadings.length >= Math.min(3, used.length),
    tr('Rozpoznane nagłówki: {list}.', { list: foundHeadings.map((k) => sectionLabel(cv.language, k)).join(', ') || tr('brak') }),
    3,
  );

  const garbled = /�|Ã.|Å./.test(pdfText);
  const hasPolish = /[ąćęłńóśźż]/i.test(pdfText);
  const charsOk = !garbled && (cv.language === 'en' || hasPolish);
  add(
    tr('Polskie znaki i kodowanie'),
    charsOk,
    garbled
      ? tr('W tekście są zepsute znaki - ATS może źle odczytać CV.')
      : charsOk
        ? tr('Znaki odczytane poprawnie.')
        : tr('Nie wykryto polskich znaków w CV po polsku.'),
    3,
  );

  add(
    tr('Długość CV'),
    pages <= 1,
    pages <= 1 ? tr('Jedna strona - idealnie dla studenta/juniora.') : tr('{pages} strony - dla juniora najlepiej skrócić do jednej.', { pages }),
    4,
    pages === 2 ? 0.5 : undefined,
  );

  // Kolejność czytania: nazwisko przed pierwszym nagłówkiem, nagłówki w zamierzonej kolejności.
  const positions = foundHeadings.map(headingLine);
  const ordered = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  const namePos = !name ? -1 : byLines ? lines.findIndex((l) => l.includes(normalize(name))) : norm.indexOf(normalize(name));
  const orderOk = ordered && (namePos === -1 || positions.length === 0 || namePos < positions[0]);
  add(
    tr('Kolejność czytania'),
    orderOk,
    orderOk ? tr('ATS czyta sekcje w dobrej kolejności.') : tr('Sekcje są odczytywane w innej kolejności niż na stronie.'),
    2,
  );

  const datesOk = datesConsistent(cv);
  add(
    tr('Spójny format dat'),
    datesOk,
    datesOk ? tr('Daty w jednym formacie.') : tr('Daty są zapisane w różnych formatach - ujednolić np. do MM.RRRR.'),
    1,
  );

  const penalty = checks.reduce((s, c) => s + (c.ok ? 0 : c.weight * (c.partial ?? 1)), 0);
  const score = Math.max(0, Math.round(FORMAT_MAX - penalty));
  return { score, max: FORMAT_MAX, pages, checks: checks.map(({ partial, ...c }) => ({ ...c, weight: c.weight * (partial ?? 1) })) };
}

/** Daty doświadczenia, projektów i edukacji w jednym formacie. */
export function datesConsistent(cv: CvContent): boolean {
  const dateParts = [...cv.experience.map((e) => e.dates), ...cv.projects.map((p) => p.dates), ...cv.education.map((e) => e.dates)]
    .filter(Boolean)
    .flatMap((d) => d.split(/\s*[–-]\s*/))
    .map((d) => d.trim())
    .filter(Boolean);
  // Sam rok (gdy miesiąc nieznany) i "obecnie" pasują do każdego formatu; niespójne jest mieszanie MM.RRRR z MM/RRRR.
  const kinds = new Set(dateParts.map((d) => DATE_PATTERNS.findIndex((p) => p.test(d))).filter((i) => i === 0 || i === 1));
  return !dateParts.some((d) => DATE_PATTERNS.every((p) => !p.test(d))) && kinds.size <= 1;
}

function hasContent(cv: CvContent, k: SectionKey): boolean {
  switch (k) {
    case 'summary':
      return !!cv.summary.text.trim();
    case 'skills':
      return cv.skills.some((g) => g.items.length);
    default:
      return (cv[k] as unknown[]).length > 0;
  }
}
