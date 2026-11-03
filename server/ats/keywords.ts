import type { Keyword } from '../../shared/schemas';

const STOP = new Set([
  'i', 'oraz', 'lub', 'albo', 'w', 'we', 'z', 'ze', 'na', 'do', 'od', 'o', 'po', 'dla', 'jako', 'a',
  'znajomosc', 'umiejetnosc', 'umiejetnosci', 'dobra', 'dobrej', 'bardzo', 'biegla', 'podstawowa', 'praktyczna',
  'and', 'or', 'of', 'the', 'in', 'with', 'for', 'to', 'a', 'an', 'knowledge', 'experience', 'good', 'strong',
]);

/** Małe litery, bez polskich znaków; zostawiamy + # . / dla nazw typu C++, C#, .NET, Node.js. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .replace(/(^|\s)[./]+|[./]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const tokenize = (s: string) => normalize(s).split(' ').filter(Boolean);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Dopasowanie słowa z tolerancją polskiej fleksji ("marketingu" = "marketing", "analizy" = "analiza"). */
export function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < 4 || /\d/.test(short)) return false;
  if (long.startsWith(short) && long.length - short.length <= 4) return true;
  // Wspólny rdzeń + krótkie końcówki w OBU słowach ("analizy"/"analiza"), ale nie "dziennie"/"dziennikarstwo".
  const cp = commonPrefix(a, b);
  return cp >= 5 && a.length - cp <= 3 && b.length - cp <= 3;
}

/** Ile razy fraza występuje w tekście (słowa po kolei, dopuszczalne 1 słowo przerwy). */
export function countPhrase(textTokens: string[], phrase: string): number {
  const raw = tokenize(phrase);
  const words = raw.length > 1 ? raw.filter((w) => !STOP.has(w)) : raw;
  if (!words.length) return 0;
  let count = 0;
  for (let i = 0; i < textTokens.length; i++) {
    if (!tokenMatches(textTokens[i], words[0])) continue;
    let pos = i;
    let ok = true;
    for (let w = 1; w < words.length && ok; w++) {
      if (pos + 1 < textTokens.length && tokenMatches(textTokens[pos + 1], words[w])) pos += 1;
      else if (pos + 2 < textTokens.length && tokenMatches(textTokens[pos + 2], words[w])) pos += 2;
      else ok = false;
    }
    if (ok) {
      count++;
      i = pos;
    }
  }
  return count;
}

export interface KeywordResult {
  score: number;
  max: number;
  matched: { term: string; importance: 'must' | 'nice'; foundAs: string; count: number }[];
  missing: { term: string; importance: 'must' | 'nice' }[];
  stuffing: string[];
}

export const KEYWORDS_MAX = 40;
const STUFFING_LIMIT = 5;

export function scoreKeywords(cvText: string, keywords: Keyword[]): KeywordResult {
  const tokens = tokenize(cvText);
  const matched: KeywordResult['matched'] = [];
  const missing: KeywordResult['missing'] = [];
  const stuffing: string[] = [];
  let got = 0;
  let total = 0;

  for (const kw of keywords) {
    const weight = kw.importance === 'must' ? 3 : 1;
    total += weight;
    let best = { as: '', count: 0 };
    for (const variant of [kw.term, ...kw.synonyms]) {
      const c = countPhrase(tokens, variant);
      if (c > best.count) best = { as: variant, count: c };
    }
    if (best.count > 0) {
      got += weight;
      matched.push({ term: kw.term, importance: kw.importance, foundAs: best.as, count: best.count });
      if (best.count > STUFFING_LIMIT) stuffing.push(kw.term);
    } else missing.push({ term: kw.term, importance: kw.importance });
  }

  const raw = total ? (got / total) * KEYWORDS_MAX : 0;
  const score = Math.max(0, Math.round(raw - Math.min(4, stuffing.length * 2)));
  missing.sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'must' ? -1 : 1));
  return { score, max: KEYWORDS_MAX, matched, missing, stuffing };
}
