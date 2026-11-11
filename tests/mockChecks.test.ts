import { describe, expect, it } from 'vitest';
import type { CvContent, JobPosting, Profile } from '../shared/schemas';
import {
  addressIssues,
  factualErrorIssues,
  interviewProbes,
  lengthScore,
  needsEnglishQuestion,
  placeholders,
  planIssues,
  requiredKinds,
  strongerIssues,
  type FactSources,
  type PlanQuestion,
} from '../server/llm/prompts/mockChecks';
import * as fixtures from './fixtures';

const profile: Profile = structuredClone(fixtures.profile);
const posting: JobPosting = structuredClone(fixtures.posting);
const cv = (): CvContent => structuredClone(fixtures.cv.content);

describe('próbna rozmowa: o co rekruter dopyta (liczone w kodzie)', () => {
  it('umiejętność bez dowodu i punkt bez liczby, najpierw to, co ma słowa z ogłoszenia', () => {
    const probes = interviewProbes(cv(), profile, posting);
    // GA4 ma dowód w osiągnięciach z profilu; Canva i MS Excel nie (Excel jest w ogłoszeniu, więc pierwszy).
    expect(probes.filter((p) => p.kind === 'skill').map((p) => p.item)).toEqual(['MS Excel', 'Canva']);
    expect(probes.filter((p) => p.kind === 'numbers').map((p) => p.item)).toEqual(['Prowadzenie profilu firmy na Instagramie (social media)']);
    expect(probes.find((p) => p.kind === 'numbers')!.detail).toContain('Stażystka ds. marketingu, Firma Testowa Sp. z o.o.');
  });

  it('daty projektu w CV inne niż daty repozytorium GitHub w profilu i daty, które się nie zgadzają', () => {
    const withRepo: Profile = {
      ...profile,
      projects: [{ id: 'pr1', name: 'Pogodynka', role: 'Autor', start: '2024-03', end: '2024-06', description: '', technologies: ['Canva'], link: 'https://github.com/test/pogodynka', achievements: [] }],
      experience: [{ ...profile.experience[0], start: '2025-09', end: '2025-07' }],
    };
    const c = { ...cv(), projects: [{ sourceId: 'pr1', name: 'Pogodynka', role: 'Autor', dates: '01.2023 - 06.2024', technologies: ['Canva'], link: '', bullets: [] }] };
    const dates = interviewProbes(c, withRepo, posting, new Date('2026-11-11')).filter((p) => p.kind === 'dates');
    expect(dates.map((p) => p.item)).toEqual(['Pogodynka', 'Stażystka ds. marketingu, Firma Testowa Sp. z o.o.']);
    expect(dates[0].detail).toContain('repozytorium GitHub');
    expect(dates[0].detail).toContain('03.2024 - 06.2024');
    expect(dates[1].detail).toContain('wcześniejsza');
    // Te same daty co w profilu: nie ma o co dopytywać.
    const same = { ...c, projects: [{ ...c.projects[0], dates: '03.2024 - 06.2024' }] };
    expect(interviewProbes(same, { ...withRepo, experience: profile.experience }, posting, new Date('2026-11-11')).filter((p) => p.kind === 'dates')).toEqual([]);
  });
});

describe('próbna rozmowa: plan', () => {
  const q = (kind: PlanQuestion['kind'], lang: 'pl' | 'en' = 'pl', text = 'Proszę opowiedzieć o projekcie.'): PlanQuestion => ({ kind, text, lang });
  const full = [q('intro'), q('experience'), q('situational'), q('knowledge'), q('tools'), q('gap')];
  const english: JobPosting = { ...posting, keywords: [...posting.keywords, { term: 'angielski', synonyms: ['English'], importance: 'must', category: 'język' }] };

  it('6-8 pytań i każdy wymagany rodzaj; narzędzia tylko, gdy ogłoszenie je wymienia', () => {
    expect(planIssues(full, posting, undefined)).toEqual([]);
    expect(planIssues(full.slice(0, 5), posting, undefined).join('\n')).toContain('Plan ma 5 pytań');
    expect(planIssues([...full.filter((x) => x.kind !== 'gap'), q('probe')], posting, undefined).join('\n')).toContain('brakuje pytań rodzaju: gap');
    expect(requiredKinds({ ...posting, keywords: [], requirementsNice: [] })).not.toContain('tools');
  });

  it('ogłoszenie wymaga angielskiego: dokładnie jedno pytanie po angielsku', () => {
    expect(needsEnglishQuestion(english)).toBe(true);
    expect(needsEnglishQuestion(posting)).toBe(false);
    expect(planIssues(full, english, undefined).join('\n')).toContain('dokładnie jedno pytanie ma być po angielsku');
    expect(planIssues([...full, q('probe', 'en', 'Could you tell us about your last project?')], english, undefined)).toEqual([]);
    expect(planIssues([...full, q('probe', 'en', 'Why this role?')], posting, undefined).join('\n')).toContain('nie wymaga angielskiego');
  });

  it('formy rekrutera według zaimków z profilu, a bez nich bez rodzaju', () => {
    expect(addressIssues('Czy pracowałeś z Excelem?', undefined)).toEqual(['pracowałeś']);
    expect(addressIssues('Czy pracowałaś z Excelem?', 'ona')).toEqual([]);
    expect(addressIssues('Czy pracowałaś z Excelem?', 'on')).toEqual(['pracowałaś']);
    expect(addressIssues('Czy może Pani opowiedzieć?', 'on')).toEqual(['Pani']);
    expect(addressIssues('Jak wyglądała praca z Excelem?', undefined)).toEqual([]);
    expect(planIssues([q('intro', 'pl', 'Dlaczego aplikowałeś?'), ...full.slice(1)], posting, undefined).join('\n')).toContain('nie podał, jak się określa');
  });
});

describe('próbna rozmowa: długość odpowiedzi liczy program', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'słowo').join(' ');
  it('45-180 słów to pełny wynik; za krótka i rozwlekła tracą', () => {
    expect([10, 20, 40, 60, 180, 200, 300, 400].map((n) => lengthScore(words(n)))).toEqual([1, 2, 4, 5, 5, 3, 2, 1]);
  });
});

describe('próbna rozmowa: mocniejsza wersja nie może niczego wymyślać', () => {
  const src = (answers: string[] = []): FactSources => ({ texts: [...answers, 'Prowadziłam profil firmy na Instagramie', 'Przygotowywałam raporty w Google Analytics 4', 'Canva'], posting });

  it('liczba spoza profilu, CV i odpowiedzi kandydata wraca do modelu; miejsce w nawiasach przechodzi', () => {
    const bad = strongerIssues('Prowadziłam profil firmy na Instagramie i zwiększyłam zasięg o 40%.', 'experience', src(), 'ona', 'pl');
    expect(bad.join('\n')).toContain('40');
    expect(strongerIssues('Prowadziłam profil firmy na Instagramie i zwiększyłam zasięg o [o ile procent].', 'experience', src(), 'ona', 'pl')).toEqual([]);
    expect(placeholders('Raporty [ile tygodniowo] dla [kogo] i znów [ile tygodniowo]')).toEqual(['[ile tygodniowo]', '[kogo]']);
  });

  it('liczba, którą kandydat podał w tej rozmowie, jest faktem', () => {
    const answers = ['Robiłam 12 raportów miesięcznie.'];
    expect(strongerIssues('Przygotowywałam 12 raportów miesięcznie w Google Analytics 4.', 'experience', src(answers), 'ona', 'pl')).toEqual([]);
  });

  it('nazwa spoza źródeł (skrót albo narzędzie z ogłoszenia) w odpowiedzi o doświadczeniu wraca; w pytaniu o wiedzę nie', () => {
    expect(strongerIssues('Prowadziłam kampanie w Google Ads i raporty w SQL.', 'experience', src(), 'ona', 'pl').join('\n')).toMatch(/SQL.*Google Ads|Google Ads.*SQL/);
    expect(strongerIssues('RODO wymaga podstawy prawnej przetwarzania danych.', 'knowledge', src(), 'ona', 'pl')).toEqual([]);
    // Nazwa firmy i stanowiska z ogłoszenia może paść.
    expect(strongerIssues('Chcę pracować w Przykład S.A. jako Młodszy Specjalista ds. Marketingu.', 'intro', src(), 'ona', 'pl')).toEqual([]);
  });

  it('formy z rodzajem: tylko formy kandydata, a bez zaimków żadnych', () => {
    expect(strongerIssues('Prowadziłem profil firmy na Instagramie.', 'experience', src(), 'ona', 'pl').join('\n')).toContain('Prowadziłem');
    expect(strongerIssues('Prowadziłam profil firmy na Instagramie.', 'experience', src(), undefined, 'pl').join('\n')).toContain('nie podał');
    expect(strongerIssues('Moim zadaniem było prowadzenie profilu firmy na Instagramie.', 'experience', src(), undefined, 'pl')).toEqual([]);
  });

  it('błąd merytoryczny: poprawka bez numerów artykułów spoza odpowiedzi i bez linków', () => {
    const answer = 'Anonimizację danych nakazuje AI Act.';
    expect(factualErrorIssues([{ claim: 'AI Act nakazuje anonimizację', correction: 'Obowiązek wynika z art. 32 RODO.', whereToCheck: 'tekst rozporządzenia' }], answer).join('\n')).toContain('32');
    expect(factualErrorIssues([{ claim: 'AI Act nakazuje anonimizację', correction: 'To przepisy o ochronie danych, nie AI Act.', whereToCheck: 'https://eur-lex.europa.eu' }], answer).join('\n')).toContain('link');
    expect(factualErrorIssues([{ claim: 'AI Act nakazuje anonimizację', correction: 'Zasady ochrony danych osobowych wynikają z RODO, a nie z AI Act.', whereToCheck: 'oficjalny tekst RODO' }], answer)).toEqual([]);
    expect(factualErrorIssues([{ claim: 'x', correction: 'To rozporządzenie 2016/679.', whereToCheck: 'Dz.U. 2018 poz. 1000' }], answer).join('\n')).toMatch(/2016\/679.*Dz\.U\. 2018|Dz\.U\. 2018.*2016\/679/);
    // Zwykła liczba (stawka, próg) może być w poprawce; numer artykułu z odpowiedzi kandydata też.
    expect(factualErrorIssues([{ claim: 'Stawka VAT to 25%', correction: 'Podstawowa stawka VAT w Polsce to 23%.', whereToCheck: 'ustawa o VAT' }], 'Stawka VAT to 25%.')).toEqual([]);
    expect(factualErrorIssues([{ claim: 'art. 6 RODO', correction: 'Art. 6 dotyczy podstaw przetwarzania, nie anonimizacji.', whereToCheck: 'tekst RODO' }], 'Anonimizację nakazuje art. 6 RODO.')).toEqual([]);
  });
});
