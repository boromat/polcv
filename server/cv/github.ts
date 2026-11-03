import type { Profile } from '../../shared/schemas';
import { parseGithubUser } from '../../shared/github';
import { APP_UA } from '../jobs/http';
import { HttpError, newId } from '../storage/store';
import { lang, tr } from '../i18n';

/**
 * Projekty z publicznego GitHuba: konto, lista repozytoriów, a dla każdego języki i README.
 * Bez logowania (limit 60 zapytań na godzinę): konto + lista + README profilu + 2 na repozytorium = do 23 zapytań.
 */

export { parseGithubUser };

const API = 'https://api.github.com';
/** Tyle ostatnio zmienianych repozytoriów bierzemy naraz. */
export const MAX_REPOS = 10;
/** README skracamy: AI ma dostać sedno, a nie całą dokumentację. */
export const README_CHARS = 2500;
/** Zmiana w ciągu tylu dni = projekt trwa (puste "Do"). */
export const ONGOING_DAYS = 90;

type Project = Profile['projects'][number];
type Skill = Profile['skills'][number];

/** Repozytorium tak, jak zwraca je GitHub (tylko używane pola). */
export interface GhRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived?: boolean;
  size?: number;
  topics?: string[];
  homepage?: string | null;
  created_at: string;
  pushed_at: string | null;
}

export interface GithubRepo {
  name: string;
  url: string;
  description: string;
  topics: string[];
  languages: string[];
  homepage: string;
  readme: string;
  createdAt: string;
  pushedAt: string;
  archived: boolean;
}

export interface GithubData {
  login: string;
  name: string;
  bio: string;
  blog: string;
  /** README repozytorium profilu ({login}/{login}): kontekst "o mnie", nie projekt */
  about: string;
  /** repozytoria do opisania (bez tych, które są już w profilu) */
  repos: GithubRepo[];
  /** nazwy repozytoriów pominiętych, bo są już w profilu */
  known: string[];
}

// ---------- Zapytania ----------

/** Błąd o wyczerpanym limicie zapytań (z godziną odnowienia); null, gdy to nie limit. */
export function rateLimitError(res: Response, now = Date.now()): HttpError | null {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const retryAfter = Number(res.headers.get('retry-after'));
  const limited = res.status === 429 || (res.status === 403 && (remaining === '0' || retryAfter > 0));
  if (!limited) return null;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const at = remaining === '0' && reset > 0 ? reset * 1000 : retryAfter > 0 ? now + retryAfter * 1000 : 0;
  if (!at) return new HttpError(429, tr('GitHub chwilowo ogranicza liczbę zapytań bez logowania. Spróbuj ponownie za godzinę.'));
  const min = Math.max(1, Math.ceil((at - now) / 60_000));
  const time = new Date(at).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });
  return new HttpError(429, tr('GitHub chwilowo ogranicza liczbę zapytań bez logowania (60 na godzinę). Spróbuj ponownie o {time} (za ok. {min} min).', { time, min }));
}

async function gh(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { 'User-Agent': APP_UA, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    const reason = e?.name === 'TimeoutError' ? tr('przekroczony czas') : (e?.message ?? String(e));
    throw new HttpError(502, tr('Brak połączenia z GitHubem ({reason}). Sprawdź internet i spróbuj ponownie.', { reason }));
  }
  const limited = rateLimitError(res);
  if (limited) throw limited;
  return res;
}

const failed = (status: number) => new HttpError(502, tr('GitHub odpowiedział kodem {status}. Spróbuj ponownie za chwilę.', { status }));

/** Szczegóły repozytorium są dodatkiem: brak README czy chwilowy błąd daje pustą wartość, tylko limit przerywa import. */
async function optional<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw e;
    return empty;
  }
}

const repoPath = (fullName: string) => fullName.split('/').map(encodeURIComponent).join('/');

/** Języki od najczęstszego (wg bajtów kodu); pomijamy te poniżej 3% repozytorium. */
export function topLanguages(bytes: Record<string, number>, max = 5): string[] {
  const list = Object.entries(bytes ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, [, n]) => s + n, 0);
  return list.filter(([, n], i) => i === 0 || n / total >= 0.03).slice(0, max).map(([l]) => l);
}

/** README bez obrazków, odznak, HTML i komentarzy, skrócone do README_CHARS znaków. */
export function cleanReadme(md: string): string {
  const text = md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // odznaka z linkiem
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // obrazek
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > README_CHARS ? `${text.slice(0, README_CHARS).trimEnd()}…` : text;
}

async function readme(fullName: string): Promise<string> {
  const res = await gh(`/repos/${repoPath(fullName)}/readme`, 'application/vnd.github.raw');
  return res.ok ? cleanReadme(await res.text()) : '';
}

async function languages(fullName: string): Promise<string[]> {
  const res = await gh(`/repos/${repoPath(fullName)}/languages`);
  return res.ok ? topLanguages(await res.json()) : [];
}

/** Własne repozytoria do opisania: bez forków, pustych i repozytorium profilu; maks. MAX_REPOS ostatnio zmienianych. */
export function pickRepos(repos: GhRepo[], login: string): { projects: GhRepo[]; profileRepo: GhRepo | null } {
  const own = repos.filter((r) => !r.fork);
  const isProfile = (r: GhRepo) => r.name.toLowerCase() === login.toLowerCase();
  const projects = own
    .filter((r) => !isProfile(r) && r.size !== 0)
    .sort((a, b) => (b.pushed_at ?? b.created_at).localeCompare(a.pushed_at ?? a.created_at))
    .slice(0, MAX_REPOS);
  return { projects, profileRepo: own.find(isProfile) ?? null };
}

/** Konto i repozytoria; `known` = repozytorium jest już w profilu (bez szczegółów i bez opisu przez AI). */
export async function fetchGithub(username: string, known: (r: GhRepo) => boolean = () => false): Promise<GithubData> {
  const userRes = await gh(`/users/${encodeURIComponent(username)}`);
  if (userRes.status === 404) throw new HttpError(404, tr('Na GitHubie nie ma użytkownika „{user}”. Sprawdź nazwę albo link do profilu.', { user: username }));
  if (!userRes.ok) throw failed(userRes.status);
  const user: any = await userRes.json();
  const login = String(user.login || username);
  if (user.type === 'Organization') throw new HttpError(422, tr('„{user}” to organizacja, a nie konto osoby. Podaj swoją nazwę użytkownika z GitHuba.', { user: login }));

  const reposRes = await gh(`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`);
  if (!reposRes.ok) throw failed(reposRes.status);
  const list: GhRepo[] = await reposRes.json();
  const { projects, profileRepo } = pickRepos(Array.isArray(list) ? list : [], login);
  if (!projects.length) throw new HttpError(422, tr('Użytkownik {user} nie ma na GitHubie publicznych projektów (forki pomijamy).', { user: login }));

  const fresh = projects.filter((r) => !known(r));
  const [about, repos] = await Promise.all([
    profileRepo && fresh.length ? optional(() => readme(profileRepo.full_name), '') : Promise.resolve(''),
    Promise.all(
      fresh.map(async (r): Promise<GithubRepo> => {
        const [langs, text] = await Promise.all([optional(() => languages(r.full_name), []), optional(() => readme(r.full_name), '')]);
        return {
          name: r.name,
          url: r.html_url,
          description: (r.description ?? '').trim(),
          topics: r.topics ?? [],
          languages: langs,
          homepage: (r.homepage ?? '').trim(),
          readme: text,
          createdAt: r.created_at,
          pushedAt: r.pushed_at ?? r.created_at,
          archived: !!r.archived,
        };
      }),
    ),
  ]);
  return {
    login,
    name: String(user.name ?? ''),
    bio: String(user.bio ?? ''),
    blog: String(user.blog ?? ''),
    about,
    repos,
    known: projects.filter(known).map((r) => r.name),
  };
}

// ---------- Projekty w profilu ----------

/** Daty w formacie profilu (RRRR-MM): początek = utworzenie repozytorium, koniec = ostatnia zmiana, pusty = trwa. */
export function projectDates(r: Pick<GithubRepo, 'createdAt' | 'pushedAt' | 'archived'>, now = Date.now()): { start: string; end: string } {
  const ym = (iso: string) => /^\d{4}-\d{2}/.exec(iso)?.[0] ?? '';
  const ongoing = !r.archived && now - Date.parse(r.pushedAt) < ONGOING_DAYS * 86_400_000;
  return { start: ym(r.createdAt), end: ongoing ? '' : ym(r.pushedAt) };
}

/** Projekt profilu z repozytorium i opisu od AI; daty, link i rola z kodu, nie od AI. */
export function githubProject(
  r: GithubRepo,
  text: { name: string; description: string; technologies: string[]; achievements: string[] },
  language: 'pl' | 'en',
  now = Date.now(),
): Project {
  return {
    id: newId(),
    name: text.name,
    role: language === 'en' ? 'Author' : 'Autor',
    ...projectDates(r, now),
    description: text.description,
    technologies: text.technologies,
    link: r.url,
    achievements: text.achievements,
  };
}

/** Link do porównań: bez protokołu, "www.", ".git" i końcowego ukośnika, małymi literami. */
export const normalizeLink = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.git$/, '').replace(/\/+$/, '');

/** Nazwa do porównań: same litery i cyfry ("CV-Maker" = "cv maker"). */
const nameKey = (s: string) =>
  s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Umiejętność do porównań: bez wielkości liter, spacji, kropek i myślników ("Node.js" = "NodeJS"), ale C++ ≠ C#. */
const skillKey = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, '');

const TOOLS = new Set(
  [
    'Git', 'GitHub', 'GitHub Actions', 'GitLab', 'GitLab CI', 'Bitbucket', 'Docker', 'Docker Compose', 'Kubernetes', 'Jenkins', 'Jira',
    'Figma', 'Postman', 'VS Code', 'Visual Studio', 'Visual Studio Code', 'IntelliJ IDEA', 'Jupyter', 'Jupyter Notebook', 'npm', 'Yarn',
    'pnpm', 'Webpack', 'Vite', 'ESLint', 'Prettier', 'Excel', 'MS Excel', 'Power BI', 'Tableau', 'Vercel', 'Netlify', 'Heroku',
  ].map(skillKey),
);

/** Czy repozytorium jest już w profilu: ten sam link albo ta sama nazwa projektu. */
export function knownRepo(profile: Profile): (r: Pick<GhRepo, 'name' | 'html_url'>) => boolean {
  const links = new Set(profile.projects.map((p) => normalizeLink(p.link)).filter(Boolean));
  const names = new Set(profile.projects.map((p) => nameKey(p.name)).filter(Boolean));
  return (r) => links.has(normalizeLink(r.html_url)) || names.has(nameKey(r.name));
}

export interface GithubMerge {
  profile: Profile;
  added: { projects: string[]; skills: string[] };
  newIds: string[];
}

/**
 * Dopisuje do profilu tylko nowe projekty (ten sam link albo nazwa = już jest; istniejących nie zmienia),
 * brakujące technologie nowych projektów jako umiejętności i link do konta GitHub w kontakcie.
 */
export function mergeGithubProjects(profile: Profile, projects: Project[], login: string, makeId: () => string = newId): GithubMerge {
  const isKnown = knownRepo(profile);
  const names = new Set(profile.projects.map((p) => nameKey(p.name)).filter(Boolean));
  const links = new Set<string>();
  const fresh = projects.filter((p) => {
    const link = normalizeLink(p.link);
    const repo = link.split('/').pop() ?? '';
    if (isKnown({ name: repo, html_url: p.link }) || names.has(nameKey(p.name)) || links.has(link)) return false;
    links.add(link);
    return true;
  });

  const skillKeys = new Set(profile.skills.map((s) => skillKey(s.name)));
  // Własny projekt użyty w innym projekcie (np. biblioteka autora) to projekt, a nie umiejętność.
  for (const p of [...profile.projects, ...projects]) {
    skillKeys.add(skillKey(p.name));
    skillKeys.add(skillKey(normalizeLink(p.link).split('/').pop() ?? ''));
  }
  const skills: Skill[] = [];
  for (const tech of fresh.flatMap((p) => p.technologies)) {
    const name = tech.trim();
    const key = skillKey(name);
    if (!key || skillKeys.has(key)) continue;
    skillKeys.add(key);
    skills.push({ id: makeId(), name, category: TOOLS.has(key) ? 'narzędzia' : 'techniczne', level: '' });
  }

  const url = `https://github.com/${login}`;
  const hasLink = profile.contact.links.some((l) => normalizeLink(l.url) === normalizeLink(url));
  return {
    profile: {
      ...profile,
      projects: [...profile.projects, ...fresh],
      skills: [...profile.skills, ...skills],
      contact: hasLink ? profile.contact : { ...profile.contact, links: [...profile.contact.links, { label: 'GitHub', url }] },
    },
    added: { projects: fresh.map((p) => p.name), skills: skills.map((s) => s.name) },
    newIds: [...fresh, ...skills].map((x) => x.id),
  };
}
