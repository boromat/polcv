import { describe, expect, it } from 'vitest';
import { activeSearchers, cleanPhrase, filterLeads, mapContract, parseNofluff, parseSalaryText, screenLeads, toMonthly } from '../server/jobs/search';
import { distanceKm } from '../server/jobs/geocode';
import type { CareerPrefs, JobLead } from '../shared/schemas';

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
});

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

  it('program sam przeszukuje tylko nofluffjobs: żadnych dodatkowych modułów z innymi portalami', () => {
    // Inne portale nie pozwalają na automatyczne pobieranie ofert (blokada albo robots.txt), więc program ich nie wczytuje.
    expect(Object.values(activeSearchers()).map((s) => s.name)).toEqual(['nofluffjobs']);
  });

  it('wymiar etatu', () => {
    const out = filterLeads([lead({ title: 'A', workTime: 'pełny etat' }), lead({ title: 'B', workTime: 'część etatu' }), lead({ title: 'C' })], { ...prefs, workTime: 'część etatu' }, 'junior');
    expect(out.map((l) => l.title)).toEqual(['B', 'C']);
  });
});
