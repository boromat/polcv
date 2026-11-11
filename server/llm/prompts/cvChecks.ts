import { CvContentSchema, type CvContent, type CvText, type JobPosting, type Keyword, type Profile } from '../../../shared/schemas';
import { aliasVariants, countPhrase, cvKeywordSources, findKeyword, isSoftSkill, looksPolish, normalize, tokenize } from '../../ats/keywords';
import { tr } from '../../i18n';
import { profileForPrompt } from './common';
import { factEvidence } from './improvePlan';

// Kontrole CV od modelu: część wraca do poprawki (checkedCvSchema), resztę poprawiamy w kodzie (groundCv).

type Lang = 'pl' | 'en';

export interface CvIssue {
  path: (string | number)[];
  message: string;
}

// ---------- Punkty w 1. osobie ----------

/** Rzeczowniki w narzędniku, które też kończą się na -łem ("Kierowanie zespołem", "Współpraca z działem"). */
const NOUNS_LEM = new Set([
  'działem', 'wydziałem', 'oddziałem', 'przydziałem', 'rozdziałem', 'podziałem', 'udziałem', 'kanałem', 'materiałem', 'zapałem',
  'kapitałem', 'sygnałem', 'potencjałem', 'ideałem', 'upałem', 'kryształem', 'ciałem', 'generałem', 'zespołem', 'kołem', 'stołem',
  'kościołem', 'aniołem', 'popiołem', 'dołem', 'czołem', 'szczegółem', 'dziełem', 'pomysłem', 'przemysłem', 'zmysłem', 'namysłem',
  'hasłem', 'rzemiosłem', 'krzesłem', 'wiosłem', 'masłem', 'posłem', 'źródłem', 'mydłem', 'godłem', 'skrzydłem', 'siodłem', 'pudłem',
  'węzłem', 'tłem', 'światłem', 'wiertłem', 'tyłem', 'michałem', 'pawłem', 'rafałem',
]);

// Czas przeszły w 1. (albo 2.) osobie: "zbudowałem", "stworzyłam", "zacząłem", "zrobiłeś". Samo "l" pomijamy: "portalem", "Excelem".
const PAST_PERSONAL = /ł(?:em|am|eś|aś)$/u;

/** Czasownik w 1. osobie czasu przeszłego wśród dwóch pierwszych słów ("Samodzielnie zbudowałem…"); null, gdy go nie ma. */
export function firstPersonVerb(text: string): string | null {
  const words = text
    .replace(/^[^\p{L}]+/u, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.replace(/[^\p{L}]+$/u, ''));
  return words.find((w) => PAST_PERSONAL.test(w.toLowerCase()) && !NOUNS_LEM.has(w.toLowerCase())) ?? null;
}

export const STARTS_WITH_I = /^[^\p{L}]*I(?:\s|['’](?:m|ve|d)(?!\p{L}))/u;

// Czasowniki w 3. osobie, którymi model pisze podsumowanie, jakby CV pisał ktoś inny ("Zna Python", "Tworzy prompty").
const THIRD_PERSON = new Set([
  'jest', 'zna', 'ma', 'posiada', 'potrafi', 'umie', 'tworzy', 'buduje', 'rozwija', 'projektuje', 'programuje', 'wdraża', 'testuje',
  'automatyzuje', 'integruje', 'analizuje', 'przygotowuje', 'prowadzi', 'realizuje', 'pracuje', 'studiuje', 'uczy', 'zajmuje',
  'specjalizuje', 'interesuje', 'wykorzystuje', 'używa', 'stosuje', 'łączy', 'wspiera', 'dba', 'szuka', 'poszukuje', 'chce', 'dąży',
]);

// Podsumowanie jak opis kogoś z boku: równoważnik od nazwy roli ("Student kierunku X, …") albo "…, pracujący z…".
const NOMINAL_OPENER = /^[^\p{L}]*(student|studentka|absolwent|absolwentka|stażysta|stażystka|praktykant|praktykantka|technik|inżynier|programista|programistka|analityk|analityczka|specjalista|specjalistka)(?!\p{L})/iu;
const PARTICIPLE_AFTER_COMMA = /,\s*(\p{L}+(?:ący|ąca))(?!\p{L})/gu;

/** Końcówka 1. osoby czasu przeszłego zgodna z tym, jak kandydat się określa ("zrobiłem", "zrobiłam"). */
const OWN_PAST: Record<NonNullable<Profile['pronouns']>, RegExp> = { on: /łem$/u, ona: /łam$/u, ono: /łom$/u };

/**
 * Słowa podsumowania po polsku, które nie pasują do CV pisanego przez kandydata: 3. osoba, czas przeszły z rodzajem,
 * równoważnik. Gdy kandydat podał, jak się określa (`pronouns`), czas przeszły w 1. osobie w jego formie jest w porządku
 * ("Ukończyłam technikum"); zostają formy innego rodzaju i 2. osoba. Bez tej informacji każda forma z rodzajem to zgadywanie.
 */
export function summaryPersonIssues(text: string, pronouns?: Profile['pronouns']): { thirdPerson: string[]; gendered: string[]; nominal: string[] } {
  const words = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean);
  const lower = (w: string) => w.toLowerCase();
  const own = pronouns ? OWN_PAST[pronouns] : null;
  return {
    thirdPerson: [...new Set(words.filter((w) => THIRD_PERSON.has(lower(w))))],
    gendered: [...new Set(words.filter((w) => PAST_PERSONAL.test(lower(w)) && !NOUNS_LEM.has(lower(w)) && !own?.test(lower(w))))],
    nominal: [...new Set([NOMINAL_OPENER.exec(text)?.[1], ...[...text.matchAll(PARTICIPLE_AFTER_COMMA)].map((m) => m[1])].filter((w): w is string => !!w))],
  };
}

/** Jak opisać kandydatowi formę czasu przeszłego, której ma użyć (do komunikatu dla modelu). */
const OWN_PAST_EXAMPLE: Record<NonNullable<Profile['pronouns']>, string> = {
  on: 'męskiej, np. „ukończyłem”, „pracowałem”',
  ona: 'żeńskiej, np. „ukończyłam”, „pracowałam”',
  ono: 'nijakiej, np. „ukończyłom”, „pracowałom”',
};

const bulletsOf = (c: CvContent) => [
  ...c.experience.flatMap((e, i) => e.bullets.map((b, j) => ({ b, path: ['experience', i, 'bullets', j] }))),
  ...c.projects.flatMap((p, i) => p.bullets.map((b, j) => ({ b, path: ['projects', i, 'bullets', j] }))),
];

/**
 * Punkty po polsku w 1. osobie, punkty po angielsku od "I" i podsumowanie po polsku w 3. osobie albo w czasie przeszłym
 * z rodzajem (wszędzie także w wersji bezpiecznej, bo po odrzuceniu sugestii trafia do CV).
 */
/** Teksty obecnej wersji CV: kandydat mógł je napisać sam, więc przy poprawce zostają takie, jakie są. */
export function currentTexts(c: CvContent): Set<string> {
  return new Set([c.summary, ...bulletsOf(c).map((x) => x.b)].flatMap((t) => [t.text, t.fallbackText]).filter((t) => t.trim()));
}

/**
 * `keep`: teksty, które zostają bez zmian z obecnej wersji (np. napisane przez kandydata) - ich styl nie wraca do poprawki.
 * `pronouns`: jak kandydat się określa; wtedy czas przeszły w jego formie jest dozwolony w podsumowaniu.
 */
export function styleIssues(c: CvContent, lang: Lang, keep: Set<string> = new Set(), pronouns?: Profile['pronouns']): CvIssue[] {
  const out: CvIssue[] = [];
  if (lang === 'pl') {
    for (const field of ['text', 'fallbackText'] as const) {
      if (keep.has(c.summary[field])) continue;
      const { thirdPerson, gendered, nominal } = summaryPersonIssues(c.summary[field], pronouns);
      if (thirdPerson.length) {
        out.push({
          path: ['summary', field],
          message: `Podsumowanie w 3. osobie („${thirdPerson.join('”, „')}”). Kandydat pisze CV o sobie: 1. osoba w czasie teraźniejszym, bez „ja”, np. „Znam…”, „Tworzę…”, „Jestem…”, „Szukam…”.`,
        });
      }
      if (nominal.length) {
        out.push({
          path: ['summary', field],
          message: `Podsumowanie brzmi jak opis kogoś z boku („${nominal.join('”, „')}”). Pisz w 1. osobie od pierwszego zdania, np. „Jestem studentem…” albo „Studiuję…”, „Pracuję z…”, bez równoważników i imiesłowów.`,
        });
      }
      if (gendered.length) {
        out.push({
          path: ['summary', field],
          message: pronouns
            ? `Podsumowanie ma czas przeszły w formie, która nie pasuje do kandydata („${gendered.join('”, „')}”). Kandydat określa się jako „${pronouns}”: czas przeszły tylko w 1. osobie w formie ${OWN_PAST_EXAMPLE[pronouns]}, a najlepiej czas teraźniejszy („Tworzę…”, „Rozwijam…”).`
            : `Podsumowanie w czasie przeszłym z rodzajem („${gendered.join('”, „')}”). Pisz w czasie teraźniejszym („Tworzę…”, „Rozwijam…”) albo bez czasownika („Doświadczenie w…”), bez zgadywania płci.`,
        });
      }
    }
  }
  for (const { b, path } of bulletsOf(c)) {
    for (const field of ['text', 'fallbackText'] as const) {
      const t = b[field];
      if (!t.trim() || keep.has(t)) continue;
      if (lang === 'pl') {
        const verb = firstPersonVerb(t);
        if (verb) {
          out.push({
            path: [...path, field],
            message: `Punkt w 1. osobie („${verb}”). Pisz formą rzeczownikową, np. „Przygotowywanie cotygodniowych raportów…”, „Budowa dashboardu…”, także gdy profil jest napisany w 1. osobie.`,
          });
        }
      } else if (STARTS_WITH_I.test(t)) {
        out.push({ path: [...path, field], message: 'Punkt zaczyna się od "I". Zacznij od czasownika w czasie przeszłym, bez "I", np. "Built…", "Prepared…".' });
      }
    }
  }
  return out;
}

// ---------- Pozycje spoza profilu ----------

/** Id pozycji profilu, na których może się opierać wpis w CV (bez odpowiedzi "nie mam" z extraFacts). */
function profileIds(p: Profile): Set<string> {
  return new Set([...p.experience, ...p.projects, ...p.education, ...p.certificates, ...p.extraFacts.filter((f) => f.has)].map((x) => x.id));
}

/** Doświadczenie, projekty i edukacja w CV muszą wskazywać istniejącą pozycję profilu. */
export function sourceIssues(c: CvContent, profile: Profile): CvIssue[] {
  const ids = profileIds(profile);
  const entries = [
    ...c.experience.map((e, i) => ({ path: ['experience', i, 'sourceId'], id: e.sourceId, label: [e.role, e.company].filter(Boolean).join(', ') })),
    ...c.projects.map((p, i) => ({ path: ['projects', i, 'sourceId'], id: p.sourceId, label: p.name })),
    ...c.education.map((e, i) => ({ path: ['education', i, 'sourceId'], id: e.sourceId, label: [e.school, e.field].filter(Boolean).join(', ') })),
  ];
  return entries
    .filter((e) => !ids.has(e.id))
    .map((e) => ({
      path: e.path,
      message: `Pozycja „${e.label}” ma sourceId "${e.id}", którego nie ma w profilu. Wpisz "id" pozycji z PROFILU KANDYDATA, na której opiera się ten wpis, albo usuń pozycję, jeśli profil jej nie zawiera.`,
    }));
}

// ---------- Umiejętności spoza profilu ----------

/** "Power BI (raporty)" → "Power BI": dopisek w nawiasie nie zmienia tego, jaką umiejętność pozycja deklaruje. */
export const skillBase = (item: string) => item.replace(/\s*\(.*?\)\s*/g, ' ').trim();

/** Słowa pozycji bez znaków wokół: "(TMS)," → "TMS", "C++" i ".NET" zostają. */
export const skillWords = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}.]+|[^\p{L}\p{N}+#]+$/gu, ''))
    .filter(Boolean);

/**
 * Słowa, które się nie tłumaczą: skróty i wielka litera w środku (CMR, TMS, SQL, TypeScript), cyfry i znaki
 * (GA4, C++, C+E, CI/CD, Node.js). "CMR documents" to tłumaczenie "dokumenty CMR", ale "CMR" musi być w profilu.
 */
export const isNameWord = (w: string) => /\p{Lu}.*\p{Lu}|\d|[+#/]|\p{L}\.\p{L}/u.test(w);

/** Pozycja = słowo kluczowe ogłoszenia, gdy to ta sama fraza co jego term albo synonim (w obie strony). */
function postingMatches(base: string, keywords: Keyword[]): Keyword[] {
  const t = tokenize(base);
  const same = (v: string) => !!v.trim() && countPhrase(t, v) > 0 && countPhrase(tokenize(v), base) > 0;
  return keywords.filter((k) => [k.term, ...k.synonyms].some(same));
}

interface SkillFinding {
  item: string;
  /** nazwy z pozycji, których profil nie ma (np. "SQL", w CV po polsku też "Ads" z "Google Ads") */
  missingNames: string[];
  /** pozycja to narzędzie albo nazwa wymagana w ogłoszeniu ("React", "Java"), a nie zwykła umiejętność */
  postingName: boolean;
}

/**
 * Pozycje z listy umiejętności w CV, których nie da się znaleźć w profilu (ani w odpowiedziach "mam" z extraFacts).
 * Odpowiedniki się liczą: aliasy ("VLOOKUP" = "WYSZUKAJ.PIONOWO", "Microsoft Excel" = "MS Excel") oraz term i synonimy
 * słowa kluczowego ogłoszenia. CV po angielsku z polskiego profilu: zwykłe słowa to tłumaczenia ("Teamwork",
 * "CMR documents"), więc liczą się nazwy, które się nie tłumaczą, narzędzia z ogłoszenia ("React") i, tylko do
 * ostrzeżenia, nazwy z wielkich liter ("Power Query").
 */
/** Teksty profilu, które potwierdzają umiejętności i nazwy (z odpowiedziami "mam" z extraFacts). */
function claimSource(profile: Profile): string {
  const facts = profile.extraFacts.filter((f) => f.has).map(factEvidence);
  return [
    profile.headline,
    ...profile.skills.map((s) => s.name),
    ...profile.experience.flatMap((e) => [e.role, e.description, ...e.achievements]),
    ...profile.projects.flatMap((p) => [p.name, p.description, ...p.technologies, ...p.achievements]),
    ...profile.education.flatMap((e) => [e.field, e.details]),
    ...profile.certificates.map((x) => `${x.name} ${x.issuer}`),
    ...profile.languages.map((l) => `${l.name} ${l.level}`), // "Angielski B2" w umiejętnościach to poziom z profilu
    profile.summary,
    ...facts,
  ].join(' \n ');
}

function skillFindings(c: CvContent, profile: Profile, keywords: Keyword[]): SkillFinding[] {
  const source = claimSource(profile);
  const tokens = tokenize(source);
  const found = (v: string) => countPhrase(tokens, v) > 0;
  const translated = c.language === 'en' && looksPolish(source);
  const out: SkillFinding[] = [];
  for (const item of c.skills.flatMap((g) => g.items)) {
    const base = skillBase(item);
    if (!base) continue;
    const matches = postingMatches(base, keywords);
    const equivalents = [...new Set([base, ...matches.flatMap((k) => [k.term, ...k.synonyms])].flatMap(aliasVariants))];
    if (equivalents.some(found)) continue;
    // Nazwy w pozycji: skróty i nazwy techniczne, a w CV po polsku też słowa z wielkiej litery poza pierwszym
    // ("Kampanie Google Ads"), bo po polsku zwykłych słów nie pisze się wielką literą.
    const words = skillWords(base);
    const names = [...new Set(words.filter((w, i) => isNameWord(w) || (c.language === 'pl' && i > 0 && /^\p{Lu}/u.test(w))))];
    const missingNames = names.filter((w) => !aliasVariants(w).some(found));
    const postingTool = matches.some((k) => k.category === 'narzędzie');
    // Tłumaczenie z nazwą z profilu ("CMR documentation") przechodzi; nazwa z wielkich liter bez skrótu
    // ("Power Query", ale też "Transport Management System") zostaje jako ostrzeżenie w edytorze.
    if (translated && !postingTool && (names.length ? !missingNames.length : !/\s\p{Lu}/u.test(base))) continue;
    const postingName = matches.some(
      (k) => k.category !== 'język' && !isSoftSkill(k) && (k.category === 'narzędzie' || /^\p{Lu}/u.test(k.term) || skillWords(k.term).some(isNameWord)),
    );
    out.push({ item, missingNames, postingName });
  }
  return out;
}

/** Pozycje umiejętności, których profil nie potwierdza (ostrzeżenie w edytorze). */
export function unverifiedSkillItems(c: CvContent, profile: Profile, keywords: Keyword[] = []): string[] {
  return skillFindings(c, profile, keywords).map((f) => f.item);
}

/**
 * Umiejętności spoza profilu, które wracają do modelu: pozycja z nazwą, której profil nie ma ("SQL", "Google Ads"),
 * albo narzędzie lub nazwa wymagana w ogłoszeniu ("React", "Java"). Przeformułowana cecha ("Współpraca zespołowa"),
 * zwykła umiejętność z ogłoszenia ("koordynacja przewozów") i pozycja z nazwą z profilu ("Obsługa systemu TMS" przy
 * "system TMS") tu nie wchodzą: te pokazuje tylko ostrzeżenie w edytorze. `keep`: pozycje, które CV już miało
 * (np. dopisane przez kandydata), nie są ruszane przy poprawie.
 */
export function rejectedSkillItems(c: CvContent, profile: Profile, keywords: Keyword[] = [], keep: string[] = []): string[] {
  const kept = new Set(keep.map(normalize));
  return skillFindings(c, profile, keywords)
    .filter((f) => !kept.has(normalize(f.item)) && (f.missingNames.length > 0 || f.postingName))
    .map((f) => f.item);
}

export function skillIssues(c: CvContent, profile: Profile, keywords: Keyword[] = [], keep: string[] = []): CvIssue[] {
  const bad = rejectedSkillItems(c, profile, keywords, keep);
  if (!bad.length) return [];
  return [{
    path: ['skills'],
    message: `Umiejętności spoza profilu: „${bad.join('”, „')}”. W "skills" wpisuj tylko umiejętności z PROFILU KANDYDATA albo z "extraFacts" (has=true), także gdy ogłoszenie ich wymaga, i bez dopisków typu "(w nauce)". Usuń je z listy: braki kandydat zobaczy w raporcie. Skróty i nazwy narzędzi z profilu (np. "TMS", "CMR", "Excel") zapisuj tak jak w profilu, także w CV po angielsku.`,
  }];
}

// ---------- Tytuł CV ----------

/** Id sugestii tytułu: CV ma jeden tytuł, więc id jest stałe. */
export const HEADLINE_ID = 'headline';

/** Kategoria prawa jazdy: "kat. C+E", "kategorii C", "kat. D1". */
const LICENSE = /(?<![\p{L}\p{N}])kat(?:\.|egorii|egoria|egorię)?\s*([A-D]1?(?:\s*\+\s*E)?)(?![\p{L}\p{N}+])/giu;
const licenseCats = (s: string) => [...s.matchAll(LICENSE)].map((m) => m[1].replace(/\s+/g, '').toUpperCase());

/**
 * Nazwy w tytule, których profil nie potwierdza: słowo kluczowe ogłoszenia, które jest narzędziem, certyfikatem albo
 * umiejętnością o nazwie własnej ("Java" w "Junior Java Developer", "C+E" z "prawo jazdy kat. C+E"), i kategoria prawa
 * jazdy. Słowa o samym stanowisku ("Kierowca zawodowy", "Logistics Coordinator") nie są twierdzeniem o kandydacie.
 */
export function unconfirmedHeadlineNames(headline: string, profile: Profile, keywords: Keyword[] = []): string[] {
  const source = claimSource(profile);
  const tokens = tokenize(source);
  const found = (v: string) => countPhrase(tokens, v) > 0;
  const inHeadline = tokenize(headline);
  const out: string[] = [];
  for (const k of keywords) {
    if (!['narzędzie', 'certyfikat', 'umiejętność'].includes(k.category) || isSoftSkill(k)) continue;
    const variants = [k.term, ...k.synonyms].filter((v) => v.trim());
    const named = k.category !== 'umiejętność' || variants.some((v) => /^\p{Lu}/u.test(v.trim()) || skillWords(v).some(isNameWord));
    const contained = variants.filter((v) => countPhrase(inHeadline, v) > 0);
    if (!named || !contained.length) continue;
    if (variants.flatMap(aliasVariants).some(found)) continue;
    out.push(contained.sort((a, b) => b.length - a.length)[0]);
  }
  const have = new Set(licenseCats(source));
  for (const m of headline.matchAll(LICENSE)) {
    const cat = m[1].replace(/\s+/g, '').toUpperCase();
    if (!have.has(cat) && !(cat.length > 1 && found(cat))) out.push(m[0].trim());
  }
  // "C+E" i "kat. C+E" to ta sama rzecz: zostaje dłuższa.
  const uniq = [...new Set(out)];
  return uniq.filter((n) => !uniq.some((o) => o !== n && normalize(o).includes(normalize(n))));
}

const EDGE_WORDS = new Set(['kat', 'kategorii', 'kategoria', 'z', 'ze', 'w', 'we', 'i', 'oraz', 'dla', 'with', 'and', 'or', 'in', 'for', 'of', '-']);

/** Tytuł bez podanych nazw: "Junior Java Developer" bez "Java" → "Junior Developer". */
function withoutNames(headline: string, names: string[]): string {
  const pattern = (n: string) => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}+])`, 'giu');
  // Nawias z niepotwierdzoną nazwą znika w całości: "(kat. C+E)", "(Spring Boot)".
  let s = headline.replace(/\s*\([^()]*\)/g, (m) => (names.some((n) => pattern(n).test(m)) ? '' : m));
  for (const n of [...names].sort((a, b) => b.length - a.length)) s = s.replace(pattern(n), ' ');
  const words = s
    .split(/\s+/)
    .map((w) => w.replace(/^[/|,]+|[/|,]+$/g, ''))
    .filter(Boolean);
  const edge = (w: string) => EDGE_WORDS.has(normalize(w).replace(/\.$/, ''));
  while (words.length && edge(words[0])) words.shift();
  while (words.length && edge(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/**
 * Bezpieczna wersja tytułu: bez niepotwierdzonych nazw, gdy zostają co najmniej 2 słowa; inaczej tytuł z profilu
 * (w CV po angielsku tylko angielski), a w ostateczności to jedno słowo albo pusty tytuł.
 */
export function safeHeadline(headline: string, names: string[], profile: Profile, lang: Lang, keywords: Keyword[] = []): string {
  const clean = (s: string) => !unconfirmedHeadlineNames(s, profile, keywords).length;
  const cut = withoutNames(headline, names);
  if (cut.split(' ').length >= 2 && clean(cut)) return cut;
  const own = profile.headline.trim();
  if (own && clean(own) && (lang === 'pl' || !looksPolish(own))) return own;
  return cut && clean(cut) ? cut : '';
}

/**
 * Tytuł z ogłoszenia, którego profil nie potwierdza, staje się żółtą sugestią (jak liczba spoza profilu), a w CV zostaje
 * wersja bezpieczna. Tytuł, którego AI nie zmieniło (przy poprawie, skracaniu, poleceniu), zostaje razem z sugestią
 * czekającą na decyzję; tak samo, gdy AI przepisało do tytułu samą sugestię.
 */
function groundHeadline(c: CvContent, profile: Profile, opts: GroundOptions): Pick<CvContent, 'headline' | 'headlineSuggestion'> {
  const cur = opts.current;
  if (cur && (c.headline === cur.headline || (cur.headlineSuggestion && c.headline === cur.headlineSuggestion.text))) {
    return { headline: cur.headline, headlineSuggestion: cur.headlineSuggestion };
  }
  const names = c.headline.trim() ? unconfirmedHeadlineNames(c.headline, profile, opts.keywords) : [];
  if (!names.length) return { headline: c.headline, headlineSuggestion: undefined };
  const safe = safeHeadline(c.headline, names, profile, opts.lang, opts.keywords);
  return {
    headline: safe,
    headlineSuggestion: {
      id: HEADLINE_ID,
      text: c.headline,
      status: 'suggested',
      reason: tr('Tytuł z ogłoszenia, a profil nie potwierdza: {names}. Zostaw go tylko, jeśli to prawda.', { names: names.join(', ') }),
      fallbackText: safe,
      sourceIds: [],
    },
  };
}

/** Szkoły z profilu zostają w CV zawsze: przy skracaniu model potrafił po cichu wyciąć technikum. */
export function educationIssues(c: CvContent, profile: Profile): CvIssue[] {
  const inCv = new Set(c.education.map((e) => e.sourceId));
  return profile.education
    .filter((e) => (e.school.trim() || e.field.trim()) && !inCv.has(e.id))
    .map((e) => ({
      path: ['education'],
      message: `Brakuje szkoły z profilu: „${[e.school, e.field].filter(Boolean).join(', ')}” (sourceId ${e.id}). Wykształcenie zostaje w CV w całości; przy braku miejsca skróć jej szczegóły albo inne sekcje.`,
    }));
}

/**
 * Schemat CV dla modelu: punkty w 1. osobie, wpisy i umiejętności spoza profilu wracają do poprawki. Schemat JSON się
 * nie zmienia. `keywords`: słowa kluczowe ogłoszenia, żeby ich odpowiedniki z profilu liczyły się przy sprawdzaniu
 * umiejętności.
 */
export function checkedCvSchema(profile: Profile, lang: Lang, keywords: Keyword[] = []) {
  return CvContentSchema.superRefine((c, ctx) => {
    const issues = [...styleIssues(c, lang, undefined, profile.pronouns), ...sourceIssues(c, profile), ...educationIssues(c, profile), ...skillIssues(c, profile, keywords)];
    for (const issue of issues) ctx.addIssue({ code: 'custom', ...issue });
  });
}

/** Pozycje z listy umiejętności obecnej wersji CV: przy poprawie zostają, nawet jeśli profil ich nie potwierdza. */
export const cvSkillItems = (c: CvContent) => c.skills.flatMap((g) => g.items);

// ---------- Słowa kluczowe przy poprawie ----------

/** Słowa kluczowe ogłoszenia, które obecne CV ma, a nowa wersja zgubiła (można je przenieść, ale nie usunąć). */
export function lostKeywordIssues(next: CvContent, current: CvContent, keywords: Keyword[]): CvIssue[] {
  const before = cvKeywordSources(current);
  const after = cvKeywordSources(next);
  return keywords.flatMap((kw) => {
    const was = findKeyword(kw, before, current.language);
    if (!was || findKeyword(kw, after, current.language)) return [];
    return [{
      path: [],
      message: `Brakuje słowa kluczowego „${was.foundAs}”, które było w obecnym CV (sekcje: ${was.where.join(', ')}). Przywróć je tam, gdzie jest prawdziwe: możesz je przenieść albo przeredagować zdanie, ale nie usuwaj go z CV.`,
    }];
  });
}

/** Schemat poprawionego CV: jak checkedCvSchema, a do tego nie wolno zgubić słów kluczowych obecnej wersji. */
/** `keepSchools`: false przy poleceniu kandydata - szkoły, którą sam usunął z CV, nie przywracamy na siłę. */
export function checkedImproveSchema(profile: Profile, lang: Lang, current: CvContent, keywords: Keyword[], keepSchools = true) {
  const keep = currentTexts(current);
  return CvContentSchema.superRefine((c, ctx) => {
    const schools = keepSchools ? educationIssues(c, profile) : [];
    const skills = skillIssues(c, profile, keywords, cvSkillItems(current));
    for (const issue of [...styleIssues(c, lang, keep, profile.pronouns), ...sourceIssues(c, profile), ...schools, ...skills, ...lostKeywordIssues(c, current, keywords)]) {
      ctx.addIssue({ code: 'custom', ...issue });
    }
  });
}

// ---------- Firmy i daty z profilu ----------

/** Data z profilu ("RRRR-MM" albo "RRRR") w zapisie CV: "MM.RRRR" / "MM/YYYY"; null, gdy zapis jest nietypowy. */
export function cvDate(value: string, lang: Lang): string | null {
  const v = value.trim();
  if (!v) return '';
  const sep = lang === 'pl' ? '.' : '/';
  const ym = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(v);
  const my = /^(\d{1,2})[./-](\d{4})$/.exec(v);
  const [year, month] = ym ? [ym[1], ym[2]] : my ? [my[2], my[1]] : [/^\d{4}$/.test(v) ? v : '', ''];
  if (!year) return null;
  if (!month) return year;
  return Number(month) >= 1 && Number(month) <= 12 ? `${month.padStart(2, '0')}${sep}${year}` : null;
}

/** Zakres jak w promptcie: "MM.RRRR - MM.RRRR" / "MM.RRRR - obecnie" (po angielsku "MM/YYYY - present"); null = zostaje zapis modelu. */
export function cvDateRange(start: string, end: string, current: boolean, lang: Lang): string | null {
  const s = cvDate(start, lang);
  const e = current ? (lang === 'pl' ? 'obecnie' : 'present') : cvDate(end, lang);
  if (s === null || e === null) return null;
  if (!s) return current ? '' : e;
  return e ? `${s} - ${e}` : s;
}

// ---------- Liczby spoza profilu ----------

// Samodzielna liczba (nie "GA4" ani "B2B"): 15, 1 200, 10.000, 3,5, 12.05.2023, 2022/2023.
const NUMBER = /(?<![\p{L}\p{N}_])(?:\d{1,3}(?:[ \u00a0.,]\d{3})+(?!\d)|\d+(?:[.,:/]\d+)*)/gu;

/** Wartości do porównania: "1 200" → 1200, "3,5" → 3.5, inne zapisy ("12.05.2023") → każda grupa cyfr osobno. */
function values(token: string): string[] {
  if (/^\d{1,3}(?:[ \u00a0.,]\d{3})+$/.test(token)) return [String(Number(token.replace(/\D/g, '')))];
  const dec = /^(\d+)[.,](\d{1,2})$/.exec(token);
  if (dec) return [String(Number(`${dec[1]}.${dec[2]}`))];
  return token.split(/[.,:/]/).map((d) => String(Number(d)));
}

/** Liczby z tekstów; dla pewności także cyfry wewnątrz nazw ("GA4" potwierdza "Google Analytics 4"). */
export function knownNumbers(texts: string[]): Set<string> {
  const known = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(NUMBER)) values(m[0]).forEach((v) => known.add(v));
    for (const m of t.matchAll(/\d+/g)) known.add(String(Number(m[0])));
  }
  return known;
}

/** Teksty profilu, z których CV może brać liczby: bez kontaktu, id i odpowiedzi "nie mam" z extraFacts. */
export function profileTexts(p: Profile): string[] {
  const { contact, extraFacts, ...rest } = profileForPrompt(p);
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'id' && walk(x));
  };
  walk(rest);
  for (const f of extraFacts) if (f.has) out.push(f.topic, f.answer);
  return out;
}

/** Nazwy z liczbą ze słów kluczowych ogłoszenia ("Office 365", "Python 3") - to nie są ilości. */
export function numberedNames(posting: JobPosting): string[] {
  return posting.keywords.flatMap((k) => [k.term, ...k.synonyms]).filter((n) => /\d/.test(n) && n.trim().length > 1);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Hit {
  index: number;
  token: string;
}

/** Wyszukiwarka nieznanych liczb w tekście (pozycje jak w oryginale). */
export function numberFinder(known: Set<string>, names: string[] = []) {
  const list = names.map((n) => n.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const namesRe = list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}]|[.,]\\d)`, 'giu') : null;
  return (text: string): Hit[] => {
    const masked = namesRe ? text.replace(namesRe, (m) => ' '.repeat(m.length)) : text;
    return [...masked.matchAll(NUMBER)].filter((m) => values(m[0]).some((v) => !known.has(v))).map((m) => ({ index: m.index, token: m[0] }));
  };
}

const QUALIFIER = /(?:(?<!\p{L})(?:ok\.|około|ponad|blisko|prawie|niemal|nawet|aż|średnio|about|around|approximately|over|nearly|almost|more than|up to)\s*|~\s*)$/iu;
const CHANGE = /(?<!\p{L})(?:o|by|of)\s+$/iu;
const UNIT = /^\+?(?:\s?(?:%|proc\.|procent\p{L}*|zł|pln|eur|usd|tys\.|mln|mld|k|x|h)(?!\p{L})){0,2}/iu;
// Po usunięciu liczby zostałoby "w miesiące", "przez lata", "do osób", "razy w tygodniu" - takich nie ruszamy.
const BAD_BEFORE = /(?<!\p{L})(?:w|we|przez|po|przed|od|do|in|for|within|after|during)\s+$/iu;
const TIME_AFTER =
  /^\s*(?:raz\p{L}*|times?|dni\p{L}*|dzień|tydzień|tygodni\p{L}*|miesiąc\p{L}*|miesięc\p{L}*|lat\p{L}*|rok\p{L}*|godzin\p{L}*|minut\p{L}*|days?|weeks?|months?|years?|hours?|minutes?)(?!\p{L})/iu;
const PREP_END = /(?<!\p{L})(?:w|we|z|ze|do|na|o|od|po|przy|przez|przed|za|u|dla|i|oraz|lub|a|in|on|at|to|of|for|by|with|from|and|or)\s*$/iu;

/** Usuwa jedną liczbę z kwalifikatorem i jednostką ("o ok. 30%"); null, gdy zdanie by się rozsypało. */
function cutNumber(s: string, hit: Hit): string | null {
  let start = hit.index;
  let end = hit.index + hit.token.length;
  if (/^\.\s*\p{Ll}/u.test(s.slice(end))) return null; // liczebnik porządkowy: "3. roku"
  const unit = UNIT.exec(s.slice(end))?.[0] ?? '';
  end += unit.length;
  const rest = s.slice(end);
  if (TIME_AFTER.test(rest)) return null;
  start -= QUALIFIER.exec(s.slice(0, start))?.[0].length ?? 0;
  // "o 30%" znika razem z liczbą, ale "o 5 osób" bez liczby by się rozsypało.
  const change = CHANGE.exec(s.slice(0, start))?.[0] ?? '';
  if (change && !/[^\s+]/.test(unit)) return null;
  start -= change.length;
  const before = s.slice(0, start);
  if (!before.trim() || BAD_BEFORE.test(before)) return null;
  // Przyimek bez dalszego ciągu: "przy 12.05.2023" → "przy".
  if (PREP_END.test(before) && !/^\s*\p{L}/u.test(rest)) return null;
  return before + rest;
}

function tidy(s: string, original: string): string {
  let t = s
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([,;:])(?=[,.;:])/g, '')
    .trim()
    .replace(/[\s,;:–-]+$/u, '');
  if (/[.!?]$/.test(original.trim()) && !/[.!?]$/.test(t)) t += original.trim().slice(-1);
  if (/^\p{Lu}/u.test(original.trim())) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/** Bezpieczna wersja tekstu bez nieznanych liczb, gdy da się ją prosto uzyskać; inaczej ''. */
export function withoutNumbers(text: string, find: (s: string) => Hit[]): string {
  // Kilka zdań: zostają te bez nieznanych liczb.
  const sentences = text.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  const clean = sentences.filter((x) => !find(x).length);
  let s = text;
  if (sentences.length > 1 && clean.length) s = clean.join(' ');
  else {
    // Nawias z liczbą ("(ok. 30 osób)") i dalsze człony zdania z liczbą (", co zwiększyło zasięg o 40%").
    s = s.replace(/\s*\([^()]*\)/g, (m) => (find(m).length ? '' : m));
    const parts = s.split(/(?=,\s|;\s|:\s|\s[-–]\s)/u);
    s = [parts[0], ...parts.slice(1).filter((p) => !find(p).length)].join('');
    // Od końca, żeby pozycje wcześniejszych liczb zostały aktualne.
    for (const hit of find(s).reverse()) {
      const next = cutNumber(s, hit);
      if (next === null) return '';
      s = next;
    }
  }
  const out = tidy(s, text);
  return out.split(' ').length >= 2 && !find(out).length && out !== text.trim() ? out : '';
}

/** Teksty CV, które kandydat już potwierdził (status "fact"). */
export function factTexts(c: CvContent): string[] {
  return [c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)].filter((t) => t.status === 'fact').map((t) => t.text);
}

export interface GroundOptions {
  lang: Lang;
  /** Teksty, których liczby kandydat już potwierdził (np. zaakceptowane punkty poprawianego CV). */
  confirmed?: string[];
  /** Nazwy z liczbą, które nie są ilością (zob. numberedNames). */
  names?: string[];
  /** Słowa kluczowe ogłoszenia: po nich poznajemy w tytule nazwy, które profil musi potwierdzić. */
  keywords?: Keyword[];
  /** Obecne CV przy poprawie, skracaniu, poleceniu i synchronizacji: niezmieniony tytuł zostaje z sugestią. */
  current?: CvContent;
}

/**
 * Fakty z profilu zamiast słów modelu: firma i daty doświadczenia, daty edukacji. Liczba, której nie ma w profilu
 * (ani w extraFacts z has=true), zmienia fakt w sugestię do potwierdzenia, z wersją bez tej liczby, jeśli da się ją prosto uzyskać.
 */
export function groundCv(c: CvContent, profile: Profile, opts: GroundOptions): CvContent {
  const exp = new Map(profile.experience.map((e) => [e.id, e]));
  const edu = new Map(profile.education.map((e) => [e.id, e]));
  const find = numberFinder(knownNumbers([...profileTexts(profile), ...(opts.confirmed ?? [])]), opts.names);

  const check = (t: CvText): CvText => {
    if (t.status === 'fact') {
      const hits = find(t.text);
      if (!hits.length) return t;
      const numbers = [...new Set(hits.map((h) => h.token + (/^\s?%/.test(t.text.slice(h.index + h.token.length)) ? '%' : '')))].join(', ');
      return { ...t, status: 'suggested', reason: tr('Liczba spoza profilu ({numbers}) - potwierdź albo odrzuć.', { numbers }), fallbackText: withoutNumbers(t.text, find) };
    }
    // Wersja bezpieczna po odrzuceniu sugestii staje się faktem, więc też nie może mieć zmyślonej liczby.
    if (t.fallbackText && find(t.fallbackText).length) return { ...t, fallbackText: withoutNumbers(t.fallbackText, find) };
    return t;
  };

  return {
    ...c,
    ...groundHeadline(c, profile, opts),
    summary: check(c.summary),
    experience: c.experience.map((e) => {
      const src = exp.get(e.sourceId);
      if (!src) return { ...e, bullets: e.bullets.map(check) };
      const dates = cvDateRange(src.start, src.end, src.current, opts.lang);
      return { ...e, company: src.company.trim(), dates: dates ?? e.dates, bullets: e.bullets.map(check) };
    }),
    projects: c.projects.map((p) => ({ ...p, bullets: p.bullets.map(check) })),
    education: c.education.map((e) => {
      const src = edu.get(e.sourceId);
      const dates = src ? cvDateRange(src.start, src.end, src.current, opts.lang) : null;
      return dates === null ? e : { ...e, dates };
    }),
  };
}
