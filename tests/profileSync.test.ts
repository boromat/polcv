import { describe, expect, it } from 'vitest';
import { parseCvDates, syncCvEdit } from '../server/cv/profileSync';
import { cv, profile } from './fixtures';

const setup = () => ({ p: structuredClone(profile), before: structuredClone(cv.content), after: structuredClone(cv.content) });

describe('daty z CV w formacie profilu', () => {
  it.each([
    ['07.2025 – 09.2025', { start: '2025-07', end: '2025-09', current: false }],
    ['3/2024 - present', { start: '2024-03', end: '', current: true }],
    ['10.2023 – obecnie', { start: '2023-10', end: '', current: true }],
    ['2021 - 2024', { start: '2021', end: '2024', current: false }],
  ])('"%s"', (text, dates) => {
    expect(parseCvDates(text)).toEqual(dates);
  });

  it.each(['lato 2024', '07.2025', '13.2024 - 01.2025', ''])('"%s" to nie zakres dat', (text) => {
    expect(parseCvDates(text)).toBeNull();
  });
});

describe('poprawki w CV trafiają do profilu', () => {
  it('stanowisko, firma i daty doświadczenia', () => {
    const { p, before, after } = setup();
    after.experience[0].role = 'Asystentka ds. marketingu';
    after.experience[0].dates = '06.2025 – 09.2025';
    expect(syncCvEdit(p, before, after)).toEqual(['doświadczenie „Asystentka ds. marketingu”']);
    expect(p.experience[0]).toMatchObject({ role: 'Asystentka ds. marketingu', start: '2025-06', end: '2025-09', current: false });
  });

  it('poprawiony punkt trafia do osiągnięć, a kolejna poprawka go zastępuje zamiast dopisywać kopię', () => {
    const { p, before, after } = setup();
    after.experience[0].bullets[0].text = 'Prowadzenie profilu firmy na Instagramie (12 tys. obserwujących)';
    syncCvEdit(p, before, after);
    expect(p.experience[0].achievements).toHaveLength(3);

    const again = structuredClone(after);
    again.experience[0].bullets[0].text = 'Prowadzenie profilu firmy na Instagramie (15 tys. obserwujących)';
    syncCvEdit(p, after, again);
    expect(p.experience[0].achievements).toEqual([
      'Prowadziłam profil firmy na Instagramie',
      'Przygotowywałam raporty w Google Analytics 4',
      'Prowadzenie profilu firmy na Instagramie (15 tys. obserwujących)',
    ]);
  });

  it('nowy punkt dopisany w edytorze też trafia do profilu', () => {
    const { p, before, after } = setup();
    after.experience[0].bullets.push({ id: 'b3', text: 'Planowanie kalendarza publikacji', status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp1'] });
    syncCvEdit(p, before, after);
    expect(p.experience[0].achievements).toContain('Planowanie kalendarza publikacji');
  });

  it('niepotwierdzona sugestia AI nie trafia do profilu', () => {
    const { p, before, after } = setup();
    after.experience[0].bullets[1].text = 'Zwiększenie zasięgu profilu o ok. 50%';
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p).toEqual(profile);
  });

  it('nowe umiejętności, język, certyfikat i zainteresowania są dopisywane bez duplikatów', () => {
    const { p, before, after } = setup();
    after.skills[0].items.push('Meta Business Suite', 'canva');
    after.languages = [{ name: 'Angielski', level: 'C1' }, { name: 'Niemiecki', level: 'A2' }];
    after.certificates = [{ name: 'Google Ads Search', issuer: 'Google', date: '2025' }];
    after.interests = ['fotografia'];
    expect(syncCvEdit(p, before, after)).toEqual(['umiejętności: Meta Business Suite', 'języki', 'certyfikaty', 'zainteresowania']);
    expect(p.skills.map((s) => s.name)).toEqual(['Google Analytics 4', 'Canva', 'MS Excel', 'Meta Business Suite']);
    expect(p.skills.at(-1)?.category).toBe('narzędzia');
    expect(p.languages.map((l) => `${l.name} ${l.level}`)).toEqual(['Angielski C1', 'Niemiecki A2']);
    expect(p.certificates[0]).toMatchObject({ name: 'Google Ads Search', issuer: 'Google', date: '2025' });
    expect(p.interests).toEqual(['fotografia']);
  });

  it('tytuł i podsumowanie są pod ogłoszenie, więc zostają tylko w CV', () => {
    const { p, before, after } = setup();
    after.headline = 'Specjalistka ds. e-commerce';
    after.summary.text = 'Inne podsumowanie pod to jedno ogłoszenie.';
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p).toEqual(profile);
  });

  it('wyczyszczone pole w CV nie kasuje danych w profilu', () => {
    const { p, before, after } = setup();
    after.experience[0].role = '';
    after.experience[0].company = '';
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p.experience[0].role).toBe('Stażystka ds. marketingu');
  });

  it('CV po angielsku z polskiego profilu niczego w profilu nie zmienia', () => {
    const { p, before, after } = setup();
    before.language = 'en';
    after.language = 'en';
    after.experience[0].role = 'Marketing Intern';
    after.skills[0].items.push('Teamwork');
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p).toEqual(profile);
  });

  it('doświadczenie dopisane w edytorze przyciskiem "+" trafia do profilu jako nowa pozycja, a potem jest poprawiane', () => {
    const { p, before, after } = setup();
    const added = { sourceId: 'cv-abc123', role: '', company: '', location: '', dates: '', bullets: [] };
    // Pusta pozycja, zanim kandydat cokolwiek wpisze: jeszcze nic w profilu.
    after.experience.push(added);
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p.experience).toHaveLength(1);

    const typed = structuredClone(after);
    Object.assign(typed.experience[1], {
      role: 'Mechanik samochodowy',
      company: 'Serwis Testowy',
      dates: '03.2026 - obecnie',
      bullets: [{ id: 'n1', text: 'Wymiana rozrządu i diagnostyka', status: 'fact', reason: '', fallbackText: '', sourceIds: [] }],
    });
    expect(syncCvEdit(p, after, typed)).toEqual(['nowe doświadczenie „Mechanik samochodowy”']);
    expect(p.experience[1]).toMatchObject({
      id: 'cv-abc123', kind: 'praca', role: 'Mechanik samochodowy', company: 'Serwis Testowy', start: '2026-03', end: '', current: true,
      achievements: ['Wymiana rozrządu i diagnostyka'],
    });

    const fixed = structuredClone(typed);
    fixed.experience[1].location = 'Rzeszów';
    expect(syncCvEdit(p, typed, fixed)).toEqual(['doświadczenie „Mechanik samochodowy”']);
    expect(p.experience).toHaveLength(2);
    expect(p.experience[1].location).toBe('Rzeszów');
  });

  it('nowy projekt i szkoła z edytora też trafiają do profilu', () => {
    const { p, before, after } = setup();
    after.projects.push({ sourceId: 'cv-p1', name: 'Renowacja motocykla', role: '', dates: '', technologies: ['spawanie TIG'], link: '', bullets: [] });
    after.education.push({ sourceId: 'cv-e1', school: 'Technikum Samochodowe', degree: 'technik', field: 'pojazdy samochodowe', dates: '09.2020 - 06.2024', details: '' });
    expect(syncCvEdit(p, before, after)).toEqual(['nowy projekt „Renowacja motocykla”', 'nowa szkoła „Technikum Samochodowe”']);
    expect(p.projects[0]).toMatchObject({ id: 'cv-p1', name: 'Renowacja motocykla', technologies: ['spawanie TIG'] });
    expect(p.education[1]).toMatchObject({ id: 'cv-e1', school: 'Technikum Samochodowe', start: '2020-09', end: '2024-06' });
  });

  it('pozycja spoza profilu bez znacznika "cv-" (np. usunięta z profilu) nie jest zakładana od nowa', () => {
    const { p, before, after } = setup();
    p.experience = [];
    after.experience[0].role = 'Asystentka ds. marketingu';
    expect(syncCvEdit(p, before, after)).toEqual([]);
    expect(p.experience).toEqual([]);
  });

  it('szczegóły wykształcenia: wypełniają puste pole i przejmują poprawkę tego samego tekstu', () => {
    const { p, before, after } = setup();
    after.education[0].details = 'Średnia 4,8';
    syncCvEdit(p, before, after);
    expect(p.education[0].details).toBe('Średnia 4,8');

    const again = structuredClone(after);
    again.education[0].details = 'Średnia 4,9';
    syncCvEdit(p, after, again);
    expect(p.education[0].details).toBe('Średnia 4,9');
  });

  it('szczegóły w CV inne niż w profilu (wybór pod ogłoszenie) są dopisywane, a nie nadpisują profilu', () => {
    const { p, before, after } = setup();
    p.education[0].details = 'Praca dyplomowa o marketingu w TikToku';
    after.education[0].details = 'Koło naukowe marketingu';
    syncCvEdit(p, before, after);
    expect(p.education[0].details).toBe('Praca dyplomowa o marketingu w TikToku; Koło naukowe marketingu');
  });
});
