import { describe, expect, it } from 'vitest';
import { companyCore, goworkSearchUrl } from '../shared/gowork';

describe('opinie na GoWork', () => {
  it.each([
    ['PRZYKŁADOWA FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', 'PRZYKŁADOWA FIRMA'],
    ['Lipowy Gaj S.A.', 'Lipowy Gaj'],
    ['Zielony Ogród Polska SA', 'Zielony Ogród Polska'],
    ['Netguru S.A', 'Netguru'],
    ['Allegro.pl sp. z o.o.', 'Allegro.pl'],
    ['Kowalski i Wspólnicy Sp. z o.o. Sp. k.', 'Kowalski i Wspólnicy'],
    ['Firma Testowa Spółka z o.o.', 'Firma Testowa'],
    ['„Pod Lipą” Spółka Jawna', 'Pod Lipą'],
    ['Nokia Solutions and Networks', 'Nokia Solutions and Networks'],
    ['Spa Resort Kowalski', 'Spa Resort Kowalski'],
    ['  Samsung R&D Institute Poland  ', 'Samsung R&D Institute Poland'],
  ])('z "%s" szuka "%s"', (name, core) => {
    expect(companyCore(name)).toBe(core);
  });

  it('nazwa, która jest samą formą prawną, zostaje jak była', () => {
    expect(companyCore('Spółka Akcyjna')).toBe('Spółka Akcyjna');
  });

  it('link prowadzi do wyszukiwania na gowork.pl, a bez nazwy firmy go nie ma', () => {
    const url = new URL(goworkSearchUrl('Lipowy Gaj S.A.'));
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('q')).toBe('Lipowy Gaj site:gowork.pl');
    expect(goworkSearchUrl('')).toBe('');
    expect(goworkSearchUrl('   ')).toBe('');
  });
});
