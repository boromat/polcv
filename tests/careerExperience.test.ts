import { describe, expect, it } from 'vitest';
import { addExperience } from '../server/career';
import { profile } from './fixtures';

const job = (patch: Partial<Parameters<typeof addExperience>[1]> = {}) => ({
  kind: 'praca' as const,
  role: 'Specjalista ds. dokumentacji firmowej',
  company: 'Przykładowa Firma SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  location: '',
  start: '2025-08',
  end: '',
  current: true,
  achievements: ['Szablony dokumentów z AI'],
  ...patch,
});

describe('doświadczenie z rozmowy z doradcą', () => {
  it('nowa firma to nowa pozycja w Doświadczeniu', () => {
    const p = structuredClone(profile);
    addExperience(p, job());
    expect(p.experience).toHaveLength(2);
    expect(p.experience[1]).toMatchObject({ kind: 'praca', company: 'Przykładowa Firma SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', start: '2025-08', current: true });
    expect(p.experience[1].id).toBeTruthy();
  });

  it('ta sama firma pod inną formą prawną: tylko nowe osiągnięcia i puste pola, bez kopii', () => {
    const p = structuredClone(profile);
    addExperience(p, job());
    addExperience(p, job({ company: 'Przykładowa Firma Sp. z o.o.', location: 'Rzeszów', achievements: ['Szablony dokumentów z AI', 'Czas przygotowania dokumentów krótszy o ok. 60%'] }));
    expect(p.experience).toHaveLength(2);
    expect(p.experience[1].achievements).toEqual(['Szablony dokumentów z AI', 'Czas przygotowania dokumentów krótszy o ok. 60%']);
    expect(p.experience[1].location).toBe('Rzeszów');
    expect(p.experience[1].company).toBe('Przykładowa Firma SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ');
  });

  it('istniejąca pozycja z profilu nie jest nadpisywana', () => {
    const p = structuredClone(profile);
    addExperience(p, job({ company: 'Firma Testowa Sp. z o.o.', role: 'Inna rola', start: '2020-01', achievements: ['Nowy punkt'] }));
    expect(p.experience).toHaveLength(1);
    expect(p.experience[0]).toMatchObject({ role: 'Stażystka ds. marketingu', start: '2025-07', end: '2025-09' });
    expect(p.experience[0].achievements.at(-1)).toBe('Nowy punkt');
  });
});
