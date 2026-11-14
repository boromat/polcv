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
const theprotocol = (p: CareerPrefs, r: RoleProposal = role) => new URL(portalLinks(r, p).find((l) => l.name === 'theprotocol.it')!.url);

describe('linki do wyszukiwarek portali', () => {
  it('każdy portal z ofert ma nazwę do wyświetlenia', () => {
    expect(Object.keys(PORTAL_NAMES).sort()).toEqual([...Portals].sort());
    expect(portalLinks(role, prefs).map((l) => l.name)).toEqual(['pracuj.pl', 'justjoin.it', 'nofluffjobs', 'Smart Jobs', 'theprotocol.it']);
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

  it('theprotocol.it: poziom, tryb pracy i miasto w ścieżce, fraza w kw', () => {
    const url = theprotocol(prefs);
    expect(url.origin).toBe('https://theprotocol.it');
    expect(url.pathname).toBe('/filtry/trainee,assistant,junior;p/stacjonarna;rw/lodz;wp');
    expect(Object.fromEntries(url.searchParams)).toEqual({ kw: 'księgowy' });
    expect(theprotocol({ ...prefs, hybrid: true }).pathname).toBe('/filtry/trainee,assistant,junior;p/stacjonarna,hybrydowa;rw/lodz;wp');
    expect(theprotocol({ ...prefs, city: '', remote: true }, { ...role, seniority: 'mid' }).pathname).toBe('/filtry/junior,mid;p/zdalna;rw');
    // Bez miasta i bez pracy zdalnej: sam poziom, oferty z całego portalu.
    expect(theprotocol({ ...prefs, city: '' }).pathname).toBe('/filtry/trainee,assistant,junior;p');
  });
});
