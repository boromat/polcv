import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeSearchers, cleanPhrase, mapContract, parseNofluff, parseNofluffPay, parseSalaryText, screenLeads, searchRole, toMonthly } from '../server/jobs/search';
import { distanceKm } from '../server/jobs/geocode';
import { APP_UA } from '../server/jobs/http';
import type { CareerPrefs, JobLead, RoleProposal } from '../shared/schemas';

afterEach(() => vi.unstubAllGlobals());

const prefs: CareerPrefs = {
  targetRoles: [],
  city: 'Warszawa',
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

const lead = (p: Partial<JobLead>): JobLead => ({
  id: Math.random().toString(36),
  portal: 'pracuj',
  title: 'Junior Data Analyst',
  company: 'Firma',
  location: 'Warszawa',
  workModes: ['hybrydowa'],
  workTime: '',
  salary: '',
  salaryMonthly: null,
  contracts: [],
  seniority: 'Młodszy specjalista (junior)',
  skills: [],
  url: `https://example.com/${Math.random()}`,
  publishedAt: '',
  match: null,
  matchReason: '',
  excludedBy: '',
  ...p,
});

describe('wynagrodzenia i umowy z portali', () => {
  it('przelicza stawki na miesiąc', () => {
    expect(parseSalaryText('8 000–10 500 zł brutto / mies.')).toBe(10500);
    expect(parseSalaryText('90–105 zł netto (+ VAT) / godz.')).toBe(105 * 168);
    expect(parseSalaryText('')).toBeNull();
    expect(toMonthly(120000, 'Year')).toBe(10000);
  });

  it('ujednolica nazwy umów', () => {
    expect(mapContract('Umowa o pracę')).toBe('umowa o pracę');
    expect(mapContract('Kontrakt B2B')).toBe('B2B');
    expect(mapContract('Umowa o staż / praktyki')).toBe('staż / praktyki');
    expect(mapContract('mandate_contract')).toBe('umowa zlecenie');
    expect(mapContract('any')).toBe('dowolna');
    expect(mapContract('uod')).toBe('umowa o dzieło');
  });

  it('umowa "do uzgodnienia" przechodzi każdy filtr umowy', () => {
    const r = screenLeads([lead({ title: 'Trainee', contracts: ['dowolna'] })], { ...prefs, contracts: ['umowa o pracę'] }, 'junior');
    expect(r.kept.map((l) => l.title)).toEqual(['Trainee']);
  });

  it('czyta ofertę z nofluffjobs (stawka PLN, umowa, umiejętności)', () => {
    const posting = {
      url: 'acme-junior-analyst-warszawa',
      title: 'Junior Analyst',
      name: 'ACME',
      location: { places: [{ city: 'Warszawa' }] },
      salary: { from: 6000, to: 8000, currency: 'PLN', type: 'permanent', period: 'Month' },
      seniority: ['Junior'],
      tiles: { values: [{ type: 'requirement', value: 'SQL' }, { type: 'category', value: 'Data' }] },
    };
    const html = `<script id="serverApp-state" type="application/json">${JSON.stringify({ k: { postings: [posting] } })}</script>`;
    const [l] = parseNofluff(html);
    expect(l).toMatchObject({ portal: 'nofluff', location: 'Warszawa', salaryMonthly: 8000, contracts: ['umowa o pracę'], skills: ['SQL'] });
    expect(l.url).toBe('https://nofluffjobs.com/pl/job/acme-junior-analyst-warszawa');
  });

  it('nofluffjobs: umowa o dzieło w opisie stawki po polsku, nie jako "uod"', () => {
    const posting = { url: 'acme-junior-automation-remote', title: 'Junior Automation', name: 'ACME', location: { places: [{ city: 'Remote' }] }, salary: { from: 35, to: 55, currency: 'PLN', type: 'uod', period: 'Hour' } };
    const [l] = parseNofluff(`<script id="serverApp-state" type="application/json">${JSON.stringify({ k: { postings: [posting] } })}</script>`);
    expect(l).toMatchObject({ salary: '35-55 PLN / godz. (umowa o dzieło)', contracts: ['umowa o dzieło'], salaryMonthly: 55 * 168 });
  });

  it('nofluffjobs: strona oferty podaje wszystkie umowy i kwoty, nie tylko tę z wyników wyszukiwania', () => {
    const pay = parseNofluffPay(nfJobPage({ zlecenie: { period: 'Hour', range: [35, 55] }, uod: { period: 'Month', range: [35, 55] } }));
    expect(pay).toEqual({
      contracts: ['umowa zlecenie', 'umowa o dzieło'],
      salary: '35-55 PLN / godz. (umowa zlecenie); 35-55 PLN / mies. (umowa o dzieło)',
      salaryMonthly: 55 * 168,
    });
    // Bez widełek: umowy są, kwoty nie ma.
    expect(parseNofluffPay(nfJobPage({ b2b: { period: 'Month' } }))).toEqual({ contracts: ['B2B'], salary: '', salaryMonthly: null });
    expect(parseNofluffPay(nfJobPage({}))).toBeNull();
    expect(parseNofluffPay('<html><body>Brak oferty</body></html>')).toBeNull();
  });
});

/** Strona oferty nofluffjobs z wynagrodzeniem w `essentials.originalSalary` (tak jak u portalu). */
function nfJobPage(types: Record<string, unknown>): string {
  const state = { '/posting/x?salaryCurrency=original&salaryPeriod=original&region=pl': { id: 'x', essentials: { contract: { start: 'ASAP' }, originalSalary: { currency: 'PLN', types } } } };
  return `<script id="serverApp-state" type="application/json">${JSON.stringify(state)}</script>`;
}

describe('nofluffjobs: odrzucone przez umowę albo kwotę są sprawdzane na stronie oferty', () => {
  const role: RoleProposal = { id: 'r1', title: 'Junior Automation Developer', fit: 'wysokie', seniority: 'junior', why: '', gaps: [], howToClose: '', keywords: ['automation developer'] };
  const listed = (url: string, type: string, period = 'Month', to = 55) => ({ url, title: url, name: url, location: { places: [{ city: 'Remote' }] }, fullyRemote: true, salary: { from: 35, to, currency: 'PLN', type, period } });

  function stubPortals(pages: Record<string, string | number>) {
    const calls: { url: string; ua: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, ua: new Headers(init?.headers).get('User-Agent') ?? '' });
        if (url.startsWith('https://nofluffjobs.com/pl/?criteria=')) {
          const postings = [listed('a-zlecenie-albo-dzielo', 'uod'), listed('b-tylko-b2b', 'b2b'), listed('c-zlecenie', 'zlecenie', 'Hour'), listed('d-strona-nie-dziala', 'uod'), listed('job/e-zly-adres', 'uod')];
          return new Response(`<script id="serverApp-state" type="application/json">${JSON.stringify({ k: { postings } })}</script>`, { status: 200 });
        }
        const page = pages[url.replace('https://nofluffjobs.com/pl/job/', '')];
        if (typeof page === 'string') return new Response(page, { status: 200 });
        if (typeof page === 'number') return new Response('', { status: page });
        return new Response('<html></html>', { status: 200 });
      }),
    );
    return calls;
  }

  it('oferta ze zleceniem albo dziełem przechodzi filtr zlecenia; tylko B2B i niedostępna strona zostają odrzucone', async () => {
    const calls = stubPortals({
      'a-zlecenie-albo-dzielo': nfJobPage({ zlecenie: { period: 'Hour', range: [35, 55] }, uod: { period: 'Month', range: [35, 55] } }),
      'b-tylko-b2b': nfJobPage({ b2b: { period: 'Month', range: [35, 55] } }),
      'd-strona-nie-dziala': 503,
    });
    const r = await searchRole(role, { ...prefs, city: '', contracts: ['umowa zlecenie'] });
    expect(r.kept.map((l) => l.title)).toEqual(['a-zlecenie-albo-dzielo', 'c-zlecenie']);
    expect(r.kept[0]).toMatchObject({ contracts: ['umowa zlecenie', 'umowa o dzieło'], salaryMonthly: 55 * 168 });
    expect(r.excluded.map((l) => [l.title, l.excludedBy])).toEqual([
      ['b-tylko-b2b', 'umowa: B2B'],
      ['d-strona-nie-dziala', 'umowa: umowa o dzieło'],
      ['job/e-zly-adres', 'umowa: umowa o dzieło'],
    ]);
    expect(r.stats).toEqual({ duplikaty: 5, 'inna forma umowy': 3 });
    // Strony ofert: tylko odrzuconych, każda raz, i nigdy pod adresem spoza /pl/job/<nazwa> (robots.txt zabrania /job/job/).
    const jobPages = calls.filter((c) => c.url.includes('/pl/job/')).map((c) => c.url.replace('https://nofluffjobs.com/pl/job/', ''));
    expect(jobPages).toEqual(['a-zlecenie-albo-dzielo', 'b-tylko-b2b', 'd-strona-nie-dziala']);
    expect(calls.every((c) => c.ua === APP_UA)).toBe(true);
  });

  it('za niska kwota z wyników jest sprawdzana ze wszystkimi kwotami ze strony oferty', async () => {
    stubPortals({ 'a-zlecenie-albo-dzielo': nfJobPage({ zlecenie: { period: 'Hour', range: [35, 55] }, uod: { period: 'Month', range: [35, 55] } }) });
    const r = await searchRole(role, { ...prefs, city: '', salaryMin: 5000 });
    expect(r.kept.map((l) => l.title)).toContain('a-zlecenie-albo-dzielo');
  });

  it('bez odrzuconych z nofluffjobs nie pobiera żadnej strony oferty', async () => {
    const calls = stubPortals({});
    await searchRole(role, { ...prefs, city: '' });
    expect(calls.filter((c) => c.url.includes('/pl/job/'))).toEqual([]);
  });
});

/** Tylko oferty, które przeszły filtry. */
const filterLeads = (...args: Parameters<typeof screenLeads>) => screenLeads(...args).kept;

describe('filtry ofert z preferencji', () => {
  it('odrzuca seniorów, duplikaty i niechciane umowy', () => {
    const dup = lead({ title: 'Junior Data Analyst', company: 'Firma', portal: 'justjoin' });
    const out = filterLeads(
      [
        lead({}),
        dup,
        lead({ title: 'Senior Data Analyst', seniority: 'Starszy specjalista (senior)' }),
        lead({ title: 'Data Analyst B2B', contracts: ['B2B'] }),
        lead({ title: 'Data Analyst UoP', contracts: ['umowa o pracę', 'B2B'] }),
      ],
      { ...prefs, contracts: ['umowa o pracę'] },
      'junior',
    );
    expect(out.map((l) => l.title)).toEqual(['Junior Data Analyst', 'Data Analyst UoP']);
  });

  it('minimalne wynagrodzenie dotyczy tylko ofert z podaną kwotą', () => {
    const out = filterLeads(
      [lead({ title: 'A', salaryMonthly: 4000 }), lead({ title: 'B', salaryMonthly: 7000 }), lead({ title: 'C', salaryMonthly: null })],
      { ...prefs, salaryMin: 5000 },
      'junior',
    );
    expect(out.map((l) => l.title)).toEqual(['B', 'C']);
  });

  it('odrzucone przez preferencje są zachowane z powodem i policzone', () => {
    const r = screenLeads(
      [lead({ title: 'A', contracts: ['B2B'] }), lead({ title: 'B', salaryMonthly: 3000 }), lead({ title: 'Senior C' }), lead({ title: 'D' })],
      { ...prefs, contracts: ['umowa o pracę'], salaryMin: 5000 },
      'junior',
    );
    expect(r.kept.map((l) => l.title)).toEqual(['D']);
    expect(r.excluded.map((l) => [l.title, l.excludedBy])).toEqual([['A', 'umowa: B2B'], ['B', 'za niskie wynagrodzenie']]);
    expect(r.stats).toEqual({ 'inna forma umowy': 1, 'za niskie wynagrodzenie': 1, 'dla bardziej doświadczonych': 1 });
  });

  it('frazy bez słów o poziomie i trybie (także z polskimi znakami)', () => {
    expect(cleanPhrase('junior AI engineer')).toBe('AI engineer');
    expect(cleanPhrase('staż analityk danych')).toBe('analityk danych');
    expect(cleanPhrase('Młodszy programista Python (zdalnie)')).toBe('programista Python');
    expect(cleanPhrase('stażowy program')).toBe('stażowy program');
  });

  it('nofluffjobs: tylko biura w promieniu, z odległością', () => {
    const posting = (url: string, city: string, lat: number, lon: number) => ({ url, title: url, name: 'X', location: { places: [{ city, geoLocation: { latitude: lat, longitude: lon } }] }, seniority: ['Junior'] });
    const html = `<script id="serverApp-state" type="application/json">${JSON.stringify({ k: { postings: [posting('warszawa', 'Warszawa', 52.2297, 21.0122), posting('krakow', 'Kraków', 50.0647, 19.945)] } })}</script>`;
    const pruszkow = { lat: 52.1706, lon: 20.8119 };
    const out = parseNofluff(html, { point: pruszkow, km: 30 });
    expect(out.map((l) => l.location)).toEqual(['Warszawa (~15 km)']);
    expect(Math.round(distanceKm(pruszkow, { lat: 50.0647, lon: 19.945 }))).toBeGreaterThan(200);
  });

  it('program sam przeszukuje tylko nofluffjobs i Smart Jobs: żadnych dodatkowych modułów z innymi portalami', () => {
    // Inne portale nie pozwalają na automatyczne pobieranie ofert (blokada albo robots.txt), więc program ich nie wczytuje.
    expect(Object.values(activeSearchers()).map((s) => s.name)).toEqual(['nofluffjobs', 'Smart Jobs']);
  });

  it('wymiar etatu', () => {
    const out = filterLeads([lead({ title: 'A', workTime: 'pełny etat' }), lead({ title: 'B', workTime: 'część etatu' }), lead({ title: 'C' })], { ...prefs, workTime: 'część etatu' }, 'junior');
    expect(out.map((l) => l.title)).toEqual(['B', 'C']);
  });
});
