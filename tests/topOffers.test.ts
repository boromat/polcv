import { describe, expect, it } from 'vitest';
import { offerKey, topOffers } from '../client/src/pages/topOffers';
import type { Career, JobLead, RoleProposal } from '../shared/schemas';

const role = (id: string, title: string): RoleProposal => ({ id, title, fit: 'wysokie', seniority: 'junior', why: '', gaps: [], howToClose: '', keywords: [] });

const lead = (title: string, match: number | null, p: Partial<JobLead> = {}): JobLead => ({
  id: title,
  portal: 'nofluff',
  title,
  company: 'Firma',
  location: 'zdalnie',
  workModes: ['zdalna'],
  workTime: '',
  salary: '',
  salaryMonthly: null,
  contracts: [],
  seniority: '',
  skills: [],
  url: `https://example.com/${encodeURIComponent(title)}`,
  publishedAt: '2026-11-20T10:00:00Z',
  match,
  matchReason: '',
  excludedBy: '',
  ...p,
});

const found = (items: JobLead[], excluded: JobLead[] = []): Career['offers'][string] => ({ fetchedAt: '', items, excluded, stats: {}, errors: [], scanned: items.length });

describe('najlepiej dopasowane oferty ze wszystkich stanowisk', () => {
  const analyst = role('r1', 'Młodszy analityk');
  const tester = role('r2', 'Tester');

  it('najwyższe oceny z kilku stanowisk razem, najwyżej n, każda ze swoim stanowiskiem', () => {
    const offers = {
      r1: found([lead('A', 60), lead('B', 90), lead('C', 40)]),
      r2: found([lead('D', 85), lead('E', 70), lead('F', 50)]),
    };
    const top = topOffers([analyst, tester], offers, 5, 30);
    expect(top.map((o) => [o.lead.title, o.role.title])).toEqual([
      ['B', 'Młodszy analityk'],
      ['D', 'Tester'],
      ['E', 'Tester'],
      ['A', 'Młodszy analityk'],
      ['F', 'Tester'],
    ]);
  });

  it('pomija oferty bez oceny, słabo dopasowane i odrzucone przez filtry', () => {
    const offers = { r1: found([lead('bez oceny', null), lead('słaba', 20), lead('dobra', 75)], [lead('poza filtrem', 95, { excludedBy: 'umowa: B2B' })]) };
    expect(topOffers([analyst], offers, 5, 30).map((o) => o.lead.title)).toEqual(['dobra']);
  });

  it('ta sama oferta przy dwóch stanowiskach albo na dwóch portalach liczy się raz, z wyższą oceną', () => {
    const offers = {
      r1: found([lead('Junior QA', 70)]),
      r2: found([lead('Junior  QA ', 88, { portal: 'smartjobs', url: 'https://thesmartjobs.com/pl/praca/junior-qa' }), lead('Inna', 60)]),
    };
    const top = topOffers([analyst, tester], offers, 5, 30);
    expect(top.map((o) => [o.lead.match, o.role.id])).toEqual([[88, 'r2'], [60, 'r2']]);
  });

  it('przy równej ocenie najpierw nowsza; stanowiska bez wyszukanych ofert nie przeszkadzają', () => {
    const offers = { r1: found([lead('starsza', 80, { publishedAt: '2026-11-01T10:00:00Z' }), lead('nowsza', 80, { publishedAt: '2026-11-22T10:00:00Z' })]) };
    expect(topOffers([analyst, tester], offers, 1, 30).map((o) => o.lead.title)).toEqual(['nowsza']);
    expect(topOffers([], offers, 5, 30)).toEqual([]);
  });

  it('link oferty bez parametrów i ukośnika na końcu (do oznaczenia "CV już zrobione")', () => {
    expect(offerKey('https://NoFluffJobs.com/pl/job/acme-junior/?utm_source=x')).toBe('nofluffjobs.com/pl/job/acme-junior');
  });
});
