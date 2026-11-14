import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import type { CareerPrefs, JobLead, RoleProposal } from '../../shared/schemas';
import { normalize } from '../ats/keywords';
import { distanceKm, geocodeCity, geocodePlace, type Point } from './geocode';
import { APP_UA } from './http';
import { tr } from '../i18n';

type Seniority = RoleProposal['seniority'];
type Scope = 'local' | 'remote';

export interface SearchQuery {
  phrase: string;
  scope: Scope;
  seniority: Seniority;
  prefs: CareerPrefs;
}

export const leadId = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 12);
const slug = (s: string) => normalize(s).replace(/\s+/g, '-');

// ---------- Wynagrodzenie ----------

/** Kwota w przeliczeniu na miesiąc (godzinowa × 168, dzienna × 21, roczna / 12). */
export function toMonthly(amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (/hour|godz/.test(u)) return Math.round(amount * 168);
  if (/day|dzie/.test(u)) return Math.round(amount * 21);
  if (/year|rok/.test(u)) return Math.round(amount / 12);
  return Math.round(amount);
}

/** "8 000–10 500 zł brutto / mies." → 10500 (górna granica, miesięcznie). */
export function parseSalaryText(text: string): number | null {
  if (!text) return null;
  const nums = [...text.replace(/\u00a0/g, ' ').matchAll(/\d[\d ]*(?:[.,]\d+)?/g)]
    .map((m) => Number(m[0].replace(/ /g, '').replace(',', '.')))
    .filter((n) => n > 0);
  if (!nums.length) return null;
  return toMonthly(Math.max(...nums), text);
}

// ---------- Umowy ----------

/** Ujednolica nazwy umów z portali do: umowa o pracę / umowa zlecenie / B2B / staż / praktyki. */
export function mapContract(raw: string): string {
  const s = raw.toLowerCase();
  if (s === 'any' || /do uzgodnienia|undetermined/.test(s)) return 'dowolna';
  if (s === 'uod' || /o dzieło|o dzielo|specific/.test(s)) return 'umowa o dzieło';
  if (/praktyk|staż|staz|intern/.test(s)) return 'staż / praktyki';
  if (/b2b/.test(s)) return 'B2B';
  if (/zleceni|mandate/.test(s)) return 'umowa zlecenie';
  if (/o pracę|o prace|permanent|employment|uop/.test(s)) return 'umowa o pracę';
  return raw;
}

// ---------- nofluffjobs ----------

const NF_LEVELS: Record<Seniority, string> = { staż: 'trainee,junior', junior: 'trainee,junior', mid: 'junior,mid' };
const NF_CONTRACT: Record<string, string> = { permanent: 'umowa o pracę', b2b: 'B2B', zlecenie: 'umowa zlecenie', mandate: 'umowa zlecenie', internship: 'staż / praktyki' };

/**
 * Oferty z nofluffjobs. Z `near` zostają tylko oferty z biurem w promieniu `km` od punktu
 * (nofluffjobs nie ma filtra promienia, ale podaje współrzędne biur).
 */
export function parseNofluff(html: string, near?: { point: Point; km: number }): JobLead[] {
  const raw = cheerio.load(html)('#serverApp-state').text();
  if (!raw) return [];
  const state = JSON.parse(raw);
  const key = Object.keys(state).find((k) => Array.isArray(state[k]?.postings));
  return (key ? state[key].postings : []).flatMap((p: any): JobLead[] => {
    const url = `https://nofluffjobs.com/pl/job/${p.url}`;
    const places: any[] = p.location?.places ?? [];
    const cities = [...new Set(places.map((x) => x.city).filter(Boolean))] as string[];
    const remote = p.fullyRemote || cities.includes('Remote');
    let location = cities.filter((c) => c !== 'Remote').slice(0, 3).join(', ') || (remote ? 'zdalnie' : '');
    if (near) {
      const nearest = places
        .filter((x) => x.geoLocation)
        .map((x) => ({ city: x.city as string, km: distanceKm(near.point, { lat: x.geoLocation.latitude, lon: x.geoLocation.longitude }) }))
        .sort((a, b) => a.km - b.km)[0];
      if (!nearest || nearest.km > near.km) return [];
      location = `${nearest.city} (~${Math.round(nearest.km)} km)`;
    }
    const s = p.salary;
    return [{
      id: leadId(url),
      portal: 'nofluff',
      title: p.title ?? '',
      company: p.name ?? '',
      location,
      workModes: remote ? ['zdalna'] : ['stacjonarna / hybrydowa'],
      workTime: '',
      salary: s?.from ? `${s.from}-${s.to} ${s.currency} / ${s.period === 'Hour' ? 'godz.' : 'mies.'} (${NF_CONTRACT[s.type] ?? s.type})` : '',
      salaryMonthly: s?.to && s.currency === 'PLN' ? toMonthly(s.to, s.period ?? 'Month') : null,
      contracts: s?.type ? [NF_CONTRACT[s.type] ?? mapContract(s.type)] : [],
      seniority: (p.seniority ?? []).join(' / '),
      skills: (p.tiles?.values ?? []).filter((t: any) => t.type === 'requirement').map((t: any) => t.value).slice(0, 8),
      url,
      publishedAt: p.posted ? new Date(p.posted).toISOString() : '',
      match: null,
      matchReason: '',
      excludedBy: '',
    }];
  });
}

async function nofluffPage(criteria: string, page: number): Promise<string> {
  const res = await fetch(`https://nofluffjobs.com/pl/?criteria=${encodeURIComponent(criteria)}${page > 1 ? `&page=${page}` : ''}`, {
    headers: { 'User-Agent': APP_UA, 'Accept-Language': 'pl-PL' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function searchNofluff(q: SearchQuery): Promise<JobLead[]> {
  const base = `keyword=${q.phrase} seniority=${NF_LEVELS[q.seniority]}`;
  if (q.scope === 'remote') return parseNofluff(await nofluffPage(`${base} city=remote`, 1));
  // Praca na miejscu: cała Polska (3 strony wyników), potem filtr odległości od miasta kandydata.
  const home = await geocodeCity(q.prefs.city);
  if (!home) return parseNofluff(await nofluffPage(`${base} city=${slug(q.prefs.city)}`, 1));
  // Strony po kolei, nie naraz - portal nie dostaje serii równoległych zapytań.
  const leads: JobLead[] = [];
  for (const n of [1, 2, 3]) {
    const html = await nofluffPage(base, n).catch(() => '');
    if (html) leads.push(...parseNofluff(html, { point: home, km: q.prefs.radiusKm }));
  }
  return leads;
}

// ---------- Smart Jobs ----------

const SJ_MODES: Record<string, string> = { onSite: 'stacjonarna', hybrid: 'hybrydowa', remote: 'zdalna' };
// "other" (na portalu "Pozostałe") może znaczyć zlecenie, dzieło albo staż - nie zgadujemy, więc nie trafia do listy umów.
const SJ_CONTRACT: Record<string, string> = { b2b: 'B2B', employmentContract: 'umowa o pracę' };
const SJ_PERIOD: Record<string, { unit: string; label: string }> = {
  hourly: { unit: 'hour', label: 'godz.' },
  daily: { unit: 'day', label: 'dzień' },
  monthly: { unit: 'month', label: 'mies.' },
  yearly: { unit: 'year', label: 'rok' },
};
const SJ_ORIGIN = 'https://thesmartjobs.com';

/** Pola oferty z wyników Smart Jobs, z których korzystamy (portal podaje ich więcej). */
interface SjJob {
  title?: string;
  slugUrl?: string;
  company?: { name?: string };
  role?: { name?: string };
  locations?: { city?: string; coordinates?: { lat: number; lon: number } }[];
  salaries?: { min?: number; max?: number; currency?: string; period?: string; contractType?: string }[];
  workModes?: string[];
  attributes?: { groupName?: string; attributeName?: string }[];
  timestamps?: { publishedAt?: string };
}

/** Treść, którą Next.js wstrzykuje w stronę kawałkami (self.__next_f.push), złożona w jeden tekst. */
function nextFlight(html: string): string {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) out += JSON.parse(m[1]);
  return out;
}

/** Obiekt JSON zaczynający się w `start` (dopasowanie nawiasów z pominięciem tekstu w cudzysłowach). */
function jsonAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

/**
 * Oferty z wyników wyszukiwania Smart Jobs. Strona podaje je w stanie wstrzykniętym przez Next.js
 * (pierwsza strona wyników, do 20 ofert). Z `near` zostają tylko oferty z miejscem pracy w promieniu `km`.
 */
export function parseSmartjobs(html: string, near?: { point: Point; km: number }): JobLead[] {
  const flight = nextFlight(html);
  const start = flight.indexOf('{"pages":[{"data":[');
  if (start < 0) return [];
  let found: { pages?: { data?: SjJob[] }[] } | null;
  try {
    found = jsonAt(flight, start) as typeof found;
  } catch {
    return [];
  }
  const jobs = found?.pages?.[0]?.data ?? [];
  return jobs.flatMap((j): JobLead[] => {
    if (!j?.slugUrl || !j.title) return [];
    const url = `${SJ_ORIGIN}/pl/${j.slugUrl}`;
    const places = j.locations ?? [];
    const workModes = [...new Set((j.workModes ?? []).map((m) => SJ_MODES[m] ?? m))];
    const cities = [...new Set(places.map((p) => p.city ?? '').filter(Boolean))];
    let location = cities.slice(0, 3).join(', ') || (workModes.includes('zdalna') ? 'zdalnie' : '');
    if (near) {
      const nearest = places
        .flatMap((p) => (p.coordinates ? [{ city: p.city ?? '', km: distanceKm(near.point, p.coordinates) }] : []))
        .sort((a, b) => a.km - b.km)[0];
      if (!nearest || nearest.km > near.km) return [];
      location = `${nearest.city} (~${Math.round(nearest.km)} km)`;
    }
    const salaries = j.salaries ?? [];
    const salaryText = salaries.slice(0, 2).map((s) => {
      const period = SJ_PERIOD[s.period ?? ''] ?? { unit: s.period ?? '', label: s.period ?? '' };
      const amount = s.min && s.max && s.min !== s.max ? `${s.min}-${s.max}` : `${s.max ?? s.min}`;
      const contract = SJ_CONTRACT[s.contractType ?? ''];
      return `${amount} ${s.currency} / ${period.label}${contract ? ` (${contract})` : ''}`;
    });
    const monthly = salaries.flatMap((s) => {
      const top = s.max ?? s.min;
      return s.currency === 'PLN' && top ? [toMonthly(top, SJ_PERIOD[s.period ?? '']?.unit ?? s.period ?? '')] : [];
    });
    const attrs = (group: string): string[] => (j.attributes ?? []).flatMap((a) => (a.groupName === group && a.attributeName ? [a.attributeName] : []));
    // Poziom nie ma osobnego pola: "Starszy" bywa tylko w nazwie roli ("Starszy Analityk" przy tytule "Analityk"),
    // a wymagane lata doświadczenia są wśród atrybutów. Oba trafiają do pola poziomu, które czytają filtr i ocena AI.
    const seniority = [j.role?.name && j.role.name !== j.title ? j.role.name : '', ...attrs('Doświadczenie').filter((a) => /\d/.test(a))]
      .filter(Boolean)
      .join(' / ');
    return [{
      id: leadId(url),
      portal: 'smartjobs',
      title: j.title,
      company: j.company?.name ?? '',
      location,
      workModes,
      workTime: '',
      salary: salaryText.join('; '),
      salaryMonthly: monthly.length ? Math.max(...monthly) : null,
      contracts: [...new Set(salaries.map((s) => SJ_CONTRACT[s.contractType ?? ''] ?? '').filter(Boolean))],
      seniority,
      skills: [...attrs('Umiejętności'), ...attrs('Narzędzia')].slice(0, 8),
      url,
      publishedAt: j.timestamps?.publishedAt ?? '',
      match: null,
      matchReason: '',
      excludedBy: '',
    }];
  });
}

/**
 * Adres wyszukiwania Smart Jobs. Bez `sort`, bo robots.txt portalu go zabrania; dalszych stron wyników
 * strona nie podaje w adresie (doczytuje je przez /api/, którego robots.txt też zabrania).
 */
export function smartjobsUrl(phrase: string, workModes: string[], osmId = ''): string {
  const params = new URLSearchParams({ query: phrase });
  if (workModes.length) params.set('workModes', workModes.join(','));
  if (osmId) params.set('osmId', osmId);
  return `${SJ_ORIGIN}/pl/praca?${params}`;
}

async function smartjobsPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': APP_UA, 'Accept-Language': 'pl-PL' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function searchSmartjobs(q: SearchQuery): Promise<JobLead[]> {
  if (q.scope === 'remote') return parseSmartjobs(await smartjobsPage(smartjobsUrl(q.phrase, ['remote'])));
  const modes = [q.prefs.onsite && 'onSite', q.prefs.hybrid && 'hybrid'].filter(Boolean) as string[];
  // Portal ma filtr miasta (relacja OSM), ale nie promienia: bierzemy oferty z miasta kandydata, a odległość liczymy sami.
  const home = await geocodePlace(q.prefs.city);
  const osmId = home && 'osm' in home ? home.osm : '';
  return parseSmartjobs(await smartjobsPage(smartjobsUrl(q.phrase, modes, osmId)), home ? { point: home, km: q.prefs.radiusKm } : undefined);
}

// ---------- Filtry ----------

const TOO_SENIOR = /senior|starszy|starsza|ekspert|expert|lead|kierownik|dyrektor|manager|head|principal|c_level|architekt|architect/i;

export interface Screened {
  kept: JobLead[];
  /** Oferty odrzucone wyłącznie przez preferencje kandydata (umowa, kwota, etat) - z powodem w excludedBy. */
  excluded: JobLead[];
  /** Ile ofert odpadło z jakiego powodu (także duplikaty i seniorzy). */
  stats: Record<string, number>;
}

/** Sortuje oferty na pasujące, odrzucone przez preferencje (do pokazania na życzenie) i odrzucone całkiem. */
export function screenLeads(leads: JobLead[], prefs: CareerPrefs, seniority: Seniority): Screened {
  const seen = new Set<string>();
  const out: Screened = { kept: [], excluded: [], stats: {} };
  const count = (reason: string) => (out.stats[reason] = (out.stats[reason] ?? 0) + 1);
  for (const l of leads) {
    const key = `${normalize(l.title)}|${normalize(l.company)}`;
    if (seen.has(l.url) || seen.has(key)) {
      count('duplikaty');
      continue;
    }
    seen.add(l.url);
    seen.add(key);
    // Junior/staż: odrzucamy oferty wyraźnie dla seniorów (poziom albo tytuł).
    if (seniority !== 'mid' && (TOO_SENIOR.test(l.title) || (TOO_SENIOR.test(l.seniority) && !/junior|młodszy|asystent|praktyk|trainee/i.test(l.seniority)))) {
      count('dla bardziej doświadczonych');
      continue;
    }
    // Powody i klucze statystyk zostają po polsku (to zapisane dane) - przegląd ofert tłumaczy je przy wyświetlaniu.
    let reason = '';
    // "dowolna" = forma umowy do uzgodnienia, więc pasuje do każdej preferencji.
    if (prefs.contracts.length && l.contracts.length && !l.contracts.some((c) => c === 'dowolna' || (prefs.contracts as string[]).includes(c))) reason = `umowa: ${l.contracts.join(', ')}`;
    else if (prefs.salaryMin > 0 && l.salaryMonthly != null && l.salaryMonthly < prefs.salaryMin * 0.9) reason = 'za niskie wynagrodzenie';
    else if (prefs.workTime === 'część etatu' && l.workTime === 'pełny etat') reason = 'pełny etat';
    else if (prefs.workTime === 'pełny etat' && l.workTime === 'część etatu') reason = 'część etatu';
    if (reason) {
      count(reason.startsWith('umowa') ? 'inna forma umowy' : reason);
      out.excluded.push({ ...l, excludedBy: reason });
    } else out.kept.push(l);
  }
  return out;
}

// Jawne granice słów - \b w JS nie rozumie polskich liter ("staż").
const NOISE_WORDS = /(?<=^|[\s,/(-])(junior|senior|mid|regular|młodszy|młodsza|starszy|starsza|stażysta|stażystka|staż|praktyki|praktykant|intern|internship|trainee|praca|zdalna|zdalnie|remote|hybrydowa|hybrid|k\/m|m\/k)(?=$|[\s,/)-])/gi;

/** Fraza do wyszukiwarki bez słów o poziomie i trybie pracy (te filtrujemy osobno). */
export function cleanPhrase(p: string): string {
  return p.replace(NOISE_WORDS, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------- Wyszukiwanie dla stanowiska ----------

export type Searcher = (q: SearchQuery) => Promise<JobLead[]>;
type Searchers = Record<string, { name: string; run: Searcher }>;

// Program sam przeszukuje tylko portale, których robots.txt na to pozwala: nofluffjobs i Smart Jobs.
// pracuj.pl i theprotocol.it blokują automaty, a justjoin.it zabrania /api/, więc dla nich są tylko linki,
// które kandydat otwiera sam w przeglądarce. Innych źródeł ofert program nie wczytuje.
const SEARCHERS: Searchers = {
  nofluff: { name: 'nofluffjobs', run: searchNofluff },
  smartjobs: { name: 'Smart Jobs', run: searchSmartjobs },
};

export function activeSearchers(): Searchers {
  return SEARCHERS;
}

async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]().then(
          (value) => ({ status: 'fulfilled', value }) as const,
          (reason) => ({ status: 'rejected', reason }) as const,
        );
      }
    }),
  );
  return results;
}

export async function searchRole(role: RoleProposal, prefs: CareerPrefs): Promise<Screened & { errors: string[]; scanned: number }> {
  const scopes: Scope[] = [];
  if (prefs.city.trim() && (prefs.onsite || prefs.hybrid)) scopes.push('local');
  if (prefs.remote) scopes.push('remote');
  if (!scopes.length) return { kept: [], excluded: [], stats: {}, errors: [tr('Ustaw miasto albo zaznacz pracę zdalną w preferencjach.')], scanned: 0 };

  // Po usunięciu "junior" z "junior AI" zostaje samo "AI" - zbyt ogólne, pomijamy frazy krótsze niż 4 znaki.
  const phrases = [...new Set([...role.keywords, role.title].map(cleanPhrase).filter((p) => p.length > 3))].slice(0, 3);
  const searchers = Object.values(activeSearchers());
  const jobs = phrases.flatMap((phrase) =>
    scopes.flatMap((scope) =>
      searchers.map((s) => ({ portal: s.name, run: () => s.run({ phrase, scope, seniority: role.seniority, prefs }) })),
    ),
  );
  const settled = await pool(jobs.map((j) => j.run), 2);
  const all: JobLead[] = [];
  const failed = new Set<string>();
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') all.push(...r.value);
    else failed.add(jobs[i].portal);
  });
  const errors = [...failed].map((p) => tr('{portal}: nie udało się pobrać części wyników.', { portal: p }));
  return { ...screenLeads(all, prefs, role.seniority), errors, scanned: all.length };
}
