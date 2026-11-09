import { describe, expect, it } from 'vitest';
import type { AiReview, AtsReport, CvContent, CvText, CvVersion, JobPosting, Keyword, Profile } from '../shared/schemas';
import { aliasVariants } from '../server/ats/keywords';
import { notWorse } from '../server/ats/score';
import { aiItemIds, hasWork, improveOptions, improvePlan, nothingToImprove, planForPrompt, profileSources, selectPlan, titleCore } from '../server/llm/prompts/improvePlan';
import { unverifiedSkills } from '../server/services';
import { withLang } from '../server/i18n';
import { blankContent } from './fixtures';

// Fikcyjna osoba i ogłoszenie - tylko do testów.
const profile: Profile = {
  id: 'p1', displayName: 'Test', createdAt: '', updatedAt: '', apiKey: '', photo: '', files: [],
  contact: { fullName: 'Ola Testowa', email: 'ola@example.com', phone: '+48 600 700 800', location: 'Kraków', links: [] },
  headline: '', summary: '',
  experience: [
    {
      id: 'exp1', kind: 'staż', role: 'Stażystka ds. sprzedaży', company: 'Firma Test', location: 'Kraków', start: '2025-07', end: '2025-09', current: false,
      description: 'Raporty sprzedaży w Excelu z użyciem WYSZUKAJ.PIONOWO', achievements: ['Przygotowywanie tabel przestawnych dla działu handlowego'],
    },
  ],
  education: [{ id: 'edu1', school: 'Uniwersytet Testowy', degree: 'licencjat', field: 'Finanse', start: '2023-10', end: '', current: true, details: '' }],
  projects: [],
  skills: [
    { id: 's1', name: 'MS Excel', category: 'narzędzia', level: '' },
    { id: 's2', name: 'Power BI', category: 'narzędzia', level: '' },
    { id: 's3', name: 'Komunikatywność', category: 'miękkie', level: '' },
  ],
  languages: [{ id: 'l1', name: 'Angielski', level: 'B2' }],
  certificates: [],
  interests: [],
  extraFacts: [
    { id: 'x1', topic: 'SQL', has: true, answer: 'Zapytania SELECT na zajęciach z baz danych', source: '', date: '' },
    { id: 'x2', topic: 'Python', has: false, answer: 'Nie znam', source: '', date: '' },
    { id: 'x3', topic: 'Jira', has: true, answer: 'Tak', source: '', date: '' },
  ],
};

const kw = (term: string, importance: Keyword['importance'], category: Keyword['category'] = 'narzędzie', synonyms: string[] = []): Keyword => ({ term, synonyms, importance, category });

const posting: JobPosting = {
  title: 'Junior Sales Analyst', company: 'Przykład S.A.', location: 'Kraków', workMode: 'hybrydowo', seniority: 'junior', industry: 'sprzedaż',
  language: 'en', cvLanguageRequired: 'en', companyIsInternational: true, summary: '', responsibilities: [], requirementsMust: [], requirementsNice: [], benefits: [],
  keywords: [
    kw('Excel', 'must', 'narzędzie', ['MS Excel']),
    kw('VLOOKUP', 'must'),
    kw('Power BI', 'must'),
    kw('SQL', 'nice'),
    kw('Python', 'must'),
    kw('Tableau', 'nice'),
    kw('Jira', 'nice'),
    kw('komunikatywność', 'must', 'kompetencja miękka', ['communication skills']),
  ],
  rodoClause: '', mentionsFutureRecruitment: false, photoPreference: 'unspecified', coverLetterRequired: false, applicationNotes: '',
};

const fact = (text: string, id = 'b1'): CvText => ({ id, text, status: 'fact', reason: '', fallbackText: '', sourceIds: [] });

const cvContent = (patch: Partial<CvContent> = {}): CvContent => ({
  ...blankContent,
  language: 'en',
  headline: 'Junior Sales Analyst',
  summary: fact('Finance student with Excel reporting experience.', 's'),
  experience: [{ sourceId: 'exp1', role: 'Sales Intern', company: 'Firma Test', location: 'Kraków', dates: '07/2025 – 09/2025', bullets: [fact('Prepared weekly sales reports')] }],
  education: [{ sourceId: 'edu1', school: 'Uniwersytet Testowy', degree: 'Bachelor', field: 'Finance', dates: '10/2023 – present', details: '' }],
  skills: [{ category: 'Tools', items: ['Excel', 'Power BI', 'SQL'] }],
  ...patch,
});

const review = (scores: Partial<Record<AiReview['criteria'][number]['key'], number>>, fixes: AiReview['fixes'] = []): AiReview => ({
  criteria: (['must_have_match', 'achievements', 'summary_fit', 'clarity', 'red_flags'] as const).map((key) => ({ key, score: scores[key] ?? 8, comment: `Komentarz ${key}` })),
  strengths: [], weaknesses: [], fixes, wouldInterview: 'raczej tak', verdict: '',
});

const report = (ai: AiReview | null, pages = 1, total: number | null = 70): AtsReport => ({
  createdAt: '', version: 1, total: ai ? total : null,
  keywords: { score: 20, max: 40, matched: [], missing: [], stuffing: [] },
  format: { score: 20, max: 20, pages, checks: [] },
  ai: ai ? { score: 28, max: 40, review: ai } : null,
  aiError: '',
});

const fixes: AiReview['fixes'] = [
  { section: 'summary', find: 'Finance student', replace: 'Finance student targeting sales analysis', why: 'Nazwa stanowiska.', needsUserInput: false },
  { section: 'experience', find: '', replace: 'Przygotowywanie N raportów tygodniowo', why: 'Ile raportów tygodniowo przygotowujesz? Dopisz to w profilu.', needsUserInput: true },
];

describe('plan poprawy CV', () => {
  const plan = improvePlan(report(review({ must_have_match: 6, achievements: 5, clarity: 6 }, fixes), 2), profile, posting, cvContent());
  const addable = (term: string) => plan.addable.find((a) => a.term === term);

  it('słowo, którego brak w CV, a profil je potwierdza (także pod polską nazwą), z brzmieniem i miejscem z profilu', () => {
    expect(addable('VLOOKUP')).toMatchObject({
      status: 'missing',
      inCv: [],
      profileWording: 'WYSZUKAJ.PIONOWO',
      profileText: 'Raporty sprzedaży w Excelu z użyciem WYSZUKAJ.PIONOWO',
      where: 'doświadczenie „Stażystka ds. sprzedaży, Firma Test” (id exp1)',
    });
    expect(addable('VLOOKUP')?.todo).toContain('w treści');
  });

  it('słowo tylko na liście umiejętności: przenieść do punktu, gdy profil ma dowód (odpowiedź z extraFacts)', () => {
    expect(addable('SQL')).toMatchObject({ status: 'listOnly', inCv: ['skills'], profileText: 'SQL: Zapytania SELECT na zajęciach z baz danych' });
    expect(addable('SQL')?.todo).toContain('przenieś je do punktu');
  });

  it('samo "tak" w extraFacts pozwala tylko dopisać słowo do listy umiejętności', () => {
    expect(addable('Jira')).toMatchObject({ status: 'missing', profileWording: 'Jira' });
    expect(addable('Jira')?.todo).toContain('sekcji umiejętności');
  });

  it('bez potwierdzenia w profilu nic nie dopisujemy; wymagane trafiają do pytań', () => {
    expect(plan.addable.map((a) => a.term).sort()).toEqual(['Jira', 'SQL', 'VLOOKUP']);
    expect(plan.needsInput).toEqual([
      '„Power BI”: w profilu jest tylko na liście umiejętności. Dopisz, gdzie tego używasz (np. w opisie stażu albo projektu), a CV pokaże to jako dowód.',
      '„Python” (wymagane w ogłoszeniu): jeśli to znasz, dopisz w profilu, gdzie i jak tego używasz.', // has=false nic nie potwierdza
      '„komunikatywność”: dopisz w profilu przykład z pracy albo projektu, który to pokazuje.',
      'Ile raportów tygodniowo przygotowujesz? Dopisz to w profilu.',
    ]);
    expect(plan.keep).toEqual(['Excel', 'Power BI', 'SQL']);
  });

  it('tytuł stanowiska (także bez "Junior" i "(K/M)") nie trafia do pytań ani do planu', () => {
    const withTitle = { ...posting, title: 'Junior Sales Analyst (K/M)', keywords: [...posting.keywords, kw('Sales Analyst', 'must', 'inne')] };
    const p = improvePlan(report(review({})), profile, withTitle, cvContent());
    expect(p.needsInput.join(' ')).not.toContain('Sales Analyst');
    expect(p.addable.map((a) => a.term)).not.toContain('Sales Analyst');
    expect(titleCore('Młodszy Analityk Danych Marketingowych (K/M)')).toBe(titleCore('analityk danych marketingowych'));
    expect(titleCore('Power BI Developer')).not.toBe(titleCore('Power BI'));
  });

  it('poprawki bez danych od kandydata, kryteria poniżej 7 bez "achievements" i format', () => {
    expect(plan.fixes.map(({ id, ...f }) => f)).toEqual([{ section: 'summary', find: 'Finance student', replace: 'Finance student targeting sales analysis', why: 'Nazwa stanowiska.' }]);
    expect(plan.fixes[0].id).toMatch(/^fix:[0-9a-f]{10}$/);
    expect(plan.criteria.map((c) => [c.key, c.score, c.comment])).toEqual([
      ['must_have_match', 6, 'Komentarz must_have_match'],
      ['clarity', 6, 'Komentarz clarity'],
    ]);
    expect(plan.criteria.every((c) => c.goal.length > 20)).toBe(true);
    expect(plan.format).toEqual([{ id: 'pages', text: 'CV ma 2 strony: skróć je do jednej strony (skróć albo usuń najmniej trafne punkty).' }]);
    expect(hasWork(plan)).toBe(true);
  });

  it('wybór kandydata: do AI idzie tylko to, co zaznaczył, bez formatu; lista do wyboru w języku interfejsu', () => {
    const fixId = plan.fixes[0].id;
    expect([...aiItemIds(plan)].sort()).toEqual(['crit:clarity', 'crit:must_have_match', fixId, 'kw:Jira', 'kw:SQL', 'kw:VLOOKUP'].sort());
    const chosen = selectPlan(plan, ['kw:SQL', fixId, 'pages']);
    expect(chosen.addable.map((a) => a.term)).toEqual(['SQL']);
    expect(chosen.fixes.map((f) => f.id)).toEqual([fixId]);
    expect(chosen.criteria).toEqual([]);
    expect(chosen.format).toEqual([]);
    expect(chosen.keep).toEqual(plan.keep);
    expect(hasWork(selectPlan(plan, []))).toBe(false);

    const options = improveOptions(plan, 'pl');
    expect(options.map((o) => o.id)).toEqual([fixId, 'kw:VLOOKUP', 'kw:SQL', 'kw:Jira', 'crit:must_have_match', 'crit:clarity']);
    expect(options[0]).toMatchObject({ kind: 'fix', title: 'summary', find: 'Finance student', replace: 'Finance student targeting sales analysis', detail: 'Nazwa stanowiska.' });
    expect(options.find((o) => o.id === 'kw:SQL')).toMatchObject({ kind: 'keyword', title: 'Słowo kluczowe „SQL”' });
    expect(options.find((o) => o.id === 'kw:SQL')?.detail).toContain('Jest tylko na liście umiejętności');
    expect(options.find((o) => o.id === 'kw:Jira')?.detail).toContain('do listy umiejętności');
    expect(withLang('en', () => improveOptions(plan, 'en'))[1].title).toBe('Keyword "VLOOKUP"');
    // Odpowiedź kandydata na inną poprawkę nie zmienia id tej poprawki.
    const answered: Profile = { ...profile, extraFacts: [{ id: 'f', topic: 'Ile raportów tygodniowo przygotowujesz? Dopisz to w profilu.', has: true, answer: '5 raportów', source: '', date: '' }] };
    const again = improvePlan(report(review({ must_have_match: 6, achievements: 5, clarity: 6 }, fixes), 2), answered, posting, cvContent());
    expect(again.fixes[0].id).toBe(fixId);
  });

  it('poprawka "wymaga Twoich danych" z odpowiedzią kandydata w profilu idzie do AI razem z tą odpowiedzią', () => {
    const answered: Profile = {
      ...profile,
      extraFacts: [{ id: 'gap-a1-x', topic: 'Ile raportów tygodniowo przygotowujesz? Dopisz to w profilu.', has: true, answer: '5 raportów sprzedaży tygodniowo', source: '', date: '' }],
    };
    const p = improvePlan(report(review({ must_have_match: 8, achievements: 8, clarity: 8 }, fixes)), answered, posting, cvContent());
    expect(p.fixes.map((f) => f.section)).toEqual(['summary', 'experience']);
    expect(p.fixes[1].userData).toContain('5 raportów sprzedaży tygodniowo');
    expect(p.needsInput.some((q) => q.startsWith('Ile raportów'))).toBe(false);
  });

  it('pytanie wymieniające kilka narzędzi potwierdza tylko te, które są w odpowiedzi kandydata', () => {
    const asked: Profile = {
      ...profile,
      extraFacts: [
        { id: 'g1', topic: 'Doświadczenie w tworzeniu automatyzacji w narzędziach typu Make, n8n, Zapier lub Power Automate', has: true, answer: 'Tworzyłem automatyzacje w n8n do własnych projektów', source: '', date: '' },
        { id: 'g2', topic: 'komunikatywność', has: true, answer: 'Rozmowy z klientami w handlu', source: '', date: '' },
      ],
    };
    const p = improvePlan(report(null), asked, { ...posting, keywords: [kw('n8n', 'must'), kw('Zapier', 'must'), kw('komunikatywność', 'must', 'kompetencja miękka')] }, cvContent());
    expect(p.addable.map((a) => a.term).sort()).toEqual(['komunikatywność', 'n8n']);
  });

  it('dla modelu: bez pytań do kandydata, z listą słów do zachowania', () => {
    const p = planForPrompt(plan);
    expect(p).not.toHaveProperty('needsInput');
    expect(p.keepKeywords).toEqual(['Excel', 'Power BI', 'SQL']);
    expect(p.addable).toHaveLength(3);
  });

  it('niespójne daty, upychanie słów i brak telefonu', () => {
    const c = cvContent({
      summary: fact('Excel Excel Excel Excel Excel Excel reporting.', 's'),
      projects: [{ sourceId: 'x', name: 'Raport', role: '', dates: '2024/05', technologies: [], link: '', bullets: [] }],
    });
    const p = improvePlan(report(null), { ...profile, contact: { ...profile.contact, phone: '' } }, posting, c);
    expect(p.format).toEqual([{ id: 'dates', text: 'Daty są w różnych formatach: zapisz wszystkie w jednym formacie (po polsku MM.RRRR, po angielsku MM/YYYY).' }]);
    expect(p.stuffed).toEqual(['Excel']);
    expect(improveOptions(p, 'en').map((o) => o.id)).toEqual(expect.arrayContaining(['stuffed', 'dates']));
    expect(p.needsInput).toContain('Brak telefonu w profilu (albo jest niepełny).');
  });

  it('nic do zrobienia: bez wywołania AI, z listą tego, co kandydat może dopisać', () => {
    const only = { ...posting, keywords: [kw('Excel', 'must', 'narzędzie', ['MS Excel']), kw('Python', 'must')] };
    const p = improvePlan(report(review({ achievements: 4 })), profile, only, cvContent());
    expect(hasWork(p)).toBe(false);
    // Bez pytań od rekrutera pytamy o efekty, bo "achievements" nie da się podnieść bez nowych faktów.
    expect(p.needsInput).toEqual([
      '„Python” (wymagane w ogłoszeniu): jeśli to znasz, dopisz w profilu, gdzie i jak tego używasz.',
      'Konkretne efekty: dopisz w profilu wyniki swojej pracy (liczby, skala, co powstało), jeśli je znasz.',
    ]);
    expect(nothingToImprove(p).split('\n')).toEqual([
      'Bez nowych informacji AI nie poprawi już tego CV, więc nowa wersja nie powstała. Możesz dopisać w profilu:',
      '- „Python” (wymagane w ogłoszeniu): jeśli to znasz, dopisz w profilu, gdzie i jak tego używasz.',
      '- Konkretne efekty: dopisz w profilu wyniki swojej pracy (liczby, skala, co powstało), jeśli je znasz.',
    ]);
    const empty = improvePlan(report(review({})), profile, { ...posting, keywords: [kw('Excel', 'must')] }, cvContent());
    expect(hasWork(empty)).toBe(false);
    expect(nothingToImprove(empty)).toBe('Raport nie wskazuje niczego, co AI mogłoby jeszcze poprawić, więc nowa wersja nie powstała.');
    expect(withLang('en', () => nothingToImprove(p))).toContain('You can add this to your profile:');
  });

  it('źródła profilu: opis i osiągnięcia to dowód, lista umiejętności tylko wymienienie, "nie mam" się nie liczy', () => {
    const src = profileSources(profile);
    expect(src.find((s) => s.text === 'Przygotowywanie tabel przestawnych dla działu handlowego')).toMatchObject({ credit: 1, bullet: true, where: 'experience' });
    expect(src.find((s) => s.text === 'Power BI')).toMatchObject({ credit: 0.5, bullet: false, where: 'skills' });
    expect(src.some((s) => s.text.includes('Python'))).toBe(false);
  });
});

describe('odpowiedniki nazw (PL/EN, MS/Microsoft)', () => {
  it('funkcje Excela i tabele przestawne w obie strony', () => {
    expect(aliasVariants('VLOOKUP')).toContain('WYSZUKAJ.PIONOWO');
    expect(aliasVariants('WYSZUKAJ.PIONOWO')).toContain('VLOOKUP');
    expect(aliasVariants('X.WYSZUKAJ')).toContain('XLOOKUP');
    expect(aliasVariants('SUMA.JEŻELI')).toEqual(['SUMA.JEŻELI', 'SUMIF']);
    expect(aliasVariants('Pivot Tables')).toContain('tabele przestawne');
    expect(aliasVariants('tabele przestawne')).toContain('pivot tables');
    expect(aliasVariants('funkcja JEŻELI')).toContain('funkcja if');
  });

  it('MS X = Microsoft X = X, ale bez samej liczby; lista z separatorami tylko MS/Microsoft', () => {
    expect(aliasVariants('Microsoft Excel')).toEqual(['Microsoft Excel', 'MS Excel', 'Excel']);
    expect(aliasVariants('MS Word')).toEqual(['MS Word', 'Microsoft Word', 'Word']);
    expect(aliasVariants('Microsoft 365')).toEqual(['Microsoft 365', 'MS 365']);
    expect(aliasVariants('Excel, VLOOKUP')).toEqual(['Excel, VLOOKUP']);
    expect(aliasVariants('Google Ads')).toEqual(['Google Ads']);
  });
});

describe('która wersja zostaje po poprawie', () => {
  const r = (total: number | null, kwScore = 20, withAi = total !== null): AtsReport => ({
    ...report(withAi ? review({}) : null, 1, total),
    keywords: { score: kwScore, max: 40, matched: [], missing: [], stuffing: [] },
  });

  it('pełne wyniki: nowa zostaje, gdy nie jest gorsza', () => {
    expect(notWorse(r(70), r(65))).toBe(true);
    expect(notWorse(r(65), r(65))).toBe(true);
    expect(notWorse(r(60), r(65))).toBe(false);
  });

  it('pełna ocena wygrywa z niepełną; dwie niepełne: słowa kluczowe i format', () => {
    expect(notWorse(r(null), r(65))).toBe(false);
    expect(notWorse(r(40), r(null))).toBe(true);
    expect(notWorse(r(null, 25), r(null, 20))).toBe(true);
    expect(notWorse(r(null, 15), r(null, 20))).toBe(false);
    // Starszy raport bez AI z przeskalowanym wynikiem liczy się jako niepełny.
    expect(notWorse(r(40), { ...r(null), total: 90 })).toBe(true);
  });
});

describe('umiejętności spoza profilu', () => {
  const version = (items: string[], language: 'pl' | 'en'): CvVersion => ({
    version: 1, createdAt: '', updatedAt: '', origin: 'generated', template: 'modern', photo: false, photoReason: '', decisions: {},
    rodo: { include: false, text: '', reason: '' },
    content: { ...blankContent, language, skills: [{ category: 'Tools', items }] },
  });

  it('CV po angielsku z polskiego profilu: VLOOKUP, Pivot Tables i Microsoft Excel to nie alarm', () => {
    expect(unverifiedSkills(version(['VLOOKUP', 'Pivot Tables', 'Microsoft Excel', 'Power Query'], 'en'), profile)).toEqual(['Power Query']);
  });

  it('CV po polsku: "Microsoft Excel" przy "MS Excel" w profilu to nie alarm', () => {
    expect(unverifiedSkills(version(['Microsoft Excel', 'Tableau'], 'pl'), profile)).toEqual(['Tableau']);
  });

  it('odpowiedniki z ogłoszenia: term i synonimy słowa kluczowego, którym jest pozycja', () => {
    const withData = { ...profile, experience: [{ ...profile.experience[0], description: 'Analiza danych sprzedażowych' }] };
    const job = { ...posting, keywords: [kw('analiza danych', 'must', 'umiejętność', ['data analysis'])] };
    expect(unverifiedSkills(version(['Data Analysis'], 'en'), withData)).toEqual(['Data Analysis']);
    expect(unverifiedSkills(version(['Data Analysis'], 'en'), withData, job)).toEqual([]);
  });
});
