import { describe, expect, it } from 'vitest';
import { PORTAL_NAMES, portalLinks } from '../client/src/pages/portalLinks';
import { Portals, type CareerPrefs, type RoleProposal } from '../shared/schemas';

const role: RoleProposal = {
  id: 'r1',
  title: 'Młodszy księgowy',
  fit: 'wysokie',
  seniority: 'junior',
  why: '',
  gaps: [],
  howToClose: '',
  keywords: ['księgowy', 'fakturowanie'],
};

const prefs: CareerPrefs = {
  targetRoles: [],
  city: 'Łódź',
  radiusKm: 30,
  onsite: true,
  hybrid: false,
  remote: false,
  salaryMin: 0,
  contracts: [],
  workTime: 'dowolny',
  seniority: 'junior',
  notes: '',
};

const smartjobs = (p: CareerPrefs) => new URL(portalLinks(role, p).find((l) => l.name === 'Smart Jobs')!.url);

describe('linki do wyszukiwarek portali', () => {
  it('każdy portal z ofert ma nazwę do wyświetlenia', () => {
    expect(Object.keys(PORTAL_NAMES).sort()).toEqual([...Portals].sort());
    expect(portalLinks(role, prefs).map((l) => l.name)).toEqual(['pracuj.pl', 'justjoin.it', 'nofluffjobs', 'Smart Jobs']);
  });

  it('Smart Jobs: fraza i tryb pracy z preferencji, bez sortowania', () => {
    const url = smartjobs(prefs);
    expect(url.origin + url.pathname).toBe('https://thesmartjobs.com/pl/praca');
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: 'księgowy', workModes: 'onSite' });
    expect(Object.fromEntries(smartjobs({ ...prefs, city: '', remote: true }).searchParams)).toEqual({ query: 'księgowy', workModes: 'remote' });
    expect(Object.fromEntries(smartjobs({ ...prefs, hybrid: true }).searchParams).workModes).toBe('onSite,hybrid');
    // Bez miasta i bez pracy zdalnej: sama fraza, oferty z całego portalu.
    expect(Object.fromEntries(smartjobs({ ...prefs, city: '' }).searchParams)).toEqual({ query: 'księgowy' });
  });
});
