import { z } from 'zod';
import type { Profile } from '../../../shared/schemas';
import type { GithubData, GithubRepo } from '../../cv/github';
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

const SYSTEM = (lang: Lang) => `Opisujesz publiczne projekty kandydata z jego GitHuba do sekcji "Projekty" w profilu, z którego potem powstają CV.
Dla każdego repozytorium dostajesz: "repo" (nazwa), "description" (opis z GitHuba), "topics", "languages" (od najczęstszego), "homepage" i "readme" (może być ucięte).
Zasady:
- Zwróć po jednej pozycji dla każdego repozytorium z danych; "repo" przepisz dokładnie.
- Pisz WYŁĄCZNIE na podstawie danych tego repozytorium. Nie wymyślaj funkcji, liczb, użytkowników, klientów, wdrożeń, nagród ani efektów. Liczbę wolno podać tylko wtedy, gdy jest w opisie albo w README.
- "name": czytelna nazwa projektu (np. "weather-app" → "Weather App" albo nazwa z nagłówka README), bez nazwy użytkownika.
- "description": 1-2 zdania: czym jest projekt i do czego służy. Gdy opis i README są puste, napisz tylko to, co wynika z nazwy i języków, bez zgadywania celu.
- "technologies": maks. ${MAX_TECH} pozycji: języki, frameworki, biblioteki, bazy danych i narzędzia, które wynikają z "languages", "topics" albo README. Oficjalna pisownia (TypeScript, React, PostgreSQL), bez ogólników ("programowanie", "aplikacja").
- "achievements": 0-${MAX_ACHIEVEMENTS} krótkie punkty o konkretnych funkcjach albo rozwiązaniach opisanych w README. Pusta lista, jeśli README nie mówi nic konkretnego. Bez ocen ("świetny", "zaawansowany").
- ${
  lang === 'pl'
    ? 'Pisz po polsku, także gdy README jest po angielsku. Opis i punkty formą rzeczownikową ("Aplikacja webowa do…", "Generowanie raportów PDF", "Obsługa logowania przez Google"), nigdy w 1. osobie ("Zbudowałem…", "Stworzyłam…").'
    : 'Pisz po angielsku, także gdy README jest po polsku. Punkty zaczynaj od czasownika w czasie przeszłym (Built, Implemented, Added) albo od nazwy funkcji, bez "I" i innych zaimków.'
}
- Nazwy technologii i własne nazwy projektów zostaw w oryginale.
- "O AUTORZE" (bio i README profilu) to tylko kontekst: nie przypisuj z niego niczego repozytorium, chyba że wprost je opisuje.`;

/** Punkty w 1. osobie (po polsku) albo od "I" (po angielsku) wracają do poprawki. */
function checkedSchema(lang: Lang) {
  return GithubProjectsSchema.superRefine((res, ctx) => {
    res.projects.forEach((p, i) => {
      const texts: [string, (string | number)[]][] = [[p.description, ['projects', i, 'description']], ...p.achievements.map((a, j): [string, (string | number)[]] => [a, ['projects', i, 'achievements', j]])];
      for (const [t, path] of texts) {
        const verb = lang === 'pl' ? firstPersonVerb(t) : null;
        if (verb) ctx.addIssue({ code: 'custom', path, message: `Tekst w 1. osobie („${verb}”). Pisz formą rzeczownikową, np. „Generowanie raportów…”, „Aplikacja do…”.` });
        if (lang === 'en' && STARTS_WITH_I.test(t)) ctx.addIssue({ code: 'custom', path, message: 'Tekst zaczyna się od "I". Zacznij od czasownika w czasie przeszłym, np. "Built…", albo od nazwy funkcji.' });
      }
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
export function finishProjects(repos: GithubRepo[], described: GithubProjectText[]): GithubProjectText[] {
  const byRepo = new Map(described.map((d) => [d.repo.trim().toLowerCase(), d]));
  return repos.map((r) => {
    const d = byRepo.get(r.name.toLowerCase());
    const source = [r.name, r.description, r.readme, r.homepage, ...r.topics, ...r.languages, r.createdAt.slice(0, 4), r.pushedAt.slice(0, 4)].join(' ');
    const known = new Set(numbers(source));
    const grounded = (s: string) => numbers(s).every((n) => known.has(n));

    const seen = new Set<string>();
    const technologies = (d?.technologies.length ? d.technologies : r.languages)
      .map((t) => t.replace(/(^|\s)v?\d+(?:\.\d+)*(?=\s|$)/g, (m, pre: string) => (grounded(m) ? m : pre)).replace(/\s+/g, ' ').trim())
      .filter((t) => {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_TECH);

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
