import type { AiReview, AtsReport, CvContent, JobPosting, Keyword, Profile } from '../../../shared/schemas';
import {
  aliasVariants,
  cvKeywordSources,
  findKeyword,
  isSoftSkill,
  looksPolish,
  normalize,
  scoreKeywords,
  type KeywordSource,
  type KeywordWhere,
  type MatchLang,
} from '../../ats/keywords';
import { datesConsistent } from '../../ats/formatChecks';
import { tr } from '../../i18n';

// Plan dla "Popraw automatycznie": tylko to, co da się poprawić zgodnie z prawdą, i pytania o resztę.

/** Fragment profilu z opisem miejsca (dla modelu). */
export interface ProfileSource extends KeywordSource {
  label: string;
}

/** Fragmenty profilu jak sekcje CV: opis i osiągnięcia to dowód (punkt), lista umiejętności tylko wymienienie. */
export function profileSources(p: Profile): ProfileSource[] {
  const out: ProfileSource[] = [];
  const add = (where: KeywordWhere, credit: number, bullet: boolean, label: string, texts: string[]) => {
    for (const text of texts) if (text?.trim()) out.push({ where, credit, bullet, label, text });
  };
  add('headline', 0.5, false, 'nagłówek profilu', [p.headline]);
  add('summary', 1, false, 'podsumowanie profilu', [p.summary]);
  for (const e of p.experience) {
    const label = `doświadczenie „${[e.role, e.company].filter(Boolean).join(', ')}” (id ${e.id})`;
    add('experience', 1, false, label, [e.role]);
    add('experience', 1, true, label, [e.description, ...e.achievements]);
  }
  for (const x of p.projects) {
    const label = `projekt „${x.name}” (id ${x.id})`;
    add('projects', 1, false, label, [x.name, x.role]);
    add('technologies', 0.5, false, label, x.technologies);
    add('projects', 1, true, label, [x.description, ...x.achievements]);
  }
  for (const e of p.education) {
    add('education', 1, false, `wykształcenie „${[e.school, e.field].filter(Boolean).join(', ')}” (id ${e.id})`, [e.degree, e.field, e.school, e.details]);
  }
  add('skills', 0.5, false, 'umiejętności w profilu', p.skills.map((s) => s.name));
  for (const c of p.certificates) add('certificates', 1, false, `certyfikat „${c.name}” (id ${c.id})`, [`${c.name} ${c.issuer}`]);
  add('languages', 1, false, 'języki w profilu', p.languages.map((l) => `${l.name} ${l.level}`));
  add('interests', 0.5, false, 'zainteresowania w profilu', p.interests);
  // Odpowiedź "mam" z opisem to dowód; samo "tak" bez opisu tylko potwierdza umiejętność.
  for (const f of p.extraFacts.filter((x) => x.has)) {
    const label = `odpowiedź kandydata „${f.topic}” (extraFacts, id ${f.id})`;
    if (f.answer.trim().split(/\s+/).length >= 3) add('experience', 1, true, label, [`${f.topic}: ${f.answer}`]);
    else add('skills', 0.5, false, label, [f.topic]);
  }
  return out;
}

export interface AddableKeyword {
  term: string;
  importance: 'must' | 'nice';
  /** 'missing' = nie ma w CV; 'listOnly' = w CV tylko wymienione (lista umiejętności, nagłówek), bez dowodu w treści */
  status: 'missing' | 'listOnly';
  /** sekcje CV, w których słowo już jest */
  inCv: KeywordWhere[];
  /** brzmienie, które pasuje do profilu (np. "WYSZUKAJ.PIONOWO" dla "VLOOKUP") */
  profileWording: string;
  /** tekst profilu, który to potwierdza */
  profileText: string;
  where: string;
  todo: string;
}

export interface ImprovePlan {
  addable: AddableKeyword[];
  fixes: { section: string; find: string; replace: string; why: string }[];
  criteria: { key: string; score: number; comment: string; goal: string }[];
  format: string[];
  /** słowa powtórzone za często */
  stuffed: string[];
  /** słowa kluczowe, które obecne CV już ma (w tym brzmieniu) - nie wolno ich zgubić */
  keep: string[];
  /** pytania do kandydata: co dopisać w profilu (w języku interfejsu) */
  needsInput: string[];
}

const CRITERION_GOAL: Partial<Record<AiReview['criteria'][number]['key'], string>> = {
  must_have_match: 'Pokaż wymagania obowiązkowe w punktach doświadczenia, projektów albo w wykształceniu (dowód zamiast samej listy), tylko tam, gdzie profil to potwierdza.',
  summary_fit: 'Nagłówek = nazwa stanowiska z ogłoszenia; podsumowanie: kluczowe wymagania z ogłoszenia, które profil potwierdza, i jeden konkretny dowód.',
  clarity: 'Krótkie punkty zaczynające się od czynności, bez powtórzeń, najtrafniejsze na górze.',
  red_flags: 'Usuń frazesy bez dowodu, powtórzenia i niespójności wskazane w komentarzu.',
};

const MAX_TEXT = 300;
const MAX_QUESTIONS = 8;
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

// Tytuł bez poziomu i dopisków ("Młodszy Analityk … (K/M)" i "analityk …" to ten sam tytuł).
const SENIORITY = /(^|\s)(mlodszy|mlodsza|starszy|starsza|junior|senior|mid|regular|stazysta|stazystka|praktykant|praktykantka|intern|trainee)(?=\s|$)/g;
const GENDER_MARK = /(^|\s)[kmfdnx](\/[kmfdnx])+(?=\s|$)/g;
export const titleCore = (s: string) =>
  normalize(s).replace(GENDER_MARK, ' ').replace(SENIORITY, ' ').replace(SENIORITY, ' ').replace(/\s+/g, ' ').trim();

/** Słowo kluczowe z odpowiednikami (aliasy), żeby polski profil potwierdzał angielskie brzmienie. */
const widened = (kw: Keyword): Keyword => ({ ...kw, synonyms: [...new Set([kw.term, ...kw.synonyms].flatMap(aliasVariants))] });

/**
 * Co AI może poprawić bez nowych faktów: słowa kluczowe, które profil potwierdza, poprawki bez danych od kandydata,
 * słabe kryteria (bez "achievements", którego nie podniesie się bez nowych faktów) i format. Reszta to pytania do kandydata.
 */
export function improvePlan(report: AtsReport, profile: Profile, posting: JobPosting, cv: CvContent): ImprovePlan {
  const sources = profileSources(profile);
  const lang: MatchLang = looksPolish(sources.map((s) => s.text).join(' ')) ? 'pl' : 'en';
  const cvSources = cvKeywordSources(cv);
  const addable: AddableKeyword[] = [];
  const needsInput: string[] = [];
  const keep: string[] = [];

  for (const kw of posting.keywords) {
    const inCv = findKeyword(kw, cvSources, cv.language);
    if (inCv) keep.push(inCv.foundAs);
    // Tytuł stanowiska to nie umiejętność: nie ma czego dopisywać do profilu ani przenosić do punktów.
    if (titleCore(kw.term) === titleCore(posting.title)) continue;
    if (inCv && inCv.credit >= 1) continue;
    const soft = isSoftSkill(kw);
    const wide = widened(kw);
    const hits = sources.flatMap((src) => {
      const m = findKeyword(wide, [src], lang);
      return m ? [{ src, m }] : [];
    });
    const strong = hits.find((h) => h.m.credit >= 1);
    // Kompetencja miękka na samej liście nic nie daje: potrzebny przykład w punkcie.
    const weak = !strong && !soft && !inCv ? hits[0] : undefined;
    const hit = strong ?? weak;
    if (hit) {
      addable.push({
        term: kw.term,
        importance: kw.importance,
        status: inCv ? 'listOnly' : 'missing',
        inCv: inCv?.where ?? [],
        profileWording: hit.m.foundAs,
        profileText: cut(hit.src.text),
        where: hit.src.label,
        todo: inCv
          ? 'W CV jest tylko wymienione, bez dowodu w treści: przenieś je do punktu doświadczenia lub projektu (albo do podsumowania), w którym to prawda, zgodnie z profileText.'
          : strong
            ? 'Dodaj dosłownym brzmieniem z ogłoszenia w treści (punkt doświadczenia lub projektu, podsumowanie, wykształcenie), tam gdzie profil to potwierdza.'
            : 'Profil ma to tylko na liście umiejętności: dodaj do sekcji umiejętności dosłownym brzmieniem z ogłoszenia.',
      });
      continue;
    }
    if (kw.importance !== 'must') continue;
    const term = kw.term;
    if (hits.length && soft) needsInput.push(tr('„{term}”: dopisz w profilu przykład z pracy albo projektu, który to pokazuje.', { term }));
    else if (hits.length) needsInput.push(tr('„{term}”: w profilu jest tylko na liście umiejętności. Dopisz, gdzie tego używasz (np. w opisie stażu albo projektu), a CV pokaże to jako dowód.', { term }));
    else needsInput.push(tr('„{term}” (wymagane w ogłoszeniu): jeśli to znasz, dopisz w profilu, gdzie i jak tego używasz.', { term }));
  }

  const review = report.ai?.review ?? null;
  const fixes = (review?.fixes ?? []).filter((f) => !f.needsUserInput).map(({ section, find, replace, why }) => ({ section, find, replace, why }));
  const asks = (review?.fixes ?? []).filter((f) => f.needsUserInput).map((f) => (f.why.trim() || f.replace.trim()));
  const criteria = (review?.criteria ?? [])
    .filter((c) => c.score < 7 && CRITERION_GOAL[c.key])
    .map((c) => ({ key: c.key, score: c.score, comment: c.comment, goal: CRITERION_GOAL[c.key]! }));
  // Efektów nie da się dopisać bez nowych faktów; pytamy, jeśli rekruter nie zadał już konkretnych pytań.
  const achievements = review?.criteria.find((c) => c.key === 'achievements');
  if (achievements && achievements.score < 7 && !asks.length) {
    asks.push(tr('Konkretne efekty: dopisz w profilu wyniki swojej pracy (liczby, skala, co powstało), jeśli je znasz.'));
  }

  const format: string[] = [];
  if (report.format.pages > 1) format.push(`CV ma ${report.format.pages} strony: skróć je do jednej strony (skróć albo usuń najmniej trafne punkty).`);
  if (!datesConsistent(cv)) format.push('Daty są w różnych formatach: zapisz wszystkie w jednym formacie (po polsku MM.RRRR, po angielsku MM/YYYY).');
  const contact: string[] = [];
  if (!profile.contact.fullName.trim()) contact.push(tr('Brak imienia i nazwiska w profilu - uzupełnij je.'));
  if (!profile.contact.email.trim()) contact.push(tr('Brak e-maila w profilu - ATS nie będzie mógł się z Tobą skontaktować.'));
  if (profile.contact.phone.replace(/\D/g, '').length < 9) contact.push(tr('Brak telefonu w profilu (albo jest niepełny).'));

  return {
    addable,
    fixes,
    criteria,
    format,
    stuffed: scoreKeywords(cv, posting.keywords).stuffing,
    keep: [...new Set(keep)],
    // Brak kontaktu najpierw: bez niego ATS nie ma jak odpowiedzieć.
    needsInput: [...new Set([...contact, ...needsInput, ...asks.filter(Boolean)])].slice(0, MAX_QUESTIONS),
  };
}

/** Czy jest coś, co AI może zrobić bez nowych informacji od kandydata. */
export const hasWork = (p: ImprovePlan) => p.addable.length + p.fixes.length + p.criteria.length + p.format.length + p.stuffed.length > 0;

/** Komunikat, gdy AI nie ma czego poprawić: co kandydat może dopisać w profilu. */
export function nothingToImprove(p: ImprovePlan): string {
  if (!p.needsInput.length) return tr('Raport nie wskazuje niczego, co AI mogłoby jeszcze poprawić, więc nowa wersja nie powstała.');
  return [tr('Bez nowych informacji AI nie poprawi już tego CV, więc nowa wersja nie powstała. Możesz dopisać w profilu:'), ...p.needsInput.map((q) => `- ${q}`)].join('\n');
}

/** Plan dla modelu: bez pytań do kandydata. */
export function planForPrompt(p: ImprovePlan) {
  const { needsInput, keep, ...rest } = p;
  return { ...rest, keepKeywords: keep };
}
