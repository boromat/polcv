import { describe, expect, it } from 'vitest';
import type { CvVersion, Profile } from '../shared/schemas';
import { newsCount, profileIdsOf, profileNews } from '../server/cv/profileNews';
import { cv, profile } from './fixtures';

const job: Profile['experience'][number] = {
  id: 'exp2', kind: 'praca', role: 'Specjalista ds. dokumentacji', company: 'Przykładowa Firma', location: '', start: '2025-08', end: '', current: true,
  description: '', achievements: ['Szablony dokumentów z AI'],
};

describe('co doszło do profilu od wersji CV', () => {
  it('wersja z listą elementów profilu: nowe doświadczenie, umiejętność i fakt, bez tego, co CV już ma', () => {
    const version: CvVersion = { ...cv, profileIds: profileIdsOf(profile) };
    const now: Profile = {
      ...profile,
      experience: [...profile.experience, job],
      skills: [...profile.skills, { id: 's9', name: 'Make', category: 'narzędzia', level: '' }, { id: 's10', name: 'canva', category: 'narzędzia', level: '' }],
      extraFacts: [{ id: 'f1', topic: 'Automatyzacja', has: true, answer: 'Czas przygotowania dokumentów krótszy o ok. 60%', source: '', date: '2026-11-09' }],
    };
    const news = profileNews(now, version);
    expect(news.experience.map((e) => e.id)).toEqual(['exp2']);
    expect(news.skills).toEqual(['Make']); // "canva" CV już ma
    expect(news.facts.map((f) => f.id)).toEqual(['f1']);
    expect(newsCount(news)).toBe(3);
  });

  it('nic nowego: zero i brak zapytania do AI', () => {
    expect(newsCount(profileNews(profile, { ...cv, profileIds: profileIdsOf(profile) }))).toBe(0);
  });

  it('starsza wersja bez listy: gdy profil się od niej nie zmienił, nic nie doszło', () => {
    const old: CvVersion = { ...cv, createdAt: '2026-11-08T10:00:00.000Z', profileIds: undefined };
    expect(newsCount(profileNews({ ...profile, updatedAt: '2026-11-08T09:00:00.000Z' }, old))).toBe(0);
  });

  it('starsza wersja bez listy: pozycje, których CV nie używa, i fakty od dnia wersji; umiejętności nie', () => {
    const old: CvVersion = { ...cv, createdAt: '2026-11-08T10:00:00.000Z', profileIds: undefined };
    const now: Profile = {
      ...profile,
      updatedAt: '2026-11-09T08:00:00.000Z',
      experience: [...profile.experience, job],
      skills: [...profile.skills, { id: 's9', name: 'Make', category: 'narzędzia', level: '' }],
      extraFacts: [
        { id: 'old', topic: 'Stary fakt', has: true, answer: 'sprzed wersji', source: '', date: '2026-11-01' },
        { id: 'new', topic: 'Nowy fakt', has: true, answer: 'z rozmowy z doradcą', source: '', date: '2026-11-09' },
      ],
    };
    const news = profileNews(now, old);
    expect(news.experience.map((e) => e.id)).toEqual(['exp2']);
    expect(news.facts.map((f) => f.id)).toEqual(['new']);
    expect(news.skills).toEqual([]);
  });
});
