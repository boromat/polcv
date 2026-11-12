import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CvContentSchema, type CvContent, type CvText, type Keyword, type Profile } from '../shared/schemas';
import {
  checkedCvSchema,
  checkedImproveSchema,
  cvDate,
  cvDateRange,
  firstPersonVerb,
  groundCv,
  knownNumbers,
  lostKeywordIssues,
  numberFinder,
  rejectedSkillItems,
  safeHeadline,
  skillIssues,
  sourceIssues,
  styleIssues,
  summaryPersonIssues,
  unconfirmedHeadlineNames,
  unverifiedSkillItems,
  withoutNumbers,
} from '../server/llm/prompts/cvChecks';
import { withLang } from '../server/i18n';

// Fikcyjna osoba - tylko do testów.
const profile: Profile = {
  id: 'p1',
  displayName: 'Test',
  createdAt: '',
  updatedAt: '',
  apiKey: '',
  photo: '',
  files: [],
  contact: { fullName: 'Jan Testowy', email: 'jan@example.com', phone: '+48 600 700 800', location: 'Kraków', links: [] },
  headline: '',
  summary: 'Student marketingu',
  experience: [
    {
      id: 'exp1', kind: 'staż', role: 'Stażysta ds. marketingu', company: 'Firma Testowa Sp. z o.o.', location: 'Kraków',
      start: '2025-07', end: '2025-09', current: false, description: 'Obsługa 120 zgłoszeń klientów', achievements: ['Prowadziłem profil firmy na Instagramie'],
    },
    { id: 'exp2', kind: 'praca', role: 'Kelner', company: 'Kawiarnia Test', location: 'Kraków', start: '2024-03', end: '', current: true, description: '', achievements: [] },
    { id: 'exp3', kind: 'inne', role: 'Pomoc', company: '', location: '', start: 'lato 2022', end: '', current: false, description: '', achievements: [] },
  ],
  education: [{ id: 'edu1', school: 'Uniwersytet Testowy', degree: 'licencjat', field: 'Marketing', start: '2023-10', end: '', current: true, details: 'Średnia 4,6' }],
  projects: [{ id: 'pr1', name: 'Kampania koła naukowego', role: '', start: '2024', end: '', description: '', technologies: ['Canva'], link: '', achievements: [] }],
  skills: [{ id: 's1', name: 'Google Analytics 4', category: 'narzędzia', level: '' }],
  languages: [{ id: 'l1', name: 'Angielski', level: 'B2' }],
  certificates: [],
  interests: [],
  extraFacts: [
    { id: 'x1', topic: 'Google Ads', has: true, answer: 'Kampania z budżetem 500 zł w kole naukowym', source: '', date: '2026-10-01' },
    { id: 'x2', topic: 'SQL', has: false, answer: 'Nie, było 35 godzin zajęć dawno temu', source: '', date: '2026-10-01' },
  ],
};

const text = (t: string, extra: Partial<CvText> = {}): CvText => ({ id: 't1', text: t, status: 'fact', reason: '', fallbackText: '', sourceIds: [], ...extra });

const cv = (over: Partial<CvContent> = {}): CvContent => ({
  language: 'pl',
  headline: 'Młodszy specjalista ds. marketingu',
  summary: text('Studiuję marketing i mam doświadczenie w social media.'),
  sectionOrder: ['summary', 'experience', 'education'],
  experience: [
    { sourceId: 'exp1', role: 'Stażysta ds. marketingu', company: 'Firma Test', location: 'Kraków', dates: '07.2025 - 10.2025', bullets: [text('Prowadzenie profilu firmy na Instagramie')] },
  ],
  projects: [],
  education: [{ sourceId: 'edu1', school: 'Uniwersytet Testowy', degree: 'licencjat', field: 'Marketing', dates: '2023 - 2026', details: '' }],
  skills: [],
  certificates: [],
  languages: [],
  interests: [],
  notes: '',
  ...over,
});

const withBullets = (...bullets: CvText[]) => cv({ experience: [{ ...cv().experience[0], bullets }] });

describe('punkty w 1. osobie', () => {
  it('wyłapuje czas przeszły w 1. osobie w dwóch pierwszych słowach', () => {
    expect(firstPersonVerb('Przygotowywałem cotygodniowe raporty')).toBe('Przygotowywałem');
    expect(firstPersonVerb('Samodzielnie zbudowałem dashboard w Power BI')).toBe('zbudowałem');
    expect(firstPersonVerb('Stworzyłam stronę internetową')).toBe('Stworzyłam');
    expect(firstPersonVerb('Prowadziłem profil firmy')).toBe('Prowadziłem');
    expect(firstPersonVerb('Zacząłem kurs SQL')).toBe('Zacząłem');
    expect(firstPersonVerb('- Wsparłem zespół sprzedaży')).toBe('Wsparłem');
  });

  it('przepuszcza formy rzeczownikowe i rzeczowniki na -łem', () => {
    for (const t of [
      'Współpraca z działem marketingu',
      'Zarządzanie kanałem YouTube',
      'Kierowanie zespołem 3 osób',
      'Przygotowywanie cotygodniowych raportów',
      'Budowa dashboardu w Power BI',
      'Praca z portalem ogłoszeń',
      'Udział w projekcie, który zbudowałem', // dalej niż drugie słowo - poza kontrolą
    ]) {
      expect(firstPersonVerb(t)).toBeNull();
    }
  });

  it('po polsku wraca do poprawki punkt i wersja bezpieczna w 1. osobie, po angielsku punkt od "I"', () => {
    const pl = withBullets(text('Prowadziłem profil firmy'), text('Analiza danych', { status: 'suggested', fallbackText: 'Zrobiłam raport' }));
    expect(styleIssues(pl, 'pl').map((i) => i.path.join('.'))).toEqual(['experience.0.bullets.0.text', 'experience.0.bullets.1.fallbackText']);
    expect(styleIssues(pl, 'en')).toEqual([]);

    const en = withBullets(text('I built a dashboard'), text("I'm responsible for reports"), text('Built a dashboard in Power BI'), text('IT support for 3 teams'));
    expect(styleIssues(en, 'en').map((i) => i.path.join('.'))).toEqual(['experience.0.bullets.0.text', 'experience.0.bullets.1.text']);
  });
});

describe('podsumowanie pisane przez kandydata', () => {
  it('wyłapuje 3. osobę i czas przeszły z rodzajem', () => {
    expect(summaryPersonIssues('Zna Excel, SQL i Power BI, a w projektach tworzy raporty. Jest studentem.')).toEqual({ thirdPerson: ['Zna', 'tworzy', 'Jest'], gendered: [], nominal: [] });
    expect(summaryPersonIssues('Pracowałem w social media i zbudowałam sklep.')).toEqual({ thirdPerson: [], gendered: ['Pracowałem', 'zbudowałam'], nominal: [] });
  });

  it('równoważnik od nazwy roli i imiesłów po przecinku to opis kogoś z boku', () => {
    expect(summaryPersonIssues('Student logistyki, pracujący z arkuszami kalkulacyjnymi. Tworzę raporty.').nominal).toEqual(['Student', 'pracujący']);
    expect(summaryPersonIssues('Technik informatyk z doświadczeniem w sieciach.').nominal).toEqual(['Technik']);
  });

  it('przepuszcza 1. osobę w czasie teraźniejszym i zdania bez czasownika', () => {
    for (const t of [
      'Jestem studentem kierunku Logistyka. Znam Excela i SAP, tworzę raporty magazynowe i szukam pracy w planowaniu dostaw.',
      'Studiuję logistykę. Tworzę raporty wspierające planowanie dostaw.',
      'Jestem studentką marketingu. Mam doświadczenie w social media i współpracy z działem sprzedaży.',
      'Doświadczenie w analizie danych (Excel, Power BI), praca zespołem projektowym.',
    ]) {
      expect(summaryPersonIssues(t)).toEqual({ thirdPerson: [], gendered: [], nominal: [] });
    }
  });

  it('z podanymi zaimkami czas przeszły w 1. osobie w formie kandydata przechodzi, inny rodzaj i 2. osoba nie', () => {
    const t = 'Ukończyłam technikum ekonomiczne i pracuję w sprzedaży.';
    expect(summaryPersonIssues(t, 'ona').gendered).toEqual([]);
    expect(summaryPersonIssues(t, 'on').gendered).toEqual(['Ukończyłam']);
    expect(summaryPersonIssues(t).gendered).toEqual(['Ukończyłam']);
    expect(summaryPersonIssues('Zaprojektowałem aplikację w FastAPI.', 'on').gendered).toEqual([]);
    expect(summaryPersonIssues('Zrobiłaś projekt i zrobiłeś stronę.', 'ona').gendered).toEqual(['Zrobiłaś', 'zrobiłeś']);
    expect(summaryPersonIssues('Pracowałem i pracowałam.', 'ono').gendered).toEqual(['Pracowałem', 'pracowałam']);
    // Rzeczowniki na -łem nadal nie są czasownikami.
    expect(summaryPersonIssues('Współpracuję z działem sprzedaży.', 'on').gendered).toEqual([]);
  });

  it('schemat CV przepuszcza czas przeszły zgodny z zaimkami profilu i podaje modelowi właściwą formę', () => {
    const c = withBullets();
    c.summary = { ...c.summary, text: 'Ukończyłam staż w marketingu i rozwijam się w analityce.' };
    expect(checkedCvSchema({ ...profile, pronouns: 'ona' }, 'pl').safeParse(c).success).toBe(true);
    const wrong = checkedCvSchema({ ...profile, pronouns: 'on' }, 'pl').safeParse(c);
    expect(wrong.success).toBe(false);
    expect(wrong.error!.issues.map((i) => i.message).join('\n')).toContain('określa się jako „on”');
    // Bez zaimków jak dotąd: bez zgadywania płci.
    expect(checkedCvSchema({ ...profile, pronouns: undefined }, 'pl').safeParse(c).success).toBe(false);
  });

  it('po polsku podsumowanie w 3. osobie wraca do poprawki (także wersja bezpieczna), po angielsku nie', () => {
    const c = withBullets();
    c.summary = { ...c.summary, text: 'Zna Excel i tworzy raporty.', status: 'suggested', fallbackText: 'Posiada wiedzę o Excelu.' };
    expect(styleIssues(c, 'pl').map((i) => i.path.join('.'))).toEqual(['summary.text', 'summary.fallbackText']);
    expect(styleIssues(c, 'en')).toEqual([]);
  });
});

describe('umiejętności spoza profilu', () => {
  const react: Keyword = { term: 'React', synonyms: ['ReactJS'], importance: 'must', category: 'narzędzie' };

  const java: Keyword = { term: 'Java', synonyms: ['Java 17'], importance: 'must', category: 'umiejętność' };

  it('lista umiejętności: tylko z profilu albo z odpowiedzi "mam"; dopisek w nawiasie nie ratuje', () => {
    const c = cv({ skills: [{ category: 'Narzędzia', items: ['Google Analytics 4', 'Canva', 'Google Ads', 'SQL', 'Java (w nauce)'] }] });
    // Google Ads potwierdza odpowiedź "mam", SQL ma odpowiedź "nie mam".
    expect(unverifiedSkillItems(c, profile)).toEqual(['SQL', 'Java (w nauce)']);
    const r = checkedCvSchema(profile, 'pl', [java]).safeParse(c);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('Umiejętności spoza profilu: „SQL”, „Java (w nauce)”');
    expect(checkedCvSchema(profile, 'pl').safeParse(cv({ skills: [{ category: 'Narzędzia', items: ['Google Analytics 4', 'Canva'] }] })).success).toBe(true);
  });

  it('do poprawki wracają tylko konkretne nazwy; przeformułowaną cechę pokazuje samo ostrzeżenie w edytorze', () => {
    const c = cv({ skills: [{ category: 'Kompetencje', items: ['Współpraca zespołowa', 'Java'] }] });
    expect(unverifiedSkillItems(c, profile, [java])).toEqual(['Współpraca zespołowa', 'Java']);
    // "Java" jest wymagana w ogłoszeniu, więc to konkretne twierdzenie; bez ogłoszenia to zwykłe słowo.
    expect(skillIssues(c, profile, [java]).map((i) => i.message).join('')).toContain('„Java”');
    expect(skillIssues(c, profile, [java]).map((i) => i.message).join('')).not.toContain('Współpraca');
    expect(skillIssues(c, profile)).toEqual([]);
  });

  it('CV po angielsku z polskiego profilu: narzędzia z ogłoszenia i nazwy techniczne tak, zwykłe słowa (tłumaczenia) nie', () => {
    const c = cv({ language: 'en', skills: [{ category: 'Skills', items: ['React', 'TypeScript', 'Teamwork', 'Canva'] }] });
    expect(unverifiedSkillItems(c, profile, [react])).toEqual(['React', 'TypeScript']);
    // Bez słowa kluczowego z ogłoszenia "React" wygląda jak zwykłe słowo: jak dotąd go nie ruszamy.
    expect(unverifiedSkillItems(c, profile)).toEqual(['TypeScript']);
  });

  // Jak para 14 z evals/: w ewaluacji kontrola trzy razy odrzuciła tłumaczenia umiejętności z profilu.
  const logistics: Profile = {
    ...profile,
    summary: 'Absolwent logistyki',
    skills: [
      { id: 's1', name: 'MS Excel', category: 'narzędzia', level: '' },
      { id: 's2', name: 'system TMS', category: 'narzędzia', level: '' },
      { id: 's3', name: 'dokumenty CMR', category: 'techniczne', level: '' },
      { id: 's4', name: 'planowanie tras', category: 'techniczne', level: '' },
    ],
    languages: [{ id: 'l1', name: 'angielski', level: 'C1' }],
    extraFacts: [],
  };
  const excel: Keyword = { term: 'Excel', synonyms: ['MS Excel', 'Microsoft Excel'], importance: 'must', category: 'narzędzie' };
  const sap: Keyword = { term: 'SAP', synonyms: ['SAP ERP'], importance: 'nice', category: 'narzędzie' };

  it('CV po angielsku: tłumaczenie z nazwą z profilu przechodzi ("CMR documentation" = "dokumenty CMR"), nowa nazwa nie', () => {
    const items = ['Microsoft Excel', 'TMS (Transport Management System)', 'TMS system', 'Transport Management System', 'CMR documentation', 'Route planning', 'English C1'];
    const c = cv({ language: 'en', skills: [{ category: 'Tools', items: [...items, 'SAP ERP', 'WMS'] }] });
    // "Transport Management System" zostaje ostrzeżeniem w edytorze, ale do modelu nie wraca.
    expect(unverifiedSkillItems(c, logistics, [excel, sap])).toEqual(['Transport Management System', 'SAP ERP', 'WMS']);
    expect(rejectedSkillItems(c, logistics, [excel, sap])).toEqual(['SAP ERP', 'WMS']);
    expect(skillIssues(c, logistics, [excel, sap]).map((i) => i.message).join('')).toContain('„SAP ERP”, „WMS”');
    expect(skillIssues(cv({ language: 'en', skills: [{ category: 'Tools', items }] }), logistics, [excel, sap])).toEqual([]);
  });

  it('CV po polsku: nazwa z profilu w innych słowach to tylko ostrzeżenie, nowa nazwa wraca do modelu', () => {
    const c = cv({ skills: [{ category: 'Narzędzia', items: ['Obsługa systemu TMS', 'Kampanie Google Ads', 'Excel zaawansowany'] }] });
    expect(unverifiedSkillItems(c, logistics, [excel])).toEqual(['Obsługa systemu TMS', 'Kampanie Google Ads', 'Excel zaawansowany']);
    expect(rejectedSkillItems(c, logistics, [excel])).toEqual(['Kampanie Google Ads']);
  });

  it('przy poprawie umiejętność, którą CV już miało, zostaje; nowa spoza profilu wraca do modelu', () => {
    const current = cv({ skills: [{ category: 'Narzędzia', items: ['Canva', 'Tableau'] }] });
    const schema = checkedImproveSchema(profile, 'pl', current, []);
    expect(schema.safeParse(current).success).toBe(true);
    const added = cv({ skills: [{ category: 'Narzędzia', items: ['Canva', 'Tableau', 'Power BI'] }] });
    const r = schema.safeParse(added);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('„Power BI”');
    expect(skillIssues(added, profile, [], ['Canva', 'Tableau', 'Power BI'])).toEqual([]);
  });
});

describe('tytuł CV', () => {
  // Jak pary 15 i 18 z evals/: kandydat bez Javy i kierowca z kat. B.
  const java: Keyword = { term: 'Java 17', synonyms: ['Java', 'JDK 17'], importance: 'must', category: 'umiejętność' };
  const python: Profile = { ...profile, headline: 'Junior Python Developer', skills: [{ id: 's1', name: 'Python', category: 'techniczne', level: '' }], extraFacts: [] };
  const ce: Keyword = { term: 'prawo jazdy kat. C+E', synonyms: ['C+E', 'kategoria C+E', 'prawo jazdy C+E'], importance: 'must', category: 'certyfikat' };
  const driving: Keyword = { term: 'doświadczenie kierowcy', synonyms: ['kierowca zawodowy'], importance: 'must', category: 'umiejętność' };
  const courier: Profile = { ...profile, headline: 'Kurier', skills: [{ id: 's1', name: 'Prawo jazdy kat. B', category: 'inne', level: '' }], extraFacts: [] };

  it('nazwa z ogłoszenia, której profil nie ma, i kategoria prawa jazdy to twierdzenie o kandydacie', () => {
    expect(unconfirmedHeadlineNames('Junior Java Developer', python, [java])).toEqual(['Java']);
    expect(unconfirmedHeadlineNames('Kierowca zawodowy kat. C+E', courier, [ce, driving])).toEqual(['kat. C+E']);
    expect(unconfirmedHeadlineNames('Kierowca kat. C', courier)).toEqual(['kat. C']);
    expect(unconfirmedHeadlineNames('Kierowca kat. B', courier)).toEqual([]);
    expect(unconfirmedHeadlineNames('Junior Python Developer', python, [java])).toEqual([]);
    // Odpowiedź "mam" potwierdza tak samo jak profil.
    const withJava = { ...python, extraFacts: [{ id: 'x1', topic: 'Java', has: true, answer: 'Kurs Javy i projekt na zaliczenie', source: '', date: '2026-11-01' }] };
    expect(unconfirmedHeadlineNames('Junior Java Developer', withJava, [java])).toEqual([]);
  });

  it('słowa o samym stanowisku nie są twierdzeniem: zostają bez sugestii', () => {
    const role: Keyword = { term: 'Logistics Coordinator', synonyms: [], importance: 'must', category: 'inne' };
    expect(unconfirmedHeadlineNames('Junior Logistics Coordinator', python, [role, driving])).toEqual([]);
    expect(unconfirmedHeadlineNames('Kierowca zawodowy w transporcie krajowym', courier, [driving])).toEqual([]);
    expect(unconfirmedHeadlineNames('Specjalista ds. HR', python)).toEqual([]);
  });

  it('wersja bezpieczna: bez niepotwierdzonej nazwy, a gdy zostaje jedno słowo, tytuł z profilu', () => {
    expect(safeHeadline('Junior Java Developer', ['Java'], python, 'pl', [java])).toBe('Junior Developer');
    expect(safeHeadline('Kierowca zawodowy kat. C+E', ['kat. C+E'], courier, 'pl', [ce])).toBe('Kierowca zawodowy');
    expect(safeHeadline('Kierowca zestawu ciągnik siodłowy z naczepą (kat. C+E)', ['kat. C+E'], courier, 'pl', [ce])).toBe('Kierowca zestawu ciągnik siodłowy z naczepą');
    expect(safeHeadline('Java Developer', ['Java'], python, 'pl', [java])).toBe('Junior Python Developer');
    // CV po angielsku nie dostaje polskiego tytułu z profilu.
    expect(safeHeadline('Java Developer', ['Java'], { ...python, headline: 'Młodszy programista' }, 'en', [java])).toBe('Developer');
  });

  it('groundCv: niepotwierdzony tytuł staje się żółtą sugestią, a w CV zostaje wersja bezpieczna', () => {
    const c = groundCv(cv({ headline: 'Junior Java Developer' }), python, { lang: 'pl', keywords: [java] });
    expect(c.headline).toBe('Junior Developer');
    expect(c.headlineSuggestion).toMatchObject({ id: 'headline', text: 'Junior Java Developer', status: 'suggested', fallbackText: 'Junior Developer' });
    expect(c.headlineSuggestion!.reason).toContain('Java');
    expect(groundCv(cv({ headline: 'Junior Python Developer' }), python, { lang: 'pl', keywords: [java] }).headlineSuggestion).toBeUndefined();
  });

  it('przy poprawie: niezmieniony tytuł zostaje z sugestią, przepisana sugestia nie przechodzi po cichu, nowy tytuł jest sprawdzany', () => {
    const current = groundCv(cv({ headline: 'Junior Java Developer' }), python, { lang: 'pl', keywords: [java] });
    const opts = { lang: 'pl' as const, keywords: [java], current };
    const same = groundCv(cv({ headline: current.headline }), python, opts);
    expect(same.headlineSuggestion).toEqual(current.headlineSuggestion);
    const copied = groundCv(cv({ headline: 'Junior Java Developer' }), python, opts);
    expect(copied.headline).toBe('Junior Developer');
    expect(copied.headlineSuggestion).toEqual(current.headlineSuggestion);
    const changed = groundCv(cv({ headline: 'Junior Backend Developer (Python)' }), python, opts);
    expect(changed.headline).toBe('Junior Backend Developer (Python)');
    expect(changed.headlineSuggestion).toBeUndefined();
    // Tytuł zaakceptowany przez kandydata (bez sugestii) nie wraca jako sugestia przy kolejnej poprawie.
    const accepted = { ...current, headline: 'Junior Java Developer', headlineSuggestion: undefined };
    expect(groundCv(cv({ headline: 'Junior Java Developer' }), python, { ...opts, current: accepted }).headlineSuggestion).toBeUndefined();
  });
});

describe('pozycje spoza profilu', () => {
  it('sourceId musi wskazywać pozycję profilu albo odpowiedź "mam" z extraFacts', () => {
    const c = cv({
      experience: [{ ...cv().experience[0], sourceId: 'zmyslone' }],
      projects: [
        { sourceId: 'x1', name: 'Kampania Google Ads', role: '', dates: '', technologies: [], link: '', bullets: [] },
        { sourceId: 'x2', name: 'Baza SQL', role: '', dates: '', technologies: [], link: '', bullets: [] },
        { sourceId: 'edu1', name: 'Praca dyplomowa', role: '', dates: '', technologies: [], link: '', bullets: [] },
      ],
    });
    expect(sourceIssues(c, profile).map((i) => i.path.join('.'))).toEqual(['experience.0.sourceId', 'projects.1.sourceId']);
    expect(sourceIssues(cv(), profile)).toEqual([]);
  });

  it('schemat z kontrolami odrzuca błędy z opisem dla modelu, a schemat JSON się nie zmienia', () => {
    const schema = checkedCvSchema(profile, 'pl');
    expect(schema.safeParse(cv()).success).toBe(true);
    const bad = schema.safeParse({ ...withBullets(text('Przygotowywałem raporty')), education: [{ ...cv().education[0], sourceId: '' }] });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('1. osobie („Przygotowywałem”)');
    expect(messages).toContain('sourceId ""');
    expect(z.toJSONSchema(schema)).toEqual(z.toJSONSchema(CvContentSchema));
  });
});

describe('daty i firma z profilu', () => {
  it('zapis dat jak w promptcie', () => {
    expect(cvDate('2025-07', 'pl')).toBe('07.2025');
    expect(cvDate('2025-7', 'en')).toBe('07/2025');
    expect(cvDate('7.2025', 'pl')).toBe('07.2025');
    expect(cvDate('2024', 'pl')).toBe('2024');
    expect(cvDate('', 'pl')).toBe('');
    expect(cvDate('2025-13', 'pl')).toBeNull();
    expect(cvDate('maj 2024', 'pl')).toBeNull();

    expect(cvDateRange('2025-07', '2025-09', false, 'pl')).toBe('07.2025 - 09.2025');
    expect(cvDateRange('2024-03', '', true, 'pl')).toBe('03.2024 - obecnie');
    expect(cvDateRange('2024-03', '2024-05', true, 'en')).toBe('03/2024 - present');
    expect(cvDateRange('2022', '', false, 'pl')).toBe('2022');
    expect(cvDateRange('', '2024-06', false, 'en')).toBe('06/2024');
    expect(cvDateRange('', '', false, 'pl')).toBe('');
    expect(cvDateRange('lato 2022', '', false, 'pl')).toBeNull();
  });

  it('firma i daty doświadczenia oraz daty edukacji pochodzą z profilu', () => {
    const c = cv({
      experience: [
        { ...cv().experience[0], company: 'Wymyślona Firma', dates: '01.2020 - 12.2025' },
        { sourceId: 'exp3', role: 'Pomoc', company: 'Coś', location: '', dates: '07.2022 - 08.2022', bullets: [] },
        { sourceId: 'x1', role: 'Kampania', company: 'Koło naukowe', location: '', dates: '2025', bullets: [] },
      ],
    });
    const out = groundCv(c, profile, { lang: 'pl' });
    expect(out.experience[0]).toMatchObject({ company: 'Firma Testowa Sp. z o.o.', dates: '07.2025 - 09.2025', role: 'Stażysta ds. marketingu' });
    // Data w profilu w nietypowym zapisie: zostaje wersja modelu, ale firma i tak z profilu.
    expect(out.experience[1]).toMatchObject({ company: '', dates: '07.2022 - 08.2022' });
    // Wpis z odpowiedzi kandydata (extraFacts) nie ma firmy ani dat w profilu - bez zmian.
    expect(out.experience[2]).toMatchObject({ company: 'Koło naukowe', dates: '2025' });
    expect(out.education[0].dates).toBe('10.2023 - obecnie');
    expect(groundCv(c, profile, { lang: 'en' }).education[0].dates).toBe('10/2023 - present');
    expect(c.experience[0].company).toBe('Wymyślona Firma'); // wejście bez zmian
  });

  it('daty przechodzą kontrolę spójnego formatu z raportu ATS', () => {
    const DATE_PARTS = [/^\d{2}\.\d{4}$/, /^\d{4}$/, /^obecnie$/];
    const out = groundCv(cv({ experience: [cv().experience[0], { sourceId: 'exp2', role: 'Kelner', company: '', location: '', dates: '', bullets: [] }] }), profile, { lang: 'pl' });
    const parts = [...out.experience, ...out.education].flatMap((e) => e.dates.split(/\s*[–-]\s*/)).filter(Boolean);
    expect(parts).toEqual(['07.2025', '09.2025', '03.2024', 'obecnie', '10.2023', 'obecnie']);
    expect(parts.every((p) => DATE_PARTS.some((r) => r.test(p)))).toBe(true);
  });
});

describe('liczby spoza profilu', () => {
  const known = knownNumbers(['Google Analytics 4', '2023-05', 'średnia 4,5', 'Obsługa 1 200 klientów']);

  it('zbiera liczby z profilu razem z cyframi w nazwach', () => {
    expect([...known].sort()).toEqual(['1', '1200', '200', '2023', '4', '4.5', '5'].sort());
    const find = numberFinder(known);
    expect(find('Raporty w GA4 i Google Analytics 4').map((h) => h.token)).toEqual([]);
    expect(find('Obsługa 1 200 klientów, średnia 4,5').map((h) => h.token)).toEqual([]);
    expect(find(`Obsługa 1${String.fromCharCode(160)}200 klientów i 1.200 zgłoszeń`).map((h) => h.token)).toEqual([]); // twarda spacja, kropka tysięcy
    expect(find('Obsługa 1300 klientów, średnia 4,8, 12.05.2023').map((h) => h.token)).toEqual(['1300', '4,8', '12.05.2023']);
    // Nazwy z liczbą, tokeny maskowania i kody (B2B) to nie ilości.
    expect(numberFinder(new Set(), ['Office 365'])('Praca w Office 365 i B2B dla <FIRMA_1>')).toEqual([]);
  });

  it('wersja bez liczby, gdy da się ją prosto uzyskać', () => {
    const find = numberFinder(new Set());
    const cases: [string, string][] = [
      ['Zwiększenie zasięgu profilu o 30% dzięki kampanii', 'Zwiększenie zasięgu profilu dzięki kampanii'],
      ['Wzrost sprzedaży o 15%.', 'Wzrost sprzedaży.'],
      ['Zwiększenie budżetu o 2 tys. zł', 'Zwiększenie budżetu'],
      ['Prowadzenie profilu na Instagramie, co zwiększyło zasięg o 40%', 'Prowadzenie profilu na Instagramie'],
      ['Kampania (ok. 30 osób) w social media', 'Kampania w social media'],
      ['Obsługa ponad 200 klientów dziennie', 'Obsługa klientów dziennie'],
      ['Obsługa 200+ klientów, analiza 15 kampanii, raporty', 'Obsługa klientów, raporty'],
      ['Student marketingu. Prowadzenie 3 projektów. Znajomość GA4.', 'Student marketingu. Znajomość GA4.'],
      // Bez liczby zdanie by się rozsypało albo zmieniło sens - wersji bezpiecznej nie ma.
      ['Szkolenia 2 razy w tygodniu', ''],
      ['Student 3. roku informatyki', ''],
      ['Powiększenie zespołu o 5 osób', ''],
      ['Obsługa do 50 osób', ''],
      ['Praca przy 12.05.2023', ''],
      ['30% wzrost sprzedaży', ''],
      ['Managed a team of 4 people', ''],
    ];
    for (const [input, expected] of cases) expect([input, withoutNumbers(input, find)]).toEqual([input, expected]);
  });

  it('fakt z liczbą spoza profilu staje się sugestią z wersją bez liczby', () => {
    const out = groundCv(
      withBullets(
        text('Obsługa 40 zgłoszeń dziennie'),
        text('Obsługa 120 zgłoszeń klientów'),
        text('Kampania z budżetem 500 zł'),
        text('Znajomość SQL (35 godzin zajęć)'),
        text('Zwiększenie zasięgu profilu o 30%'),
      ),
      profile,
      { lang: 'pl' },
    );
    const [b40, b120, b500, b35, b30] = out.experience[0].bullets;
    expect(b40).toMatchObject({ status: 'suggested', reason: 'Liczba spoza profilu (40) - potwierdź albo odrzuć.', fallbackText: 'Obsługa zgłoszeń dziennie' });
    expect(b120.status).toBe('fact');
    expect(b500.status).toBe('fact'); // z odpowiedzi kandydata (has=true)
    expect(b35).toMatchObject({ status: 'suggested', fallbackText: 'Znajomość SQL' }); // odpowiedź "nie mam" niczego nie potwierdza
    expect(b30).toMatchObject({ status: 'suggested', reason: 'Liczba spoza profilu (30%) - potwierdź albo odrzuć.', fallbackText: 'Zwiększenie zasięgu profilu' });
  });

  it('podsumowanie traci tylko zdanie z liczbą, a powód jest w języku interfejsu', () => {
    const c = cv({ summary: text('Student marketingu z doświadczeniem w social media. Prowadzenie 8 kampanii.') });
    expect(groundCv(c, profile, { lang: 'pl' }).summary).toMatchObject({ status: 'suggested', fallbackText: 'Student marketingu z doświadczeniem w social media.' });
    const en = withLang('en', () => groundCv(c, profile, { lang: 'pl' }));
    expect(en.summary.reason).toBe('A number that is not in your profile (8). Confirm or reject it.');
  });

  it('potwierdzone liczby i nazwy z liczbą zostają faktami', () => {
    const c = withBullets(text('Obsługa 40 zgłoszeń dziennie'), text('Raporty w Office 365'));
    const out = groundCv(c, profile, { lang: 'pl', confirmed: ['Obsługa 40 zgłoszeń dziennie'], names: ['Office 365'] });
    expect(out.experience[0].bullets.map((b) => b.status)).toEqual(['fact', 'fact']);
    expect(groundCv(c, profile, { lang: 'pl' }).experience[0].bullets[1].status).toBe('suggested');
  });

  it('sugestia modelu dostaje bezpieczną wersję bez zmyślonej liczby', () => {
    const s = text('Kierowanie pracą 15 wolontariuszy', { status: 'suggested', reason: 'Silniejsza rola', fallbackText: 'Koordynacja pracy 15 wolontariuszy' });
    const ok = text('Kierowanie zespołem', { status: 'suggested', reason: 'Silniejsza rola', fallbackText: 'Współpraca z zespołem' });
    const [b1, b2] = groundCv(withBullets(s, ok), profile, { lang: 'pl' }).experience[0].bullets;
    expect(b1).toMatchObject({ status: 'suggested', reason: 'Silniejsza rola', text: 'Kierowanie pracą 15 wolontariuszy', fallbackText: 'Koordynacja pracy wolontariuszy' });
    expect(b2).toEqual(ok);
  });
});

describe('słowa kluczowe przy poprawie', () => {
  const keywords: Keyword[] = [
    { term: 'Instagram', synonyms: [], importance: 'must', category: 'narzędzie' },
    { term: 'social media', synonyms: ['media społecznościowe'], importance: 'must', category: 'umiejętność' },
    { term: 'Google Ads', synonyms: [], importance: 'nice', category: 'narzędzie' },
  ];
  const current = cv(); // Instagram w punkcie, social media w podsumowaniu, Google Ads brak

  it('przeniesione albo innym synonimem: w porządku; usunięte: wraca do modelu', () => {
    const moved = cv({ summary: text('Student marketingu, media społecznościowe i Instagram.'), experience: [{ ...cv().experience[0], bullets: [] }] });
    expect(lostKeywordIssues(moved, current, keywords)).toEqual([]);
    const lost = withBullets(text('Prowadzenie profilu firmy'));
    const issues = lostKeywordIssues(lost, current, keywords);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Brakuje słowa kluczowego „Instagram”, które było w obecnym CV (sekcje: experience)');
  });

  it('fraza z jednym słowem w środku liczy się jak w raporcie: można ją przeredagować, ale nie zgubić', () => {
    const erp: Keyword[] = [{ term: 'wdrażanie ERP', synonyms: [], importance: 'must', category: 'umiejętność' }];
    const before = cv({ summary: text('Zajmuję się wdrażaniem systemów ERP.') });
    expect(lostKeywordIssues(cv({ summary: text('Zajmuję się wdrażaniem modułów ERP.') }), before, erp)).toEqual([]);
    expect(lostKeywordIssues(cv({ summary: text('Zajmuję się planowaniem dostaw.') }), before, erp)).toHaveLength(1);
  });

  it('schemat poprawy zgłasza zgubione słowo jak inne błędy', () => {
    const lost = withBullets(text('Prowadzenie profilu firmy'));
    const r = checkedImproveSchema(profile, 'pl', current, keywords).safeParse(lost);
    expect(r.success).toBe(false);
    expect(z.prettifyError(r.error!)).toContain('„Instagram”');
    expect(checkedImproveSchema(profile, 'pl', current, keywords).safeParse(current).success).toBe(true);
  });
});

describe('wykształcenie zostaje w CV', () => {
  it('brak szkoły z profilu (np. technikum) wraca do poprawki, komplet przechodzi', async () => {
    const { educationIssues } = await import('../server/llm/prompts/cvChecks');
    const { cv: fixtureCv, profile: fixtureProfile } = await import('./fixtures');
    const withTechnikum = {
      ...fixtureProfile,
      education: [
        ...fixtureProfile.education,
        { id: 'edu2', school: 'Technikum nr 1', degree: 'technik', field: 'Technik informatyk', start: '2019-09', end: '2023-06', current: false, details: '' },
      ],
    };
    const issues = educationIssues(fixtureCv.content, withTechnikum);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Technikum nr 1');
    expect(educationIssues(fixtureCv.content, fixtureProfile)).toEqual([]);
  });
});
