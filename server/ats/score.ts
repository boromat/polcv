import type { AiReview, AtsReport, CvContent, JobPosting, Profile } from '../../shared/schemas';
import { scoreKeywords } from './keywords';
import { checkFormat } from './formatChecks';

export const AI_MAX = 40;

const AI_WEIGHTS: Record<AiReview['criteria'][number]['key'], number> = {
  must_have_match: 0.35,
  achievements: 0.2,
  summary_fit: 0.15,
  clarity: 0.15,
  red_flags: 0.15,
};

export function aiScore(review: AiReview): number {
  let sum = 0;
  let wsum = 0;
  for (const c of review.criteria) {
    const w = AI_WEIGHTS[c.key] ?? 0;
    sum += Math.min(10, Math.max(0, c.score)) * w;
    wsum += w;
  }
  return wsum ? Math.round((sum / wsum / 10) * AI_MAX) : 0;
}

export function buildReport(args: {
  version: number;
  pdfText: string;
  pages: number;
  cv: CvContent;
  profile: Profile;
  posting: JobPosting;
  review: AiReview | null;
  aiError: string;
}): AtsReport {
  const keywords = scoreKeywords(args.pdfText, args.posting.keywords);
  const format = checkFormat(args.pdfText, args.pages, args.cv, args.profile);
  const review = args.review
    ? { ...args.review, criteria: args.review.criteria.map((c) => ({ ...c, score: Math.min(10, Math.max(0, Math.round(c.score))) })) }
    : null;
  const ai = review ? { score: aiScore(review), max: AI_MAX, review } : null;
  const got = keywords.score + format.score + (ai?.score ?? 0);
  const max = keywords.max + format.max + (ai ? ai.max : 0);
  return {
    createdAt: new Date().toISOString(),
    version: args.version,
    total: Math.round((got / max) * 100),
    keywords,
    format,
    ai,
    aiError: args.aiError,
  };
}
