import type { CvContent, Keyword, KeywordWhereKeys } from '../../shared/schemas';
import { cleanHeadline } from '../cv/render';

export type MatchLang = 'pl' | 'en';

const STOP = new Set([
  'i', 'oraz', 'lub', 'albo', 'w', 'we', 'z', 'ze', 'na', 'do', 'od', 'o', 'po', 'dla', 'jako', 'a',
  'znajomosc', 'umiejetnosc', 'umiejetnosci', 'dobra', 'dobrej', 'bardzo', 'biegla', 'podstawowa', 'praktyczna',
  'jezyk', 'jezyka', 'poziomie',
  'and', 'or', 'of', 'the', 'in', 'with', 'for', 'to', 'a', 'an', 'knowledge', 'experience', 'good', 'strong',
]);

/** Granica pola, listy albo zdania w tokenach: fraza nigdy jej nie przekracza. */
export const BREAK = '|';

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

// Separatory: , ; | ( ) [ ] punktory, nowa linia, myślnik lub ukośnik ze spacjami, dwukropek, koniec zdania przed wielką literą.
const SEPARATORS = /[,;|()[\]•·\n\r]+|\s[-\u2013\u2014]\s|\s\/\s|:(?=\s)|[.!?](?=\s+[A-ZĄĆĘŁŃÓŚŹŻ])/;

/** Tokeny z granicami (BREAK) w miejscu separatorów list i zdań. "Manager's" = "managers". */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const part of s.replace(/['\u2019]s\b/gi, 's').split(SEPARATORS)) {
    const words = normalize(part).split(' ').filter(Boolean);
    if (!words.length) continue;
    if (out.length) out.push(BREAK);
    out.push(...words);
  }
  return out;
}

// ---------- Fleksja ----------

/** Polskie końcówki fleksyjne (bez polskich znaków, jak po normalize). Wspólny rdzeń + dwie takie końcówki = to samo słowo. */
const PL_ENDINGS = new Set([
  '', 'a', 'e', 'i', 'o', 'u', 'y',
  'em', 'om', 'ie', 'ej', 'ow', 'ym', 'im', 'ia', 'ii', 'iu',
  'ach', 'ami', 'owi', 'ego', 'emu', 'ych', 'ich', 'ymi', 'imi', 'iem', 'iom', 'iej',
  'iach', 'iami', 'iego', 'iemu',
  'owa', 'owe', 'owy', 'owej', 'owych', 'owym', 'owymi', 'owego', 'owemu',
]);
const MAX_ENDING = 5;

/** Przyrostki słowotwórcze: rdzeń bez nich (min. 4 litery) porównujemy z rdzeniem drugiego słowa. */
const PL_DERIVED = [
  // czynności: raportowanie, analizowania, testowań
  'owanie', 'owania', 'owaniu', 'owaniem', 'owaniach', 'owaniami', 'owan',
  // czasowniki na -ować: analizowałam, raportuje
  'owac', 'owal', 'owala', 'owalo', 'owali', 'owaly', 'owalem', 'owalam', 'owalismy', 'owalysmy',
  'uje', 'uja', 'ujemy', 'ujesz', 'ujecie', 'ujac',
  // -acja i -acyjny: negocjacje, dokumentacja, komunikacyjne
  'acja', 'acje', 'acji', 'acjach', 'acjami', 'acjom',
  'acyjny', 'acyjna', 'acyjne', 'acyjnych', 'acyjnej', 'acyjnym', 'acyjnymi', 'acyjnego',
  // cechy: komunikatywność, samodzielności
  'osc', 'osci', 'oscia', 'osciach', 'osciami',
];

/** Oboczności tematu: rynek/rynku, analityka/analityce, obsługa/obsłudze, kwota/kwocie, metoda/metodzie, kultura/kulturze. */
const PL_ALTERNATIONS: [string, string][] = [
  ['ek', 'k'],
  ['ce', 'k'],
  ['dze', 'g'],
  ['cie', 't'],
  ['dzie', 'd'],
  ['rze', 'r'],
];

interface Stems {
  /** rdzenie z końcówką fleksyjną (min. 3 litery) */
  inflected: Set<string>;
  /** rdzenie po przyrostku słowotwórczym lub oboczności (min. 4 litery) */
  derived: Set<string>;
}

const stemCache = new Map<string, Stems>();

function plStems(w: string): Stems {
  const cached = stemCache.get(w);
  if (cached) return cached;
  const inflected = new Set<string>();
  const derived = new Set<string>();
  for (let k = Math.max(3, w.length - MAX_ENDING); k <= w.length; k++) {
    if (PL_ENDINGS.has(w.slice(k))) inflected.add(w.slice(0, k));
  }
  for (const suf of PL_DERIVED) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) derived.add(w.slice(0, -suf.length));
  }
  for (const [from, to] of PL_ALTERNATIONS) {
    const stem = w.slice(0, -from.length) + to;
    if (w.endsWith(from) && stem.length >= 4) derived.add(stem);
  }
  const out = { inflected, derived };
  if (stemCache.size > 20_000) stemCache.clear();
  stemCache.set(w, out);
  return out;
}

function polishForms(a: string, b: string): boolean {
  const sa = plStems(a);
  const sb = plStems(b);
  for (const s of sa.inflected) if (sb.inflected.has(s)) return true;
  for (const s of [...sa.inflected, ...sa.derived]) {
    if (s.length >= 4 && (sb.inflected.has(s) || sb.derived.has(s))) return true;
  }
  return false;
}

/** Zwykła angielska liczba mnoga (po tokenize także dopełniacz 's): tool/tools, process/processes, company/companies. */
const englishPlural = (base: string, word: string) =>
  base.length >= 3 && (word === `${base}s` || word === `${base}es` || (base.endsWith('y') && word === `${base.slice(0, -1)}ies`));

/** "Node.js" = "NodeJS" = "Node". */
const canon = (w: string) => {
  const c = w.replace(/\.?js$/, '');
  return c.length >= 2 ? c : w;
};

/**
 * Dopasowanie słowa. Po polsku: wspólny rdzeń + końcówki fleksyjne z listy ("pracy" = "praca", "Excela" = "Excel",
 * "raportowanie" = "raport"), ale nie "excellent" = "Excel" ani "programista" = "program".
 * Po angielsku: tylko dokładnie albo zwykła liczba mnoga. Cyfry i znaki (GA4, C++, CI/CD): tylko dokładnie.
 */
export function tokenMatches(a: string, b: string, lang: MatchLang = 'pl'): boolean {
  if (a === BREAK || b === BREAK) return false;
  if (a === b) return true;
  const x = canon(a);
  const y = canon(b);
  if (x === y) return true;
  if (!/^[a-z]+$/.test(x) || !/^[a-z]+$/.test(y)) return false;
  if (englishPlural(x, y) || englishPlural(y, x)) return true;
  return lang === 'pl' && polishForms(x, y);
}

// ---------- Frazy ----------

/** Słowa frazy w częściach: "Google Analytics (GA4)" to dwie części, które muszą wystąpić obie. */
function phraseParts(phrase: string): string[][] {
  const parts: string[][] = [[]];
  for (const t of tokenize(phrase)) {
    if (t === BREAK) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts.map((p) => (p.length > 1 ? p.filter((w) => !STOP.has(w)) : p)).filter((p) => p.length);
}

function countWords(text: string[], words: string[], lang: MatchLang): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (!tokenMatches(text[i], words[0], lang)) continue;
    let pos = i;
    let ok = true;
    for (let w = 1; w < words.length && ok; w++) {
      // Następne słowo albo przerwa na jedno słowo pomocnicze ("praca w zespole"); granic nie przeskakujemy.
      if (pos + 1 < text.length && tokenMatches(text[pos + 1], words[w], lang)) pos += 1;
      else if (pos + 2 < text.length && STOP.has(text[pos + 1]) && tokenMatches(text[pos + 2], words[w], lang)) pos += 2;
      else ok = false;
    }
    if (ok) {
      count++;
      i = pos;
    }
  }
  return count;
}

/** Ile razy fraza występuje w tekście (słowa po kolei, bez przekraczania granic list i zdań). */
export function countPhrase(textTokens: string[], phrase: string, lang: MatchLang = 'pl'): number {
  const parts = phraseParts(phrase);
  if (!parts.length) return 0;
  return Math.min(...parts.map((words) => countWords(textTokens, words, lang)));
}

// ---------- Słowa kluczowe w sekcjach CV ----------

export type KeywordWhere = (typeof KeywordWhereKeys)[number];

/** Fragment CV: pełne punkty za opis (dowód), połowa za samo wymienienie na liście. */
export interface KeywordSource {
  where: KeywordWhere;
  /** 1 = podsumowanie, doświadczenie, projekty, wykształcenie; 0.5 = umiejętności, nagłówek, technologie projektu */
  credit: number;
  /** punkt opisu doświadczenia lub projektu: tylko tu liczą się kompetencje miękkie */
  bullet: boolean;
  text: string;
}

/** Każde pole osobno, żeby fraza nie łączyła słów z dwóch pól. */
export function cvKeywordSources(c: CvContent): KeywordSource[] {
  const out: KeywordSource[] = [];
  const add = (where: KeywordWhere, credit: number, texts: string[], bullet = false) => {
    for (const text of texts) if (text.trim()) out.push({ where, credit, bullet, text });
  };
  add('headline', 0.5, [cleanHeadline(c.headline)]);
  add('summary', 1, [c.summary.text]);
  for (const e of c.experience) {
    add('experience', 1, [e.role, e.company]);
    add('experience', 1, e.bullets.map((b) => b.text), true);
  }
  for (const p of c.projects) {
    add('projects', 1, [p.name, p.role]);
    add('technologies', 0.5, p.technologies);
    add('projects', 1, p.bullets.map((b) => b.text), true);
  }
  for (const e of c.education) add('education', 1, [e.degree, e.field, e.school, e.details]);
  add('skills', 0.5, c.skills.flatMap((g) => g.items));
  add('certificates', 1, c.certificates.flatMap((x) => [x.name, x.issuer]));
  add('languages', 1, c.languages.map((l) => `${l.name} ${l.level}`));
  add('interests', 0.5, c.interests);
  return out;
}

// Kompetencje miękkie spoza kategorii (gdy model źle ją oznaczy).
const SOFT_SKILLS = [
  'komunikatywność', 'umiejętności komunikacyjne', 'praca zespołowa', 'praca w zespole', 'samodzielność', 'kreatywność',
  'sumienność', 'zaangażowanie', 'dokładność', 'skrupulatność', 'odporność na stres', 'elastyczność', 'proaktywność',
  'communication skills', 'teamwork', 'team player', 'attention to detail', 'self-motivated', 'proactive',
];

export function isSoftSkill(kw: Keyword): boolean {
  if (kw.category === 'kompetencja miękka') return true;
  const t = tokenize(kw.term);
  return SOFT_SKILLS.some((s) => countPhrase(t, s) > 0);
}

// Wymóg wyższego wykształcenia spełnia każdy stopień lub trwające studia - ale tylko w sekcji wykształcenia ("Scrum Master" to nie magister).
const DEGREES = ['licencjat', 'inżynier', 'magister', 'mgr', 'inż', 'student', 'studentka', 'studia', 'Bachelor', 'Master', 'BSc', 'MSc', 'BEng', 'MEng', 'MBA', 'PhD', 'doktor'];

const HIGHER_EDUCATION = ['wykształcenie wyższe', 'wyższe wykształcenie', 'studia wyższe', 'higher education', 'degree', 'bachelor'];

export function isHigherEducation(kw: Keyword): boolean {
  return [kw.term, ...kw.synonyms].some((v) => {
    const t = tokenize(v);
    return HIGHER_EDUCATION.some((p) => countPhrase(t, p) > 0);
  });
}

export interface KeywordMatch {
  term: string;
  importance: 'must' | 'nice';
  foundAs: string;
  count: number;
  /** sekcje, w których słowo występuje */
  where: KeywordWhere[];
  /** 1 = pełne punkty, 0.5 = tylko na liście, 0 = kompetencja miękka bez przykładu w opisie */
  credit: number;
}

/** Gdzie i jak mocno słowo kluczowe występuje w podanych fragmentach; null = nigdzie. */
export function findKeyword(kw: Keyword, sources: KeywordSource[], lang: MatchLang): KeywordMatch | null {
  const tokens = sources.map((s) => tokenize(s.text));
  const variants = [kw.term, ...kw.synonyms].filter((v) => v.trim()).map((v) => ({ v, educationOnly: false }));
  if (isHigherEducation(kw)) variants.push(...DEGREES.map((v) => ({ v, educationOnly: true })));
  const soft = isSoftSkill(kw);
  const where = new Set<KeywordWhere>();
  let best = { as: '', count: 0 };
  let credit = 0;
  for (const { v, educationOnly } of variants) {
    let count = 0;
    sources.forEach((s, i) => {
      if (educationOnly && s.where !== 'education') return;
      const c = countPhrase(tokens[i], v, lang);
      if (!c) return;
      count += c;
      where.add(s.where);
      credit = Math.max(credit, soft ? (s.bullet ? 1 : 0) : s.credit);
    });
    if (count > best.count) best = { as: v, count };
  }
  if (!best.count) return null;
  return { term: kw.term, importance: kw.importance, foundAs: best.as, count: best.count, where: [...where], credit };
}

export interface KeywordResult {
  score: number;
  max: number;
  matched: KeywordMatch[];
  missing: { term: string; importance: 'must' | 'nice' }[];
  stuffing: string[];
}

export const KEYWORDS_MAX = 40;
const STUFFING_LIMIT = 5;

/** Waga: wymagane ×3, mile widziane ×1; kompetencje miękkie zawsze ×1 (bez dowodu w opisie to tylko deklaracja). */
export const keywordWeight = (kw: Keyword) => (isSoftSkill(kw) ? 1 : kw.importance === 'must' ? 3 : 1);

export function scoreKeywordSources(sources: KeywordSource[], keywords: Keyword[], lang: MatchLang): KeywordResult {
  const matched: KeywordResult['matched'] = [];
  const missing: KeywordResult['missing'] = [];
  const stuffing: string[] = [];
  let got = 0;
  let total = 0;

  for (const kw of keywords) {
    const weight = keywordWeight(kw);
    total += weight;
    const m = findKeyword(kw, sources, lang);
    if (m) {
      got += weight * m.credit;
      matched.push(m);
      if (m.count > STUFFING_LIMIT) stuffing.push(kw.term);
    } else missing.push({ term: kw.term, importance: kw.importance });
  }

  const raw = total ? (got / total) * KEYWORDS_MAX : 0;
  const score = Math.max(0, Math.round(raw - Math.min(4, stuffing.length * 2)));
  missing.sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'must' ? -1 : 1));
  return { score, max: KEYWORDS_MAX, matched, missing, stuffing };
}

/** Słowa kluczowe z treści CV (po decyzjach o sugestiach), sekcja po sekcji; klauzula RODO się nie liczy. */
export const scoreKeywords = (content: CvContent, keywords: Keyword[]): KeywordResult =>
  scoreKeywordSources(cvKeywordSources(content), keywords, content.language);
