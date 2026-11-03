import type { CvContent, Profile, SectionKey } from '../../shared/schemas';
import { sectionLabel } from '../cv/render';
import { normalize } from './keywords';

export const FORMAT_MAX = 20;

export interface FormatCheck {
  name: string;
  ok: boolean;
  detail: string;
  weight: number;
  partial?: number;
}

const DATE_PATTERNS = [/^\d{2}\.\d{4}$/, /^\d{2}\/\d{4}$/, /^\d{4}$/, /^(obecnie|present|teraz|now)$/i];

/**
 * Kontrole na tekście odczytanym z GOTOWEGO PDF — tak "widzi" CV system ATS.
 */
export function checkFormat(pdfText: string, pages: number, cv: CvContent, profile: Profile): { score: number; max: number; pages: number; checks: FormatCheck[] } {
  const norm = normalize(pdfText);
  const checks: FormatCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, weight: number, partial?: number) =>
    checks.push({ name, ok, detail, weight, partial });

  add(
    'Tekst da się odczytać',
    pdfText.replace(/\s/g, '').length > 300,
    pdfText.length > 300 ? 'PDF zawiera prawdziwy tekst, nie obrazek.' : 'W PDF jest bardzo mało tekstu do odczytania.',
    4,
  );

  const name = profile.contact.fullName.trim();
  add(
    'Imię i nazwisko',
    !!name && norm.includes(normalize(name)),
    name ? 'Odczytane poprawnie.' : 'Brak imienia i nazwiska w profilu — uzupełnij je.',
    2,
  );

  const email = profile.contact.email.trim();
  add(
    'Adres e-mail',
    !!email && pdfText.toLowerCase().includes(email.toLowerCase()),
    email ? 'Odczytany poprawnie.' : 'Brak e-maila w profilu — ATS nie będzie mógł się z Tobą skontaktować.',
    2,
  );

  const phoneDigits = profile.contact.phone.replace(/\D/g, '');
  add(
    'Numer telefonu',
    phoneDigits.length >= 9 && pdfText.replace(/\D/g, '').includes(phoneDigits.slice(-9)),
    phoneDigits.length >= 9 ? 'Odczytany poprawnie.' : 'Brak telefonu w profilu (albo jest niepełny).',
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
    'Standardowe nagłówki sekcji',
    foundHeadings.length >= Math.min(3, used.length),
    `Rozpoznane nagłówki: ${foundHeadings.map((k) => sectionLabel(cv.language, k)).join(', ') || 'brak'}.`,
    2,
  );

  const garbled = /�|Ã.|Å./.test(pdfText);
  const hasPolish = /[ąćęłńóśźż]/i.test(pdfText);
  const charsOk = !garbled && (cv.language === 'en' || hasPolish);
  add(
    'Polskie znaki i kodowanie',
    charsOk,
    garbled ? 'W tekście są zepsute znaki — ATS może źle odczytać CV.' : charsOk ? 'Znaki odczytane poprawnie.' : 'Nie wykryto polskich znaków w CV po polsku.',
    2,
  );

  add(
    'Długość CV',
    pages <= 1,
    pages <= 1 ? 'Jedna strona — idealnie dla studenta/juniora.' : `${pages} strony — dla juniora najlepiej skrócić do jednej.`,
    3,
    pages === 2 ? 0.5 : undefined,
  );

  // Kolejność czytania: nazwisko przed pierwszym nagłówkiem, nagłówki w zamierzonej kolejności.
  const positions = foundHeadings.map(headingLine);
  const ordered = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  const namePos = !name ? -1 : byLines ? lines.findIndex((l) => l.includes(normalize(name))) : norm.indexOf(normalize(name));
  const orderOk = ordered && (namePos === -1 || positions.length === 0 || namePos < positions[0]);
  add('Kolejność czytania', orderOk, orderOk ? 'ATS czyta sekcje w dobrej kolejności.' : 'Sekcje są odczytywane w innej kolejności niż na stronie.', 2);

  const dateParts = [...cv.experience.map((e) => e.dates), ...cv.projects.map((p) => p.dates), ...cv.education.map((e) => e.dates)]
    .filter(Boolean)
    .flatMap((d) => d.split(/\s*[–-]\s*/))
    .map((d) => d.trim())
    .filter(Boolean);
  // Sam rok (gdy miesiąc nieznany) i "obecnie" pasują do każdego formatu; niespójne jest mieszanie MM.RRRR z MM/RRRR.
  const kinds = new Set(dateParts.map((d) => DATE_PATTERNS.findIndex((p) => p.test(d))).filter((i) => i === 0 || i === 1));
  const datesOk = !dateParts.some((d) => DATE_PATTERNS.every((p) => !p.test(d))) && kinds.size <= 1;
  add('Spójny format dat', datesOk, datesOk ? 'Daty w jednym formacie.' : 'Daty są zapisane w różnych formatach — ujednolić np. do MM.RRRR.', 1);

  const score = Math.round(checks.reduce((s, c) => s + (c.ok ? c.weight : c.partial ? c.weight * c.partial : 0), 0));
  return { score, max: FORMAT_MAX, pages, checks: checks.map(({ partial, ...c }) => c) };
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
