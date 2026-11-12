import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../shared/schemas';
import type { GhRepo, GithubRepo } from '../server/cv/github';
import * as fixtures from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-github-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const gh = await import('../server/cv/github');
const { finishProjects, finishUpdates, profileLanguage } = await import('../server/llm/prompts/githubProjects');
const { profileForPrompt } = await import('../server/llm/prompts/common');
const { importGithub } = await import('../server/services');
const { profilesRouter } = await import('../server/routes/profiles');
const { langMiddleware, withLang } = await import('../server/i18n');
const { githubUserFromLinks, parseGithubUser } = await import('../shared/github');
const { APP_UA } = await import('../server/jobs/http');
const express = (await import('express')).default;

// ---------- Atrapa sieci: GitHub i OpenRouter (bez prawdziwych zapytań) ----------

type Route = () => Response;
let github: Record<string, Route> = {};
const ghCalls: { path: string; headers: Record<string, string> }[] = [];
let aiReplies: string[] = [];
// Odpowiedzi według nazwy schematu (dwa wywołania AI idą równolegle, więc kolejność nie jest pewna).
let aiByName: Record<string, string[]> = {};
const aiSent: any[] = [];
const realFetch = globalThis.fetch;

const json = (v: unknown, status = 200, headers: Record<string, string> = {}): Route => () =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const text = (v: string): Route => () => new Response(v);

let server: http.Server;
let base = '';

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (input: string | URL, init: any = {}) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return realFetch(input, init);
    if (url.hostname === 'api.github.com') {
      ghCalls.push({ path: url.pathname + url.search, headers: init.headers });
      const route = github[url.pathname + url.search];
      return route ? route() : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (url.hostname === 'openrouter.ai') {
      const body = JSON.parse(init.body);
      aiSent.push(body);
      const named = aiByName[body.response_format?.json_schema?.name];
      const content = named?.length ? named.shift() : aiReplies.shift();
      if (content === undefined) throw new Error('brak odpowiedzi AI w teście');
      return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } }));
    }
    throw new Error(`nieoczekiwany adres: ${url}`);
  });

  const app = express();
  app.use(express.json());
  app.use('/api', langMiddleware, profilesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  github = {};
  ghCalls.length = 0;
  aiReplies = [];
  aiByName = {};
  aiSent.length = 0;
});

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const repo = (name: string, extra: Partial<GhRepo> = {}): GhRepo => ({
  name,
  full_name: `zofia-test/${name}`,
  html_url: `https://github.com/zofia-test/${name}`,
  description: null,
  fork: false,
  size: 100,
  topics: [],
  homepage: null,
  created_at: '2024-01-01T00:00:00Z',
  pushed_at: daysAgo(200),
  ...extra,
});

const info = (name: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({
  name,
  url: `https://github.com/zofia-test/${name}`,
  description: '',
  topics: [],
  languages: [],
  homepage: '',
  readme: '',
  createdAt: '2024-01-01T00:00:00Z',
  pushedAt: '2024-06-01T00:00:00Z',
  archived: false,
  ...extra,
});

type Project = Profile['projects'][number];
const project = (name: string, link: string, technologies: string[] = []): Project => ({
  id: `p-${name}`, name, role: 'Autor', start: '', end: '', description: '', technologies, link, achievements: [],
});

// ---------- Nazwa użytkownika ----------

describe('nazwa użytkownika GitHuba', () => {
  it('przyjmuje nazwę, @nazwę i linki do profilu albo repozytorium', () => {
    expect(parseGithubUser('jan-kowalski')).toBe('jan-kowalski');
    expect(parseGithubUser('  @Jan-Kowalski ')).toBe('Jan-Kowalski');
    expect(parseGithubUser('https://github.com/jan-kowalski')).toBe('jan-kowalski');
    expect(parseGithubUser('github.com/jan-kowalski/')).toBe('jan-kowalski');
    expect(parseGithubUser('http://www.github.com/jan-kowalski?tab=repositories')).toBe('jan-kowalski');
    expect(parseGithubUser('https://github.com/jan-kowalski/weather-app')).toBe('jan-kowalski');
    expect(parseGithubUser('a1')).toBe('a1');
  });

  it('odrzuca to, co nie jest nazwą użytkownika', () => {
    for (const bad of ['', '   ', '-jan', 'jan_kowalski', 'jan kowalski', 'a'.repeat(40), 'https://gitlab.com/jan', 'https://github.com/', 'jan/../x']) {
      expect(parseGithubUser(bad), bad).toBeNull();
    }
  });

  it('podpowiedź w formularzu bierze konto z linków profilu', () => {
    expect(githubUserFromLinks([{ url: 'https://www.linkedin.com/in/zofia' }, { url: 'https://github.com/Zofia-Test' }])).toBe('Zofia-Test');
    expect(githubUserFromLinks([{ url: 'https://www.linkedin.com/in/github' }])).toBe('');
  });
});

// ---------- Wybór repozytoriów ----------

describe('wybór repozytoriów', () => {
  it('bez forków, pustych i repozytorium profilu; maks. 10 ostatnio zmienianych', () => {
    const own = Array.from({ length: 13 }, (_, i) => repo(`r${i}`, { pushed_at: daysAgo(i * 10) }));
    const list = [
      ...own.slice().reverse(),
      repo('fork', { fork: true, pushed_at: daysAgo(0) }),
      repo('empty', { size: 0, pushed_at: daysAgo(0) }),
      repo('Zofia-Test', { pushed_at: daysAgo(0) }),
    ];
    const { projects, profileRepo } = gh.pickRepos(list, 'zofia-test');
    expect(projects.map((r) => r.name)).toEqual(own.slice(0, gh.MAX_REPOS).map((r) => r.name));
    expect(profileRepo?.name).toBe('Zofia-Test');
  });

  it('języki od najczęstszego, bez drobnicy poniżej 3%', () => {
    expect(gh.topLanguages({ CSS: 800, TypeScript: 9000, HTML: 100 })).toEqual(['TypeScript', 'CSS']);
    expect(gh.topLanguages({})).toEqual([]);
  });

  it('README bez odznak, obrazków i HTML, skrócone', () => {
    const md = '# Projekt\n[![CI](https://x/badge.svg)](https://x)\n![zrzut](shot.png)\n<p align="center">Opis</p>\n<!-- notatka -->\n' + 'a'.repeat(5000);
    const out = gh.cleanReadme(md);
    expect(out).toContain('# Projekt');
    expect(out).toContain('Opis');
    expect(out).not.toMatch(/badge|shot\.png|<p|notatka/);
    expect(out.length).toBe(gh.README_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('daty w formacie profilu; świeżo zmieniane repozytorium trwa, zarchiwizowane już nie', () => {
    expect(gh.projectDates({ createdAt: '2023-01-05T12:00:00Z', pushedAt: '2024-06-20T12:00:00Z', archived: false }, NOW)).toEqual({ start: '2023-01', end: '2024-06' });
    expect(gh.projectDates({ createdAt: '2024-03-10T12:00:00Z', pushedAt: daysAgo(10), archived: false }, NOW)).toEqual({ start: '2024-03', end: '' });
    expect(gh.projectDates({ createdAt: '2024-03-10T12:00:00Z', pushedAt: daysAgo(10), archived: true }, NOW).end).toBe(daysAgo(10).slice(0, 7));
  });
});

// ---------- Błędy GitHuba ----------

describe('błędy GitHuba', () => {
  it('limit zapytań: kiedy można spróbować ponownie', () => {
    const reset = Math.floor(NOW / 1000) + 15 * 60;
    const limited = new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } });
    const e = withLang('pl', () => gh.rateLimitError(limited, NOW));
    expect(e?.status).toBe(429);
    expect(e?.message).toMatch(/Spróbuj ponownie o \d{2}:\d{2} \(za ok\. 15 min\)/);
    expect(withLang('en', () => gh.rateLimitError(limited, NOW))?.message).toContain('in about 15 min');
    expect(gh.rateLimitError(new Response('', { status: 429, headers: { 'retry-after': '120' } }), NOW)?.message).toContain('za ok. 2 min');
    expect(gh.rateLimitError(new Response('', { status: 429 }), NOW)?.message).toContain('za godzinę');
    // Zwykłe 403 i 404 to nie limit.
    expect(gh.rateLimitError(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '42' } }), NOW)).toBeNull();
    expect(gh.rateLimitError(new Response('', { status: 404 }), NOW)).toBeNull();
  });

  it('nieznany użytkownik (404), także po angielsku', async () => {
    await expect(gh.fetchGithub('nobody-here')).rejects.toMatchObject({ status: 404, message: expect.stringContaining('nie ma użytkownika „nobody-here”') });
    await expect(withLang('en', () => gh.fetchGithub('nobody-here'))).rejects.toMatchObject({ message: 'There is no GitHub user "nobody-here". Check the username or the profile link.' });
  });

  it('wyczerpany limit przerywa import z godziną odnowienia', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 30 * 60);
    github['/users/zofia-test'] = json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset });
    await expect(gh.fetchGithub('zofia-test')).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/za ok\. (29|30) min/) });
  });

  it('brak sieci, organizacja zamiast osoby i konto bez własnych projektów', async () => {
    github['/users/zofia-test'] = () => {
      throw new TypeError('fetch failed');
    };
    await expect(gh.fetchGithub('zofia-test')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Brak połączenia z GitHubem (fetch failed)') });

    github['/users/acme'] = json({ login: 'acme', type: 'Organization' });
    await expect(gh.fetchGithub('acme')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('to organizacja') });

    github['/users/zofia-test'] = json({ login: 'zofia-test', type: 'User' });
    github['/users/zofia-test/repos?per_page=100&sort=pushed'] = json([repo('lib', { fork: true }), repo('zofia-test')]);
    await expect(gh.fetchGithub('zofia-test')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('nie ma na GitHubie publicznych projektów') });
  });
});

// ---------- Opisy od AI sprawdzone w kodzie ----------

describe('opisy projektów od AI', () => {
  it('liczba spoza README odpada, wersja dopisana do technologii też; limity 8 technologii i 3 punktów', () => {
    const repos = [info('weather-app', { readme: 'Prognoza dla 5 miast.', languages: ['TypeScript'] }), info('todo-api', { description: 'Todo API', languages: ['Python', 'Dockerfile'] })];
    const out = finishProjects(repos, [
      {
        repo: 'Weather-App',
        name: 'Weather App',
        description: 'Aplikacja z prognozą dla 5 miast.',
        technologies: ['TypeScript', 'React 18', 'typescript', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
        achievements: ['Pobieranie prognozy', 'Obsługa 1000 użytkowników', 'Wykresy', 'Mapa', 'Eksport'],
      },
    ]);
    expect(out[0].technologies).toEqual(['TypeScript', 'React', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(out[0].achievements).toEqual(['Pobieranie prognozy', 'Wykresy', 'Mapa']);
    expect(out[0].description).toBe('Aplikacja z prognozą dla 5 miast.');
    // Repozytorium pominięte przez AI: opis i języki z GitHuba.
    expect(out[1]).toEqual({ repo: 'todo-api', name: 'Todo Api', description: 'Todo API', technologies: ['Python', 'Dockerfile'], achievements: [] });
  });

  it('opis z wymyśloną liczbą wraca do opisu z GitHuba', () => {
    const out = finishProjects([info('app', { description: 'Simple app' })], [{ repo: 'app', name: 'App', description: 'Aplikacja dla 200 firm.', technologies: [], achievements: [] }]);
    expect(out[0].description).toBe('Simple app');
  });

  it('język profilu: polski, angielski, a pusty profil po polsku', () => {
    expect(profileLanguage(fixtures.profile)).toBe('pl');
    const en: Profile = {
      ...structuredClone(fixtures.profile),
      headline: 'Computer science student',
      experience: [{ ...fixtures.profile.experience[0], role: 'Marketing intern', achievements: ['Prepared weekly reports for the sales team', 'Managed the company profile on Instagram'] }],
      education: [],
    };
    expect(profileLanguage(en)).toBe('en');
    expect(profileLanguage(store.emptyProfile('x'))).toBe('pl');
    expect(profileLanguage({ ...store.emptyProfile('x'), headline: 'Student informatyki, 3. rok' })).toBe('pl');
  });
});

// ---------- Łączenie z profilem ----------

describe('łączenie projektów z profilem', () => {
  const withProjects = (): Profile => ({
    ...structuredClone(fixtures.profile),
    projects: [
      { ...project('Weather App', ''), description: 'Wpisane ręcznie', achievements: ['Moje'] },
      project('Lista zadań', 'https://github.com/zofia-test/todo-api'),
    ],
    skills: [{ id: 's1', name: 'React', category: 'techniczne', level: 'średni' }],
    contact: { ...fixtures.profile.contact, links: [...fixtures.profile.contact.links, { label: 'Mój GitHub', url: 'http://www.github.com/Zofia-Test/' }] },
  });

  it('bez duplikatów: ten sam link albo nazwa = już jest; istniejące projekty i link bez zmian', () => {
    const before = withProjects();
    const snapshot = structuredClone(before);
    let n = 0;
    const res = gh.mergeGithubProjects(
      before,
      [
        project('Weather App', 'https://github.com/zofia-test/weather-app', ['react', 'Docker']),
        project('Todo', 'https://github.com/Zofia-Test/todo-api/'),
        project('CV Maker', 'https://github.com/zofia-test/cv-maker', ['React', 'Node.js', 'nodejs', 'Docker', 'C++', 'C#']),
        project('CV Maker (kopia)', 'https://github.com/zofia-test/cv-maker'),
      ],
      'zofia-test',
      () => `id${++n}`,
    );
    expect(res.added).toEqual({ projects: ['CV Maker'], skills: ['Node.js', 'Docker', 'C++', 'C#'] });
    expect(res.profile.projects.slice(0, 2)).toEqual(snapshot.projects);
    expect(res.profile.projects.map((p) => p.name)).toEqual(['Weather App', 'Lista zadań', 'CV Maker']);
    expect(res.profile.skills.map((s) => [s.name, s.category])).toEqual([
      ['React', 'techniczne'],
      ['Node.js', 'techniczne'],
      ['Docker', 'narzędzia'],
      ['C++', 'techniczne'],
      ['C#', 'techniczne'],
    ]);
    expect(res.profile.skills[0]).toEqual(snapshot.skills[0]);
    expect(res.profile.contact.links).toEqual(snapshot.contact.links);
    expect(res.newIds).toEqual(['p-CV Maker', 'id1', 'id2', 'id3', 'id4']);
    // Profil wejściowy się nie zmienia.
    expect(before).toEqual(snapshot);
  });

  it('własny projekt użyty w innym projekcie nie staje się umiejętnością', () => {
    const res = gh.mergeGithubProjects(
      structuredClone(fixtures.profile),
      [
        project('polanon', 'https://github.com/zofia-test/polanon', ['Python']),
        project('PolCV', 'https://github.com/zofia-test/polcv', ['TypeScript', 'polanon', 'PolCV']),
      ],
      'zofia-test',
    );
    expect(res.added.skills).toEqual(['Python', 'TypeScript']);
  });

  it('link do GitHuba trafia do kontaktu raz', () => {
    const res = gh.mergeGithubProjects(structuredClone(fixtures.profile), [], 'zofia-test');
    expect(res.profile.contact.links).toEqual([...fixtures.profile.contact.links, { label: 'GitHub', url: 'https://github.com/zofia-test' }]);
    expect(res.added).toEqual({ projects: [], skills: [] });
    const again = gh.mergeGithubProjects(res.profile, [], 'Zofia-Test');
    expect(again.profile.contact.links).toHaveLength(2);
  });
});

// ---------- Cały import (atrapy GitHuba i OpenRouter) ----------

function serveAccount() {
  github = {
    '/users/zofia-test': json({ login: 'zofia-test', type: 'User', name: 'Zofia Żółkiewska', bio: 'Studentka marketingu, uczę się programowania', blog: '' }),
    '/users/zofia-test/repos?per_page=100&sort=pushed': json([
      repo('weather-app', { description: 'Weather app', topics: ['react', 'openweather'], created_at: '2024-03-10T12:00:00Z', pushed_at: daysAgo(10) }),
      repo('todo-api', { description: 'REST API for todos', created_at: '2023-01-05T12:00:00Z', pushed_at: '2024-06-20T12:00:00Z' }),
      repo('portfolio', { created_at: '2022-05-01T00:00:00Z', pushed_at: PORTFOLIO_PUSHED }),
      repo('forked-lib', { fork: true, pushed_at: daysAgo(1) }),
      repo('empty-repo', { size: 0, pushed_at: daysAgo(2) }),
      repo('zofia-test', { pushed_at: daysAgo(3) }),
    ]),
    '/repos/zofia-test/weather-app/languages': json({ TypeScript: 9000, CSS: 800, HTML: 100 }),
    '/repos/zofia-test/weather-app/readme': text('# Weather App\n![zrzut](docs/shot.png)\nAplikacja pokazuje prognozę dla 5 miast z OpenWeather API.'),
    '/repos/zofia-test/todo-api/languages': json({ Python: 5000, Dockerfile: 300 }),
    '/repos/zofia-test/todo-api/readme': text('# Todo API\nREST API in FastAPI with PostgreSQL. Runs in Docker.'),
    '/repos/zofia-test/zofia-test/readme': text('Cześć! Uczę się programowania.'),
  };
}

const aiReply = JSON.stringify({
  projects: [
    {
      repo: 'weather-app',
      name: 'Weather App',
      description: 'Aplikacja webowa z prognozą pogody dla 5 miast.',
      technologies: ['TypeScript', 'React', 'CSS', 'OpenWeather API', 'react'],
      achievements: ['Pobieranie prognozy z OpenWeather API', 'Obsługa 1000 użytkowników dziennie'],
    },
    {
      repo: 'todo-api',
      name: 'Todo API',
      description: 'REST API do zarządzania listą zadań.',
      technologies: ['Python 3', 'FastAPI', 'PostgreSQL', 'Docker'],
      achievements: ['Udostępnianie REST API w FastAPI', 'Przechowywanie danych w PostgreSQL', 'Uruchamianie w kontenerze Docker', 'Czwarty punkt'],
    },
  ],
});

const portfolio: Project = {
  id: 'proj1', name: 'Moje portfolio', role: 'Autorka', start: '2022-05', end: '', description: 'Strona z moimi pracami.',
  technologies: ['HTML'], link: 'https://github.com/Zofia-Test/Portfolio/', achievements: ['Projekt graficzny strony'],
};

// Portfolio sprawdzone przy ostatnim imporcie i bez zmian od tego czasu (pushed_at jak w serveAccount).
const PORTFOLIO_PUSHED = daysAgo(30);
const newProfile = (githubSync: Record<string, string> = { 'github.com/zofia-test/portfolio': PORTFOLIO_PUSHED }) =>
  store.saveProfile({
    ...structuredClone(fixtures.profile),
    id: store.newId(),
    githubSync,
    projects: [structuredClone(portfolio)],
    skills: [...structuredClone(fixtures.profile.skills), { id: 's4', name: 'typescript', category: 'techniczne', level: '' }],
  });

describe('import projektów z GitHuba', () => {
  it('dopisuje nowe projekty z datami i linkiem z kodu, umiejętności bez duplikatów i link do konta', async () => {
    const p = await newProfile();
    serveAccount();
    aiReplies = [aiReply];
    const res = await importGithub(p.id, 'https://github.com/zofia-test');

    expect(res.added).toEqual({ projects: ['Weather App', 'Todo API'], skills: ['React', 'CSS', 'OpenWeather API', 'Python', 'FastAPI', 'PostgreSQL', 'Docker'] });
    expect(res.newIds).toHaveLength(9);

    const saved = await store.getProfile(p.id);
    expect(saved).toEqual(res.profile);
    expect(saved.projects[0]).toEqual(portfolio);
    const [weather, todo] = saved.projects.slice(1);
    expect(weather).toMatchObject({
      name: 'Weather App', role: 'Autor', start: '2024-03', end: '', link: 'https://github.com/zofia-test/weather-app',
      description: 'Aplikacja webowa z prognozą pogody dla 5 miast.',
      technologies: ['TypeScript', 'React', 'CSS', 'OpenWeather API'],
      achievements: ['Pobieranie prognozy z OpenWeather API'], // 1000 nie ma w README
    });
    expect(todo).toMatchObject({ start: '2023-01', end: '2024-06', technologies: ['Python', 'FastAPI', 'PostgreSQL', 'Docker'] });
    expect(todo.achievements).toHaveLength(3);
    expect(saved.skills.find((s) => s.name === 'Docker')?.category).toBe('narzędzia');
    expect(saved.skills.filter((s) => s.name.toLowerCase() === 'typescript')).toHaveLength(1);
    expect(saved.contact.links).toEqual([...fixtures.profile.contact.links, { label: 'GitHub', url: 'https://github.com/zofia-test' }]);

    // GitHub: konto, lista, README profilu i po 2 zapytania na nowe repozytorium; projekt z profilu, fork i puste repozytorium pominięte.
    expect(ghCalls.map((c) => c.path).sort()).toEqual([
      '/repos/zofia-test/todo-api/languages',
      '/repos/zofia-test/todo-api/readme',
      '/repos/zofia-test/weather-app/languages',
      '/repos/zofia-test/weather-app/readme',
      '/repos/zofia-test/zofia-test/readme',
      '/users/zofia-test',
      '/users/zofia-test/repos?per_page=100&sort=pushed',
    ]);
    expect(ghCalls.every((c) => c.headers['User-Agent'] === APP_UA)).toBe(true);
    expect(ghCalls.find((c) => c.path.endsWith('/readme'))?.headers.Accept).toBe('application/vnd.github.raw');

    // AI: jedno szybkie wywołanie, tylko nowe repozytoria, README bez obrazków, po polsku.
    expect(aiSent).toHaveLength(1);
    expect(aiSent[0].model).toBe(store.DEFAULT_SETTINGS.fastModel);
    expect(aiSent[0].response_format.json_schema.name).toBe('github_projects');
    const [system, user] = aiSent[0].messages.map((m: any) => m.content as string);
    expect(system).toContain('Pisz po polsku');
    expect(user).toContain('"repo": "weather-app"');
    expect(user).toContain('"repo": "todo-api"');
    expect(user).not.toContain('"repo": "portfolio"');
    expect(user).not.toContain('forked-lib');
    expect(user).not.toContain('docs/shot.png');
    expect(user).toContain('Cześć! Uczę się programowania.');
  });

  it('ponowny import: nic nowego, bez wywołania AI i bez drugiego linku', async () => {
    const p = await newProfile();
    serveAccount();
    aiReplies = [aiReply];
    await importGithub(p.id, 'zofia-test');
    ghCalls.length = 0;
    aiSent.length = 0;

    const again = await importGithub(p.id, '@zofia-test');
    expect(again.added).toEqual({ projects: [], skills: [] });
    expect(again.newIds).toEqual([]);
    expect(aiSent).toHaveLength(0);
    expect(ghCalls.map((c) => c.path)).toEqual(['/users/zofia-test', '/users/zofia-test/repos?per_page=100&sort=pushed']);
    expect(again.profile.projects).toHaveLength(3);
    expect(again.profile.contact.links.filter((l) => l.label === 'GitHub')).toHaveLength(1);
  });

  it('profil po angielsku: opisy po angielsku i rola "Author"', async () => {
    const p = await store.saveProfile({
      ...store.emptyProfile('EN'),
      headline: 'Computer science student',
      summary: 'I am a student of computer science at the university, interested in web development.',
    });
    serveAccount();
    aiReplies = [aiReply];
    const res = await importGithub(p.id, 'zofia-test');
    expect(aiSent[0].messages[0].content).toContain('Pisz po angielsku');
    expect(res.profile.projects.map((x) => x.role)).toEqual(['Author', 'Author', 'Author']);
  });

  it('trasa POST /profiles/:pid/github: zapisany profil z zamaskowanym kluczem i czytelne błędy', async () => {
    const p = await store.saveProfile({ ...(await newProfile()), apiKey: 'sk-or-v1-abcdefghijklmnop' });
    serveAccount();
    aiReplies = [aiReply];
    const post = (username: string, lang = 'pl') =>
      fetch(`${base}/profiles/${p.id}/github`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-polcv-lang': lang }, body: JSON.stringify({ username }) }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as any,
      }));

    const ok = await post('github.com/zofia-test');
    expect(ok.status).toBe(200);
    expect(ok.body.added.projects).toEqual(['Weather App', 'Todo API']);
    expect(ok.body.profile.projects).toHaveLength(3);
    expect(ok.body.profile.apiKey).not.toBe('sk-or-v1-abcdefghijklmnop');
    expect((await store.getProfile(p.id)).apiKey).toBe('sk-or-v1-abcdefghijklmnop');

    const bad = await post('to nie jest nazwa');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('Podaj nazwę użytkownika z GitHuba');

    const missing = await post('nobody-here', 'en');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('There is no GitHub user "nobody-here". Check the username or the profile link.');
  });
});

// ---------- Nowości w projektach, które już są w profilu ----------

describe('nowości w projektach z profilu', () => {
  const linked = (): Profile => ({
    ...structuredClone(fixtures.profile),
    projects: [
      { ...project('Lista zadań', 'https://github.com/Zofia-Test/todo-api/', ['Python', 'Node.js']), description: 'API do zadań.', start: '2023-01', end: '2024-06', achievements: ['Udostępnianie REST API'] },
      { ...project('Weather App', ''), description: 'Wpisane ręcznie' },
    ],
    skills: [{ id: 's1', name: 'Python', category: 'techniczne', level: '' }],
  });

  it('stan repozytorium: nowe, do sprawdzenia (zmienione albo jeszcze niesprawdzane) i bez zmian; sama nazwa bez linku = bez zmian', () => {
    const todo = repo('todo-api', { pushed_at: '2026-10-01T10:00:00Z' });
    const p = linked();
    expect(gh.repoState(p)(repo('cv-maker'))).toBe('new');
    expect(gh.repoState(p)(todo)).toBe('changed');
    expect(gh.repoState({ ...p, githubSync: { 'github.com/zofia-test/todo-api': '2026-10-01T10:00:00Z' } })(todo)).toBe('same');
    expect(gh.repoState({ ...p, githubSync: { 'github.com/zofia-test/todo-api': '2026-09-01T10:00:00Z' } })(todo)).toBe('changed');
    expect(gh.repoState(p)(repo('weather-app'))).toBe('same');
  });

  it('dopisuje tylko nowe technologie i punkty; nazwa, opis, daty i istniejące punkty zostają', () => {
    const before = linked();
    let n = 0;
    const res = gh.applyGithubUpdates(
      before,
      [{ url: 'https://github.com/zofia-test/todo-api', technologies: ['NodeJS', 'FastAPI', 'Docker'], achievements: ['Udostępnianie REST API.', 'Logowanie przez JWT'] }],
      () => `id${++n}`,
    );
    const [todo, weather] = res.profile.projects;
    expect(todo).toEqual({ ...before.projects[0], technologies: ['Python', 'Node.js', 'FastAPI', 'Docker'], achievements: ['Udostępnianie REST API', 'Logowanie przez JWT'] });
    expect(weather).toEqual(before.projects[1]);
    expect(res.updated).toEqual(['Lista zadań']);
    expect(res.updatedIds).toEqual(['p-Lista zadań']);
    // Umiejętności tylko z nowych technologii: Node.js był już w projekcie, choć nie wśród umiejętności, więc nie wraca.
    expect(res.skills).toEqual(['FastAPI', 'Docker']);
    expect(res.skillIds).toEqual(['id1', 'id2']);
  });

  it('nic nowego: profil bez zmian i pusta lista', () => {
    const before = linked();
    const res = gh.applyGithubUpdates(before, [{ url: 'https://github.com/zofia-test/todo-api', technologies: ['python'], achievements: ['udostępnianie REST API'] }]);
    expect(res.profile).toEqual(before);
    expect(res.updated).toEqual([]);
  });

  it('nowości od AI: liczba spoza README odpada, wersja dopisana do technologii też, repozytorium pominięte przez AI nic nie dostaje', () => {
    const repos = [info('todo-api', { readme: 'REST API in FastAPI. Rate limit 100 requests.' }), info('other')];
    const res = finishUpdates(repos, [
      { repo: 'Todo-API', technologies: ['FastAPI 0.110', 'Docker'], achievements: ['Limit 100 zapytań', 'Obsługa 5000 użytkowników', ' '] },
    ]);
    expect(res).toEqual([
      { url: 'https://github.com/zofia-test/todo-api', technologies: ['FastAPI', 'Docker'], achievements: ['Limit 100 zapytań'] },
      { url: 'https://github.com/zofia-test/other', technologies: [], achievements: [] },
    ]);
  });

  it('znacznik sprawdzenia nie idzie do AI razem z profilem', () => {
    expect(profileForPrompt({ ...linked(), githubSync: { 'github.com/zofia-test/todo-api': '2026-10-01T10:00:00Z' } })).not.toHaveProperty('githubSync');
  });

  const updatesReply = JSON.stringify({
    projects: [{ repo: 'portfolio', technologies: ['HTML', 'Astro'], achievements: ['Projekt graficzny strony', 'Galeria 12 prac', 'Formularz kontaktowy'] }],
  });

  it('import: projekt z profilu bez znacznika jest sprawdzany od razu, nowości trafiają do niego, a znaczniki do profilu', async () => {
    const p = await newProfile({});
    serveAccount();
    github['/repos/zofia-test/portfolio/languages'] = json({ HTML: 5000, Astro: 3000 });
    github['/repos/zofia-test/portfolio/readme'] = text('# Portfolio\nStrona w Astro z galerią prac i formularzem kontaktowym.');
    aiByName = { github_projects: [aiReply], github_updates: [updatesReply] };
    const res = await importGithub(p.id, 'zofia-test');

    const saved = await store.getProfile(p.id);
    expect(saved).toEqual(res.profile);
    expect(saved.projects[0]).toEqual({ ...portfolio, technologies: ['HTML', 'Astro'], achievements: ['Projekt graficzny strony', 'Formularz kontaktowy'] });
    expect(res.updated).toEqual(['Moje portfolio']);
    expect(res.updatedIds).toEqual(['proj1']);
    expect(res.newIds).toContain('proj1');
    expect(res.added.projects).toEqual(['Weather App', 'Todo API']);
    expect(res.added.skills).toContain('Astro');
    expect(saved.githubSync).toEqual({
      'github.com/zofia-test/weather-app': daysAgo(10),
      'github.com/zofia-test/todo-api': '2024-06-20T12:00:00Z',
      'github.com/zofia-test/portfolio': PORTFOLIO_PUSHED,
    });

    // AI: osobne wywołanie z tym, co profil już mówi o projekcie; README portfolio nie idzie do opisu nowych projektów.
    const sent = aiSent.find((b) => b.response_format.json_schema.name === 'github_updates');
    const user = sent.messages[1].content as string;
    expect(user).toContain('"repo": "portfolio"');
    expect(user).toContain('Projekt graficzny strony');
    expect(user).toContain('Strona w Astro');
    expect(user).not.toContain('weather-app');
    expect(ghCalls.map((c) => c.path)).toContain('/repos/zofia-test/portfolio/readme');

    // Ponowny import bez zmian w repozytoriach: bez AI i bez szczegółów repozytoriów.
    ghCalls.length = 0;
    aiSent.length = 0;
    const again = await importGithub(p.id, 'zofia-test');
    expect(again.updated).toEqual([]);
    expect(again.newIds).toEqual([]);
    expect(aiSent).toHaveLength(0);
    expect(ghCalls).toHaveLength(2);

    // Nowy push w portfolio: sprawdzamy je znowu; AI nie widzi nic nowego, więc projekt zostaje, a znacznik się zmienia.
    const pushed = daysAgo(1);
    github['/users/zofia-test/repos?per_page=100&sort=pushed'] = json([repo('portfolio', { created_at: '2022-05-01T00:00:00Z', pushed_at: pushed })]);
    aiByName = { github_updates: [JSON.stringify({ projects: [{ repo: 'portfolio', technologies: [], achievements: [] }] })] };
    const third = await importGithub(p.id, 'zofia-test');
    expect(third.updated).toEqual([]);
    expect(third.profile.projects[0]).toEqual(saved.projects[0]);
    expect(third.profile.githubSync?.['github.com/zofia-test/portfolio']).toBe(pushed);
    expect(third.profile.githubSync?.['github.com/zofia-test/todo-api']).toBe('2024-06-20T12:00:00Z');
  });
});
