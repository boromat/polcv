import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerPrefs } from '../shared/schemas';

// Osobny, tymczasowy folder danych (pamięć geokodowania) - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-sj-'));
process.env.CV_DATA_DIR = dir;

const { activeSearchers, parseSmartjobs, screenLeads, smartjobsUrl } = await import('../server/jobs/search');
const { APP_UA } = await import('../server/jobs/http');

afterEach(() => vi.unstubAllGlobals());
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const OLSZTYN = { lat: 53.7784, lon: 20.4801 };

const job = (p: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Księgowa',
  slug: 'ksiegowa-1a2b3c4d',
  slugUrl: 'praca/ksiegowa-1a2b3c4d',
  language: 'pl',
  company: { name: 'Biuro Rachunkowe Przykład', agency: false },
  category: { name: 'Finanse' },
  role: { name: 'Księgowa' },
  attributes: [],
  locations: [{ country: 'Polska', city: 'Olsztyn', coordinates: { lat: 53.78, lon: 20.49 } }],
  salaries: [],
  timestamps: { publishedAt: '2026-11-01T10:00:00Z' },
  workModes: ['onSite'],
  ...p,
});

const attr = (groupName: string, attributeName: string) => ({ groupName, attributeName });

/** Strona wyników taka jak u portalu: stan Next.js w kilku kawałkach self.__next_f.push. */
function resultsPage(jobs: unknown[]): string {
  const state = JSON.stringify({ pages: [{ data: jobs, meta: { total: jobs.length, page: 1, limit: 20 } }], pageParams: [1] });
  const flight = `0:["$","html",null,{}]\n2f:{"props":{"state":{"queries":[{"state":{"data":${state}},"queryKey":["jobs","infiniteSearch",{"query":"x"}]}]}}}\n`;
  const cut = Math.floor(flight.length / 2);
  const scripts = [flight.slice(0, cut), flight.slice(cut)].map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`);
  return `<html><body><a href="/pl/praca/ksiegowa-1a2b3c4d">Księgowa</a>${scripts.join('')}</body></html>`;
}

const prefs: CareerPrefs = {
  targetRoles: [],
  city: 'Olsztyn',
  radiusKm: 30,
  onsite: true,
  hybrid: true,
  remote: true,
  salaryMin: 0,
  contracts: [],
  workTime: 'dowolny',
  seniority: 'junior',
  notes: '',
};

describe('Smart Jobs: wyniki wyszukiwania', () => {
  it('czyta ofertę: firma, link, tryb, stawka dzienna w przeliczeniu na miesiąc, umowy, umiejętności', () => {
    const [l] = parseSmartjobs(
      resultsPage([
        job({
          workModes: ['hybrid', 'remote'],
          salaries: [
            { min: 400, max: 500, currency: 'PLN', period: 'daily', contractType: 'b2b' },
            { min: 7000, max: 9000, currency: 'PLN', period: 'monthly', contractType: 'employmentContract' },
            { min: 30, max: 30, currency: 'PLN', period: 'hourly', contractType: 'other' },
          ],
          attributes: [attr('Umiejętności', 'Fakturowanie'), attr('Narzędzia', 'Optima'), attr('Benefity', 'Karta sportowa'), attr('Doświadczenie', 'Rachunkowość')],
        }),
      ]),
    );
    expect(l).toMatchObject({
      portal: 'smartjobs',
      title: 'Księgowa',
      company: 'Biuro Rachunkowe Przykład',
      url: 'https://thesmartjobs.com/pl/praca/ksiegowa-1a2b3c4d',
      location: 'Olsztyn',
      workModes: ['hybrydowa', 'zdalna'],
      salary: '400-500 PLN / dzień (B2B); 7000-9000 PLN / mies. (umowa o pracę)',
      salaryMonthly: 10500,
      skills: ['Fakturowanie', 'Optima'],
      seniority: '',
      publishedAt: '2026-11-01T10:00:00Z',
    });
    // "Pozostałe" (other) może być zleceniem albo stażem - nie trafia do listy umów, więc nie odrzuca oferty.
    expect(l.contracts).toEqual(['B2B', 'umowa o pracę']);
  });

  it('nawiasy i cudzysłowy w tekstach oferty nie psują odczytu', () => {
    const leads = parseSmartjobs(resultsPage([job({ title: 'Specjalista ds. "obsługi" klienta {VIP} [PL]' }), job({ slugUrl: 'praca/kasjer-9f8e7d6c', title: 'Kasjer' })]));
    expect(leads.map((l) => l.title)).toEqual(['Specjalista ds. "obsługi" klienta {VIP} [PL]', 'Kasjer']);
  });

  it('poziom z nazwy roli i lata doświadczenia trafiają do pola poziomu, więc filtr juniora odrzuca "Starszego"', () => {
    const senior = job({ title: 'Księgowa', role: { name: 'Starsza Księgowa' }, attributes: [attr('Doświadczenie', '5+ lat doświadczenia'), attr('Doświadczenie', 'Rachunkowość')] });
    const [l] = parseSmartjobs(resultsPage([senior]));
    expect(l.seniority).toBe('Starsza Księgowa / 5+ lat doświadczenia');
    expect(screenLeads([l], prefs, 'junior').kept).toEqual([]);
    expect(screenLeads([l], prefs, 'mid').kept).toHaveLength(1);
  });

  it('z promieniem: najbliższe miejsce pracy z odległością, za daleko albo bez współrzędnych - odpada', () => {
    const leads = parseSmartjobs(
      resultsPage([
        job({ locations: [{ city: 'Warszawa', coordinates: { lat: 52.23, lon: 21.01 } }, { city: 'Dywity', coordinates: { lat: 53.835, lon: 20.47 } }] }),
        job({ slugUrl: 'praca/b', locations: [{ city: 'Gdańsk', coordinates: { lat: 54.35, lon: 18.65 } }] }),
        job({ slugUrl: 'praca/c', locations: [{ city: 'Olsztyn' }] }),
      ]),
      { point: OLSZTYN, km: 30 },
    );
    expect(leads.map((l) => l.location)).toEqual(['Dywity (~6 km)']);
  });

  it('strona bez wyników albo bez danych daje pustą listę', () => {
    expect(parseSmartjobs('<html><body>Brak ofert</body></html>')).toEqual([]);
    expect(parseSmartjobs(resultsPage([]))).toEqual([]);
  });

  it('adres wyszukiwania: fraza, tryby pracy i miasto, bez sortowania (robots.txt portalu zabrania ?sort=)', () => {
    const url = new URL(smartjobsUrl('specjalista ds. płac', ['onSite', 'hybrid'], 'R123'));
    expect(url.origin + url.pathname).toBe('https://thesmartjobs.com/pl/praca');
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: 'specjalista ds. płac', workModes: 'onSite,hybrid', osmId: 'R123' });
    expect(new URL(smartjobsUrl('kasjer', [])).search).toBe('?query=kasjer');
  });
});

describe('Smart Jobs: zapytania do portalu', () => {
  function stubFetch(nominatim: unknown[]) {
    const calls: { url: string; ua: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, ua: new Headers(init?.headers).get('User-Agent') ?? '' });
        if (url.includes('nominatim')) return new Response(JSON.stringify(nominatim), { status: 200 });
        return new Response(resultsPage([job()]), { status: 200 });
      }),
    );
    return calls;
  }

  it('praca na miejscu: filtr miasta z relacji OSM (Nominatim), tryby z preferencji, program przedstawia się jako PolCV', async () => {
    const calls = stubFetch([{ lat: '53.7784', lon: '20.4801', osm_type: 'relation', osm_id: 1234567 }]);
    const leads = await activeSearchers().smartjobs.run({ phrase: 'księgowa', scope: 'local', seniority: 'junior', prefs: { ...prefs, onsite: false } });
    expect(leads.map((l) => l.location)).toEqual(['Olsztyn (~1 km)']);
    const sj = calls.filter((c) => c.url.includes('thesmartjobs'));
    expect(sj).toHaveLength(1);
    expect(Object.fromEntries(new URL(sj[0].url).searchParams)).toEqual({ query: 'księgowa', workModes: 'hybrid', osmId: 'R1234567' });
    expect(calls.every((c) => c.ua === APP_UA)).toBe(true);
  });

  it('praca zdalna: tylko oferty zdalne, bez miasta i bez geokodowania', async () => {
    const calls = stubFetch([]);
    await activeSearchers().smartjobs.run({ phrase: 'księgowa', scope: 'remote', seniority: 'junior', prefs: { ...prefs, city: 'Gniezno' } });
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ query: 'księgowa', workModes: 'remote' });
  });

  it('błąd portalu przerywa tylko to zapytanie (wyszukiwanie zgłasza go jako nieudany portal)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(activeSearchers().smartjobs.run({ phrase: 'kasjer', scope: 'remote', seniority: 'junior', prefs })).rejects.toThrow('HTTP 503');
  });
});
