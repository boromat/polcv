import type { CvContent, JobPosting, MockProbe, MockQuestionKind, Profile } from '../../../shared/schemas';
import { aliasVariants, countPhrase, isSoftSkill, normalize, tokenize } from '../../ats/keywords';
import { tr } from '../../i18n';
import { cvDateRange, cvSkillItems, isNameWord, knownNumbers, numberedNames, numberFinder, skillBase, skillWords, summaryPersonIssues } from './cvChecks';

// Kontrole próbnej rozmowy w kodzie, jak cvChecks.ts dla CV: co rekruter dopyta (liczone bez AI) i czy mocniejsza
// wersja odpowiedzi nie dopisuje kandydatowi niczego spoza profilu, CV i jego własnych odpowiedzi.

type Lang = 'pl' | 'en';

/** Język rozmowy: ten sam wybór co w przygotowaniu do rozmowy. */
export const interviewLang = (p: JobPosting): Lang => (p.language === 'en' || p.cvLanguageRequired === 'en' ? 'en' : 'pl');

const ENGLISH = /angiel|english/i;

/** Rozmowa po polsku, a ogłoszenie wymaga angielskiego: jedno pytanie ma paść po angielsku. */
export function needsEnglishQuestion(p: JobPosting): boolean {
  if (interviewLang(p) === 'en') return false;
  return (
    p.keywords.some((k) => k.category === 'język' && k.importance === 'must' && [k.term, ...k.synonyms].some((v) => ENGLISH.test(v))) ||
    p.requirementsMust.some((r) => ENGLISH.test(r))
  );
}

// ---------- O co rekruter dopyta ----------

const MAX_PROBES = { skill: 4, numbers: 3, dates: 3 };

/** "RRRR-MM" albo "RRRR" jako liczba miesięcy (do porównań); null przy nietypowym zapisie. */
function months(s: string): number | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s.trim());
  return m ? Number(m[1]) * 12 + Number(m[2] ?? 1) - 1 : null;
}

/**
 * Rzeczy z CV i profilu, o które rekruter dopyta: umiejętność z listy bez dowodu w doświadczeniu i projektach, punkt
 * doświadczenia bez liczby, daty projektu inne niż w profilu (np. z repozytorium GitHub) i daty w profilu, które się
 * nie zgadzają. Najpierw to, co ma słowa z ogłoszenia.
 */
export function interviewProbes(cv: CvContent, profile: Profile, posting: JobPosting, now = new Date()): MockProbe[] {
  const lang = cv.language;
  const evidence = tokenize(
    [
      ...cv.experience.flatMap((e) => [e.role, ...e.bullets.map((b) => b.text)]),
      ...cv.projects.flatMap((p) => [p.name, ...p.technologies, ...p.bullets.map((b) => b.text)]),
      ...profile.experience.flatMap((e) => [e.role, e.description, ...e.achievements]),
      ...profile.projects.flatMap((p) => [p.name, p.description, ...p.technologies, ...p.achievements]),
    ].join(' \n '),
  );
  const inPosting = (s: string) => {
    const t = tokenize(s);
    return posting.keywords.some((k) => [k.term, ...k.synonyms].some((v) => !!v.trim() && countPhrase(t, v) > 0));
  };
  const postingFirst = <T>(list: T[], text: (x: T) => string) => [...list].sort((a, b) => Number(inPosting(text(b))) - Number(inPosting(text(a))));

  const skills = postingFirst(
    cvSkillItems(cv).filter((s) => {
      const base = skillBase(s);
      return !!base && !aliasVariants(base).some((v) => countPhrase(evidence, v) > 0);
    }),
    (s) => s,
  )
    .slice(0, MAX_PROBES.skill)
    .map((s): MockProbe => ({
      kind: 'skill',
      item: s,
      detail: tr('Umiejętność „{skill}” jest w CV, ale nie pokazuje jej żaden punkt doświadczenia ani projekt: rekruter zapyta, gdzie jej użyto i z jakim efektem.', { skill: s }),
    }));

  const bullets = postingFirst(
    cv.experience.flatMap((e) =>
      e.bullets.filter((b) => b.status === 'fact' && b.text.trim() && !/\d/.test(b.text)).map((b) => ({ text: b.text, where: [e.role, e.company].filter(Boolean).join(', ') })),
    ),
    (x) => x.text,
  )
    .slice(0, MAX_PROBES.numbers)
    .map((x): MockProbe => ({
      kind: 'numbers',
      item: x.text,
      detail: tr('Punkt „{text}” ({where}) nie ma żadnej liczby: rekruter dopyta o skalę i efekt (ile, jak często, co się zmieniło).', { text: x.text, where: x.where }),
    }));

  const dates: MockProbe[] = [];
  const projects = new Map(profile.projects.map((p) => [p.id, p]));
  for (const p of cv.projects) {
    const src = projects.get(p.sourceId);
    const want = src ? cvDateRange(src.start, src.end, false, lang) : null;
    if (!src || !want || !p.dates.trim() || normalize(want) === normalize(p.dates)) continue;
    const github = /github\.(com|io)/i.test(src.link);
    dates.push({
      kind: 'dates',
      item: p.name,
      detail: github
        ? tr('Daty projektu „{name}” w CV ({cv}) różnią się od dat repozytorium GitHub w profilu ({profile}): rekruter może zapytać, kiedy naprawdę nad nim pracowano.', { name: p.name, cv: p.dates, profile: want })
        : tr('Daty projektu „{name}” w CV ({cv}) różnią się od profilu ({profile}): rekruter może zapytać, kiedy naprawdę nad nim pracowano.', { name: p.name, cv: p.dates, profile: want }),
    });
  }
  const today = now.getFullYear() * 12 + now.getMonth();
  const entries = [
    ...profile.experience.map((e) => ({ name: [e.role, e.company].filter(Boolean).join(', '), start: e.start, end: e.current ? '' : e.end, future: true })),
    ...profile.projects.map((p) => ({ name: p.name, start: p.start, end: p.end, future: true })),
    ...profile.education.map((e) => ({ name: [e.school, e.field].filter(Boolean).join(', '), start: e.start, end: e.current ? '' : e.end, future: false })),
  ];
  for (const e of entries) {
    const s = months(e.start);
    const end = months(e.end);
    if (s !== null && end !== null && end < s) {
      dates.push({ kind: 'dates', item: e.name, detail: tr('„{name}”: data końca ({end}) jest wcześniejsza niż początek ({start}).', { name: e.name, start: e.start, end: e.end }) });
    } else if (e.future && s !== null && s > today) {
      dates.push({ kind: 'dates', item: e.name, detail: tr('„{name}”: początek ({start}) jest w przyszłości.', { name: e.name, start: e.start }) });
    }
  }
  return [...skills, ...bullets, ...dates.slice(0, MAX_PROBES.dates)];
}

// ---------- Plan i pytania rekrutera ----------

/** Formy 2. osoby czasu przeszłego, którymi rekruter zwraca się do kandydata ("pracowałeś", "pracowałaś"). */
const PAST_2ND = /ł(?:eś|aś|oś)$/u;
const OWN_2ND: Record<NonNullable<Profile['pronouns']>, RegExp> = { on: /łeś$/u, ona: /łaś$/u, ono: /łoś$/u };
const PAN = new Set(['Pan', 'Pana', 'Panu', 'Panem', 'Panie']);
const PANI = new Set(['Pani', 'Panią']);

/**
 * Pytanie rekrutera z formą, która nie pasuje do kandydata: inny rodzaj niż ten, który kandydat podał, a bez zaimków
 * jakakolwiek forma z rodzajem ("Czy pracowałeś…", "Czy Pan…"). Nie zgadujemy płci z imienia.
 */
export function addressIssues(text: string, pronouns: Profile['pronouns']): string[] {
  const words = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean);
  const own = pronouns ? OWN_2ND[pronouns] : null;
  const bad = words.filter(
    (w) =>
      (PAST_2ND.test(w.toLowerCase()) && !own?.test(w.toLowerCase())) ||
      (PAN.has(w) && pronouns !== 'on') ||
      (PANI.has(w) && pronouns !== 'ona'),
  );
  return [...new Set(bad)];
}

const genderNote = (pronouns: Profile['pronouns']) =>
  pronouns === 'on'
    ? 'Kandydat określa się jako "on": zwracaj się formami męskimi ("Czy pracowałeś…", "Pan").'
    : pronouns === 'ona'
      ? 'Kandydatka określa się jako "ona": zwracaj się formami żeńskimi ("Czy pracowałaś…", "Pani").'
      : pronouns === 'ono'
        ? 'Kandydat określa się jako "ono": formy nijakie ("Czy pracowałoś…"), bez "Pan" i "Pani".'
        : 'Kandydat nie podał, jak się określa: buduj pytania bez form zależnych od płci ("Jak wyglądała praca…?", "Proszę opowiedzieć…"), bez "Pan" i "Pani".';

export interface PlanQuestion {
  kind: MockQuestionKind;
  text: string;
  lang: Lang;
}

/** Rodzaje pytań, które plan musi mieć; "tools" tylko wtedy, gdy ogłoszenie wymienia narzędzia albo rzeczy mile widziane. */
export function requiredKinds(posting: JobPosting): MockQuestionKind[] {
  const tools = posting.requirementsNice.length > 0 || posting.keywords.some((k) => k.category === 'narzędzie');
  return ['intro', 'experience', 'situational', 'knowledge', ...(tools ? (['tools'] as const) : []), 'gap'];
}

/** Problemy z planem rozmowy do poprawki przez model: liczba pytań, brakujące rodzaje, pytanie po angielsku, formy. */
export function planIssues(questions: PlanQuestion[], posting: JobPosting, pronouns: Profile['pronouns']): string[] {
  const issues: string[] = [];
  if (questions.length < 6 || questions.length > 8) issues.push(`Plan ma ${questions.length} pytań: ułóż od 6 do 8.`);
  const missing = requiredKinds(posting).filter((k) => !questions.some((q) => q.kind === k));
  if (missing.length) issues.push(`W planie brakuje pytań rodzaju: ${missing.join(', ')}. Każdy z tych rodzajów musi mieć co najmniej jedno pytanie.`);
  const lang = interviewLang(posting);
  const en = questions.filter((q) => q.lang === 'en').length;
  if (lang === 'en' && en !== questions.length) issues.push('Rozmowa jest po angielsku: wszystkie pytania mają mieć "lang": "en" i być po angielsku.');
  if (lang === 'pl' && needsEnglishQuestion(posting) && en !== 1) issues.push(`Ogłoszenie wymaga angielskiego: dokładnie jedno pytanie ma być po angielsku ("lang": "en"), a jest ich ${en}.`);
  if (lang === 'pl' && !needsEnglishQuestion(posting) && en > 0) issues.push('Ogłoszenie nie wymaga angielskiego: wszystkie pytania po polsku ("lang": "pl").');
  for (const q of questions) {
    const bad = q.lang === 'pl' ? addressIssues(q.text, pronouns) : [];
    if (bad.length) issues.push(`Pytanie „${q.text}” ma formy, które nie pasują do kandydata (${bad.join(', ')}). ${genderNote(pronouns)}`);
  }
  return issues;
}

/** Pytanie albo dopytanie rekrutera z formą niepasującą do kandydata (komunikat do poprawki). */
export function addressIssue(text: string, pronouns: Profile['pronouns']): string | null {
  const bad = addressIssues(text, pronouns);
  return bad.length ? `Dopytanie „${text}” ma formy, które nie pasują do kandydata (${bad.join(', ')}). ${genderNote(pronouns)}` : null;
}

// ---------- Długość odpowiedzi ----------

/**
 * Kryterium długości liczone w kodzie, nie przez model (Haiku 5.5 dawał zwięzłym odpowiedziom 1, a rozwlekłym 3-4):
 * odpowiedź na rozmowie to ok. 20 s - 1,5 min mówienia, czyli 45-180 słów.
 */
export function lengthScore(answer: string): number {
  const words = answer.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (words < 15) return 1;
  if (words < 30) return 2;
  if (words < 45) return 4;
  if (words <= 180) return 5;
  if (words <= 240) return 3;
  if (words <= 320) return 2;
  return 1;
}

// ---------- Mocniejsza wersja odpowiedzi ----------

/** Miejsce do uzupełnienia w mocniejszej wersji: "[ile dokumentów tygodniowo]". */
const PLACEHOLDER = /\[[^\]\n]{1,100}\]/g;
/** Token polanonu: dana osobowa z wejścia, nie nowy fakt. */
const TOKEN = /<[A-Z_]+_\d+>/g;

export const placeholders = (s: string) => [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[0]))];
const withoutGaps = (s: string) => s.replace(PLACEHOLDER, ' ').replace(TOKEN, ' ');

/** Odpowiedź o wiedzy albo o braku: nazwy z dziedziny ("RODO", "JOIN") nie są tam twierdzeniem o kandydacie. */
const DOMAIN_KINDS = new Set<MockQuestionKind>(['knowledge', 'gap']);
/**
 * Odpowiedź o tym, co kandydat robił: tu każdy skrót i nazwa techniczna ("SQL", "Power BI") muszą mieć pokrycie.
 * W zadaniu sytuacyjnym, o narzędziach i w przedstawieniu się pojęcia z dziedziny ("CTR", "KPI") są naturalne,
 * więc tam sprawdzamy tylko narzędzia i nazwy z ogłoszenia.
 */
const EXPERIENCE_KINDS = new Set<MockQuestionKind>(['experience', 'probe']);

/** Narzędzie, certyfikat albo nazwana umiejętność z ogłoszenia (nie język i nie kompetencja miękka). */
function namedKeyword(k: JobPosting['keywords'][number]): boolean {
  if (!['narzędzie', 'certyfikat', 'umiejętność'].includes(k.category) || isSoftSkill(k)) return false;
  return k.category !== 'umiejętność' || [k.term, ...k.synonyms].some((v) => /^\p{Lu}/u.test(v.trim()) || skillWords(v).some(isNameWord));
}

const sourceFinder = (src: FactSources) => {
  const tokens = tokenize(src.texts.join(' \n '));
  return (v: string) => countPhrase(tokens, v) > 0;
};
const variantsOf = (k: JobPosting['keywords'][number]) => [k.term, ...k.synonyms].filter((v) => v.trim());

/** Narzędzia i nazwy z ogłoszenia, których kandydat nie ma (do promptu: tych nie wolno mu przypisać). */
export function lackingPostingNames(src: FactSources): string[] {
  const found = sourceFinder(src);
  return src.posting.keywords.filter((k) => namedKeyword(k) && !variantsOf(k).flatMap(aliasVariants).some(found)).map((k) => k.term);
}

export interface FactSources {
  /** Teksty, z których mocniejsza wersja może brać fakty: profil, wysłane CV i odpowiedzi kandydata w tej rozmowie. */
  texts: string[];
  posting: JobPosting;
}

/**
 * Nazwy przypisane kandydatowi, których źródła nie mają: narzędzie albo nazwana umiejętność z ogłoszenia ("Java"),
 * a w odpowiedzi o doświadczeniu także każdy skrót i nazwa techniczna ("SQL", "Power BI"). Synonim z ogłoszenia się
 * liczy ("GA4" przy "Google Analytics 4" w profilu), nazwa firmy i stanowiska z ogłoszenia jest dozwolona.
 */
function unconfirmedNames(text: string, src: FactSources, kind: MockQuestionKind): string[] {
  if (DOMAIN_KINDS.has(kind)) return [];
  const found = sourceFinder(src);
  const allowed = tokenize([src.posting.company, src.posting.title].join(' \n '));
  const synonymFound = (w: string) =>
    src.posting.keywords.some((k) => {
      const variants = variantsOf(k);
      return variants.some((v) => countPhrase(tokenize(v), w) > 0 && countPhrase(tokenize(w), v) > 0) && variants.flatMap(aliasVariants).some(found);
    });
  const known = (w: string) => aliasVariants(w).some(found) || countPhrase(allowed, w) > 0 || synonymFound(w);
  const out = EXPERIENCE_KINDS.has(kind) ? skillWords(text).filter((w) => /\p{L}/u.test(w) && isNameWord(w) && !known(w)) : [];
  const t = tokenize(text);
  for (const k of src.posting.keywords) {
    if (!namedKeyword(k)) continue;
    const variants = variantsOf(k);
    const hit = variants.find((v) => countPhrase(t, v) > 0);
    if (hit && !variants.flatMap(aliasVariants).some(found)) out.push(hit);
  }
  const uniq = [...new Set(out)];
  return uniq.filter((n) => !uniq.some((o) => o !== n && normalize(o).includes(normalize(n))));
}

/**
 * Mocniejsza wersja odpowiedzi nie może niczego wymyślać: liczba albo nazwa spoza profilu, CV i odpowiedzi kandydata
 * wraca do modelu (brakujące dane to miejsca w nawiasach), a po polsku tylko formy z rodzajem kandydata.
 */
export function strongerIssues(text: string, kind: MockQuestionKind, src: FactSources, pronouns: Profile['pronouns'], lang: Lang): string[] {
  const clean = withoutGaps(text);
  const issues: string[] = [];
  const find = numberFinder(knownNumbers(src.texts), numberedNames(src.posting));
  const numbers = [...new Set(find(clean).map((h) => h.token))];
  if (numbers.length) {
    issues.push(
      `Mocniejsza wersja ma liczby, których nie ma w profilu, CV ani w odpowiedziach kandydata: ${numbers.join(', ')}. Nie wymyślaj liczb: w ich miejscu wstaw miejsce do uzupełnienia w nawiasach kwadratowych, np. "[ile dokumentów tygodniowo]".`,
    );
  }
  const names = unconfirmedNames(clean, src, kind);
  if (names.length) {
    issues.push(
      `Mocniejsza wersja przypisuje kandydatowi rzeczy, których nie ma w profilu, CV ani w jego odpowiedziach: ${names.join(', ')}. Nie wymieniaj ich w tej odpowiedzi nawet jako czegoś do nauczenia; opieraj się tylko na tym, co kandydat ma, a czego brakuje, wpisz jako miejsce do uzupełnienia w nawiasach.`,
    );
  }
  if (lang === 'pl') {
    const gendered = summaryPersonIssues(clean, pronouns).gendered;
    if (gendered.length) {
      issues.push(
        pronouns
          ? `Mocniejsza wersja ma formy, które nie pasują do kandydata (${gendered.join(', ')}). Kandydat określa się jako "${pronouns}": czas przeszły tylko w jego formie w 1. osobie.`
          : `Mocniejsza wersja ma formy z rodzajem (${gendered.join(', ')}), a kandydat nie podał, jak się określa: pisz bez form zależnych od płci (czas teraźniejszy, "udało mi się", "moim zadaniem było").`,
      );
    }
  }
  return issues;
}

/** Odwołanie do przepisu z numerem: "art. 32", "ust. 2", "§ 4", "Dz.U. 2019", "2016/679" (numer aktu prawnego). */
const LEGAL_REF = /(?:(?<!\p{L})(?:art\.?|artykuł\p{L}*|ust\.?|ustęp\p{L}*|§|pkt\.?|dz\.\s?u\.?|poz\.?|sec\.?|section|article)\s*\d+[a-z]?|\b\d{4}\/\d{1,4}\b)/giu;

/**
 * Błąd merytoryczny wskazany przez ocenę: poprawka i podpowiedź, gdzie to sprawdzić, bez numerów artykułów, ustępów,
 * paragrafów i aktów prawnych spoza odpowiedzi kandydata i bez linków, bo tych model często nie zna na pewno. Zwykła
 * liczba w poprawce (np. stawka albo próg) zostaje.
 */
export function factualErrorIssues(errors: { claim: string; correction: string; whereToCheck: string }[], answer: string): string[] {
  const inAnswer = new Set([...answer.matchAll(LEGAL_REF)].map((m) => normalize(m[0])));
  const issues: string[] = [];
  for (const e of errors) {
    const text = `${e.correction} ${e.whereToCheck}`;
    const refs = [...new Set([...text.matchAll(LEGAL_REF)].map((m) => m[0]))].filter((r) => !inAnswer.has(normalize(r)));
    if (refs.length) {
      issues.push(`Poprawka błędu „${e.claim}” podaje numery przepisów spoza odpowiedzi kandydata (${refs.join(', ')}). Nie podawaj numerów artykułów, ustępów ani aktów prawnych: opisz poprawkę słowami i wskaż rodzaj źródła (np. oficjalny tekst przepisu).`);
    }
    if (/https?:\/\/|www\./i.test(text)) issues.push(`Poprawka błędu „${e.claim}” ma link. Bez linków: wskaż rodzaj źródła słowami.`);
  }
  return issues;
}
