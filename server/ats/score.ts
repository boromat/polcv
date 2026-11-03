import { AiCriterionKeys, type AiReview, type AtsReport, type CvContent, type JobPosting, type Profile } from '../../shared/schemas';
import { scoreKeywords } from './keywords';
import { checkFormat } from './formatChecks';
import { tr } from '../i18n';

export const AI_MAX = 40;

const AI_WEIGHTS: Record<(typeof AiCriterionKeys)[number], number> = {
  must_have_match: 0.35,
  achievements: 0.2,
  summary_fit: 0.15,
  clarity: 0.15,
  red_flags: 0.15,
};

/** Kryteria w stałej kolejności, bez powtórzeń (liczy się pierwsze); null, gdy któregoś brakuje. */
export function completeCriteria(review: AiReview): AiReview['criteria'] | null {
  const out: AiReview['criteria'] = [];
  for (const key of AiCriterionKeys) {
    const c = review.criteria.find((x) => x.key === key);
    if (!c || !Number.isFinite(c.score)) return null;
    out.push({ ...c, score: Math.min(10, Math.max(0, Math.round(c.score))) });
  }
  return out;
}

/** Punkty AI (0-40) z pięciu kryteriów; null = ocena niepełna, nie wolno jej przeliczać na wynik. */
export function aiScore(review: AiReview): number | null {
  const criteria = completeCriteria(review);
  if (!criteria) return null;
  let sum = 0;
  let wsum = 0;
  for (const c of criteria) {
    sum += c.score * AI_WEIGHTS[c.key];
    wsum += AI_WEIGHTS[c.key];
  }
  return Math.round((sum / wsum / 10) * AI_MAX);
}

export function buildReport(args: {
  version: number;
  pdfText: string;
  pages: number;
  /** treść CV po decyzjach, z oczekującymi sugestiami w wersji bezpiecznej (jak w trybie 'ats') */
  cv: CvContent;
  /** klauzula RODO z PDF: nie liczy się do słów kluczowych ani formatu */
  clause: string;
  profile: Profile;
  posting: JobPosting;
  review: AiReview | null;
  aiError: string;
}): AtsReport {
  const keywords = scoreKeywords(args.cv, args.posting.keywords);
  const format = checkFormat(args.pdfText, args.pages, args.cv, args.profile, args.clause);
  const criteria = args.review ? completeCriteria(args.review) : null;
  const review = args.review && criteria ? { ...args.review, criteria } : null;
  const aiPoints = review ? aiScore(review) : null;
  const ai = review && aiPoints !== null ? { score: aiPoints, max: AI_MAX, review } : null;
  const aiError = args.review && !ai ? tr('AI nie oceniło wszystkich kryteriów, więc ta część wyniku została pominięta. Oceń CV ponownie.') : args.aiError;
  // Bez części AI nie ma wyniku łącznego: 40 + 20 przeliczone na 100 zawyżałoby ocenę.
  const total = ai ? Math.round(((keywords.score + format.score + ai.score) / (keywords.max + format.max + ai.max)) * 100) : null;
  return {
    createdAt: new Date().toISOString(),
    version: args.version,
    total,
    keywords,
    format,
    ai,
    aiError,
  };
}

/** Starsze raporty bez oceny AI mają wynik przeskalowany do 100 - pokazujemy je jako niepełne. */
export const honestReport = (r: AtsReport | null): AtsReport | null => (r && !r.ai && r.total !== null ? { ...r, total: null } : r);

/**
 * Czy nowa wersja wypadła co najmniej tak dobrze jak poprzednia. Dwa pełne wyniki: porównanie wyników;
 * pełna ocena wygrywa z niepełną; dwie niepełne: słowa kluczowe i format.
 */
export function notWorse(next: AtsReport, prev: AtsReport): boolean {
  const a = honestReport(next)!;
  const b = honestReport(prev)!;
  if (a.total !== null && b.total !== null) return a.total >= b.total;
  if (b.total !== null) return false;
  if (a.total !== null) return true;
  return a.keywords.score + a.format.score >= b.keywords.score + b.format.score;
}
