import { z } from 'zod';
import type { Profile } from '../../../shared/schemas';
import { linkedProjects, type GithubData, type GithubRepo, type GithubUpdate } from '../../cv/github';
import { looksPolish } from '../../ats/keywords';
import { callJson, type LlmContext } from '../openrouter';
import { firstPersonVerb, STARTS_WITH_I } from './cvChecks';
import { json } from './common';

type Lang = 'pl' | 'en';

/** Maks. technologii i punktów na projekt z GitHuba. */
export const MAX_TECH = 8;
export const MAX_ACHIEVEMENTS = 3;

export const GithubProjectsSchema = z.object({
  projects: z.array(
    z.object({
      repo: z.string().describe('nazwa repozytorium dokładnie jak w danych'),
      name: z.string(),
      description: z.string(),
      technologies: z.array(z.string()),
      achievements: z.array(z.string()),
    }),
  ),
});

export type GithubProjectText = z.infer<typeof GithubProjectsSchema>['projects'][number];

// Słówka, po których poznać język profilu bez polskich znaków ("Student informatyki, Politechnika Warszawska").
const PL_WORDS = new Set(['i', 'w', 'z', 'na', 'do', 'oraz', 'dla', 'od', 'po', 'ze', 'we', 'przez', 'przy', 'jest', 'studia', 'student', 'studentka', 'licencjat', 'magister', 'kierunek', 'praca', 'informatyka', 'informatyki', 'rok', 'roku', 'technikum', 'liceum']);
const EN_WORDS = new Set(['the', 'and', 'of', 'with', 'for', 'to', 'from', 'in', 'on', 'at', 'by', 'my', 'an', 'is', 'was', 'using', 'built', 'developed', 'created', 'designed', 'implemented', 'managed', 'bachelor', 'master', 'degree', 'university', 'intern', 'internship', 'engineer', 'developer', 'software', 'science']);

/** Język profilu (jak import CV: zostajemy przy języku kandydata). Pusty albo niejasny profil = po polsku. */
export function profileLanguage(p: Profile): Lang {
  const text = [
    p.headline,
    p.summary,
    ...p.experience.flatMap((e) => [e.role, e.description, ...e.achievements]),
    ...p.education.flatMap((e) => [e.degree, e.field, e.details]),
    ...p.projects.flatMap((x) => [x.description, ...x.achievements]),
    ...p.interests,
  ].join(' \n ');
  if (looksPolish(text)) return 'pl';
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const count = (set: Set<string>) => words.filter((w) => set.has(w)).length;
  const en = count(EN_WORDS);
  return en >= 2 && en > count(PL_WORDS) ? 'en' : 'pl';
}

const STYLE = (lang: Lang) =>
  lang === 'pl'
    ? 'Pisz po polsku, także gdy README jest po angielsku. Opis i punkty formą rzeczownikową ("Aplikacja webowa do…", "Generowanie raportów PDF", "Obsługa logowania przez Google"), nigdy w 1. osobie ("Zbudowałem…", "Stworzyłam…").'
    : 'Pisz po angielsku, także gdy README jest po polsku. Punkty zaczynaj od czasownika w czasie przeszłym (Built, Implemented, Added) albo od nazwy funkcji, bez "I" i innych zaimków.';

const SYSTEM = (lang: Lang) => `Opisujesz publiczne projekty kandydata z jego GitHuba do sekcji "Projekty" w profilu, z którego potem powstają CV.
Dla każdego repozytorium dostajesz: "repo" (nazwa), "description" (opis z GitHuba), "topics", "languages" (od najczęstszego), "homepage" i "readme" (może być ucięte).
Zasady:
- Zwróć po jednej pozycji dla każdego repozytorium z danych; "repo" przepisz dokładnie.
- Pisz WYŁĄCZNIE na podstawie danych tego repozytorium. Nie wymyślaj funkcji, liczb, użytkowników, klientów, wdrożeń, nagród ani efektów. Liczbę wolno podać tylko wtedy, gdy jest w opisie albo w README.
- "name": czytelna nazwa projektu (np. "weather-app" → "Weather App" albo nazwa z nagłówka README), bez nazwy użytkownika.
- "description": 1-2 zdania: czym jest projekt i do czego służy. Gdy opis i README są puste, napisz tylko to, co wynika z nazwy i języków, bez zgadywania celu.
- "technologies": maks. ${MAX_TECH} pozycji: języki, frameworki, biblioteki, bazy danych i narzędzia, które wynikają z "languages", "topics" albo README. Oficjalna pisownia (TypeScript, React, PostgreSQL), bez ogólników ("programowanie", "aplikacja").
- "achievements": 0-${MAX_ACHIEVEMENTS} krótkie punkty o konkretnych funkcjach albo rozwiązaniach opisanych w README. Pusta lista, jeśli README nie mówi nic konkretnego. Bez ocen ("świetny", "zaawansowany").
- ${STYLE(lang)}
- Nazwy technologii i własne nazwy projektów zostaw w oryginale.
- "O AUTORZE" (bio i README profilu) to tylko kontekst: nie przypisuj z niego niczego repozytorium, chyba że wprost je opisuje.`;

type Path = (string | number)[];

/** Tekst w 1. osobie (po polsku) albo od "I" (po angielsku) wraca do poprawki. */
function styleIssues(ctx: z.RefinementCtx, lang: Lang, texts: [string, Path][]) {
  for (const [t, path] of texts) {
    const verb = lang === 'pl' ? firstPersonVerb(t) : null;
    if (verb) ctx.addIssue({ code: 'custom', path, message: `Tekst w 1. osobie („${verb}”). Pisz formą rzeczownikową, np. „Generowanie raportów…”, „Aplikacja do…”.` });
    if (lang === 'en' && STARTS_WITH_I.test(t)) ctx.addIssue({ code: 'custom', path, message: 'Tekst zaczyna się od "I". Zacznij od czasownika w czasie przeszłym, np. "Built…", albo od nazwy funkcji.' });
  }
}

function checkedSchema(lang: Lang) {
  return GithubProjectsSchema.superRefine((res, ctx) => {
    res.projects.forEach((p, i) => {
      styleIssues(ctx, lang, [[p.description, ['projects', i, 'description']], ...p.achievements.map((a, j): [string, Path] => [a, ['projects', i, 'achievements', j]])]);
    });
  });
}

/** Liczby z tekstu, bez separatorów ("1,5" i "1.5" → "15"). */
const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/** "weather-app" → "Weather App" (gdy AI nie podało nazwy). */
const humanName = (repo: string) =>
  repo
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ') || repo;

/**
 * Opisy od AI sprawdzone w kodzie, w kolejności repozytoriów: tekst z liczbą, której nie ma w danych repozytorium, odpada
 * (opis wraca do opisu z GitHuba), wersja dopisana do technologii też ("Python 3" → "Python"); limity technologii i punktów.
 * Repozytorium pominięte przez AI dostaje opis z GitHuba i jego języki.
 */
/** Czy liczby z tekstu są w danych repozytorium (opis, README, tematy, języki, lata utworzenia i zmiany). */
function groundedIn(r: GithubRepo): (s: string) => boolean {
  const source = [r.name, r.description, r.readme, r.homepage, ...r.topics, ...r.languages, r.createdAt.slice(0, 4), r.pushedAt.slice(0, 4)].join(' ');
  const known = new Set(numbers(source));
  return (s) => numbers(s).every((n) => known.has(n));
}

/** Technologie bez wersji spoza danych ("Python 3" → "Python") i bez powtórzeń, maks. MAX_TECH. */
function cleanTechnologies(list: string[], grounded: (s: string) => boolean): string[] {
  const seen = new Set<string>();
  return list
    .map((t) => t.replace(/(^|\s)v?\d+(?:\.\d+)*(?=\s|$)/g, (m, pre: string) => (grounded(m) ? m : pre)).replace(/\s+/g, ' ').trim())
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TECH);
}

export function finishProjects(repos: GithubRepo[], described: GithubProjectText[]): GithubProjectText[] {
  const byRepo = new Map(described.map((d) => [d.repo.trim().toLowerCase(), d]));
  return repos.map((r) => {
    const d = byRepo.get(r.name.toLowerCase());
    const grounded = groundedIn(r);
    const technologies = cleanTechnologies(d?.technologies.length ? d.technologies : r.languages, grounded);

    const description = d?.description.trim() && grounded(d.description) ? d.description.trim() : r.description;
    const achievements = (d?.achievements ?? []).map((a) => a.trim()).filter((a) => a && grounded(a)).slice(0, MAX_ACHIEVEMENTS);
    return { repo: r.name, name: d?.name.trim() || humanName(r.name), description, technologies, achievements };
  });
}

/** Nazwa, opis, technologie i punkty dla każdego repozytorium (jedno wywołanie AI); daty i link dopisuje kod. */
export async function describeGithubRepos(data: GithubData, lang: Lang, ctx: LlmContext): Promise<GithubProjectText[]> {
  if (!data.repos.length) return [];
  const author = { login: data.login, name: data.name, bio: data.bio, blog: data.blog, profileReadme: data.about };
  const repos = data.repos.map((r) => ({ repo: r.name, description: r.description, topics: r.topics, languages: r.languages, homepage: r.homepage, readme: r.readme }));
  const res = await callJson({
    schema: checkedSchema(lang),
    schemaName: 'github_projects',
    tier: 'fast',
    temperature: 0.2,
    maxTokens: 5000,
    system: SYSTEM(lang),
    user: `O AUTORZE:\n${json(author)}\n\nREPOZYTORIA:\n${json(repos)}`,
    ctx,
    // Konto z GitHuba nie musi być tym z profilu, a login stoi w JSON-ie bez linku, więc polanon by go nie poznał.
    terms: [
      { type: 'LINK', text: data.login },
      { type: 'PERSON', text: data.name },
      { type: 'LINK', text: data.blog },
    ],
  });
  return finishProjects(data.repos, res.projects);
}

// ---------- Nowości w projektach, które już są w profilu ----------

export const GithubUpdatesSchema = z.object({
  projects: z.array(
    z.object({
      repo: z.string().describe('nazwa repozytorium dokładnie jak w danych'),
      technologies: z.array(z.string()).describe('tylko technologie, których projekt w profilu jeszcze nie ma'),
      achievements: z.array(z.string()).describe('tylko punkty o funkcjach, których profil jeszcze nie opisuje'),
    }),
  ),
});

export type GithubUpdateText = z.infer<typeof GithubUpdatesSchema>['projects'][number];

const SYSTEM_UPDATES = (lang: Lang) => `Sprawdzasz, co nowego jest w publicznych projektach kandydata z GitHuba, które już ma w profilu.
Dla każdego repozytorium dostajesz: "repo" (nazwa), dane z GitHuba ("description", "topics", "languages" od najczęstszego, "homepage", "readme", może być ucięte) i "inProfile": to, co profil już mówi o tym projekcie ("description", "technologies", "achievements").
Zasady:
- Zwróć po jednej pozycji dla każdego repozytorium z danych; "repo" przepisz dokładnie.
- Tylko NOWE rzeczy, których "inProfile" jeszcze nie ma. Gdy nic nowego nie ma, zwróć puste listy: to normalny wynik.
- "technologies": maks. ${MAX_TECH} technologii z "languages", "topics" albo README, których nie ma w "inProfile.technologies". Ta sama technologia inaczej zapisana ("Node" i "Node.js") to nie nowość. Oficjalna pisownia, bez ogólników.
- "achievements": 0-${MAX_ACHIEVEMENTS} krótkie punkty o konkretnych funkcjach albo rozwiązaniach opisanych w README, których profil nie opisuje ani w "description", ani w "achievements". Ta sama funkcja innymi słowami to nie nowość.
- Pisz WYŁĄCZNIE na podstawie danych tego repozytorium. Nie wymyślaj funkcji, liczb, użytkowników, klientów, wdrożeń, nagród ani efektów. Liczbę wolno podać tylko wtedy, gdy jest w opisie albo w README. Bez ocen ("świetny", "zaawansowany").
- ${STYLE(lang)}
- Nazwy technologii i własne nazwy projektów zostaw w oryginale.`;

function checkedUpdatesSchema(lang: Lang) {
  return GithubUpdatesSchema.superRefine((res, ctx) => {
    res.projects.forEach((p, i) => styleIssues(ctx, lang, p.achievements.map((a, j): [string, Path] => [a, ['projects', i, 'achievements', j]])));
  });
}

/**
 * Nowości od AI sprawdzone w kodzie, w kolejności repozytoriów: punkt z liczbą spoza danych repozytorium odpada, wersja
 * dopisana do technologii też; limity technologii i punktów. Repozytorium pominięte przez AI nie dostaje nic.
 */
export function finishUpdates(repos: GithubRepo[], described: GithubUpdateText[]): GithubUpdate[] {
  const byRepo = new Map(described.map((d) => [d.repo.trim().toLowerCase(), d]));
  return repos.map((r) => {
    const d = byRepo.get(r.name.toLowerCase());
    const grounded = groundedIn(r);
    return {
      url: r.url,
      technologies: cleanTechnologies(d?.technologies ?? [], grounded),
      achievements: (d?.achievements ?? []).map((a) => a.trim()).filter((a) => a && grounded(a)).slice(0, MAX_ACHIEVEMENTS),
    };
  });
}

/** Co nowego w repozytoriach projektów z profilu (jedno wywołanie AI); dopisuje to applyGithubUpdates. */
export async function describeGithubUpdates(data: GithubData, profile: Profile, lang: Lang, ctx: LlmContext): Promise<GithubUpdate[]> {
  if (!data.updates.length) return [];
  const repos = data.updates.map((r) => {
    const mine = linkedProjects(profile, r.url);
    return {
      repo: r.name,
      description: r.description,
      topics: r.topics,
      languages: r.languages,
      homepage: r.homepage,
      readme: r.readme,
      inProfile: {
        description: mine.map((p) => p.description).filter(Boolean).join(' '),
        technologies: [...new Set(mine.flatMap((p) => p.technologies))],
        achievements: mine.flatMap((p) => p.achievements),
      },
    };
  });
  const res = await callJson({
    schema: checkedUpdatesSchema(lang),
    schemaName: 'github_updates',
    tier: 'fast',
    temperature: 0.2,
    maxTokens: 4000,
    system: SYSTEM_UPDATES(lang),
    user: `REPOZYTORIA:\n${json(repos)}`,
    ctx,
    terms: [
      { type: 'LINK', text: data.login },
      { type: 'PERSON', text: data.name },
      { type: 'LINK', text: data.blog },
    ],
  });
  return finishUpdates(data.updates, res.projects);
}
