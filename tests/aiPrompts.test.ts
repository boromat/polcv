import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiReview, AtsReport, CvContent, JobPosting, Keyword, Profile } from '../shared/schemas';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-ai-'));
process.env.CV_DATA_DIR = dir;

const { callJson } = await import('../server/llm/openrouter');
const { evaluateCv, reviewProblems } = await import('../server/llm/prompts/evaluateCv');
const { generateCv, improveCv } = await import('../server/llm/prompts/generateCv');
const { parsePosting, withoutLevel, withoutLevels } = await import('../server/llm/prompts/parsePosting');
const store = await import('../server/storage/store');

type Reply = { content: string; finish?: string };
let replies: Reply[] = [];
const sent: any[] = [];

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    const r = replies.shift()!;
    const body = { model: 'test/model', choices: [{ message: { content: r.content }, finish_reason: r.finish ?? 'stop' }], usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 } };
    return new Response(JSON.stringify(body));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  replies = [];
  sent.length = 0;
});

const ctx = { profileId: '', task: 'test' };
const lastUserMessage = (i: number) => sent[i].messages.at(-1).content as string;

// Fikcyjna osoba i ogłoszenie - tylko do testów.
const profile: Profile = {
  id: 'p1', displayName: 'Test', createdAt: '', updatedAt: '', apiKey: '', photo: '', files: [],
  contact: { fullName: 'Jan Testowy', email: 'jan@example.com', phone: '', location: 'Kraków', links: [] },
  headline: '', summary: '',
  experience: [
    { id: 'exp1', kind: 'staż', role: 'Stażysta ds. marketingu', company: 'Firma Testowa Sp. z o.o.', location: 'Kraków', start: '2025-07', end: '2025-09', current: false, description: '', achievements: ['Przygotowywałem raporty z kampanii'] },
  ],
  education: [{ id: 'edu1', school: 'Uniwersytet Testowy', degree: 'licencjat', field: 'Marketing', start: '2023-10', end: '', current: true, details: '' }],
  projects: [], skills: [], languages: [], certificates: [], interests: [], extraFacts: [],
};

const posting: JobPosting = {
  title: 'Młodszy specjalista ds. marketingu', company: 'Przykład S.A.', location: 'Kraków', workMode: 'hybrydowo', seniority: 'junior', industry: 'marketing',
  language: 'pl', cvLanguageRequired: 'any', companyIsInternational: false, summary: '', responsibilities: [], requirementsMust: [], requirementsNice: [], benefits: [],
  keywords: [{ term: 'angielski B2', synonyms: ['English B2', 'język angielski'], importance: 'must', category: 'język' }],
  rodoClause: '', mentionsFutureRecruitment: false, photoPreference: 'unspecified', coverLetterRequired: false, applicationNotes: '',
};

const bullet = (text: string) => ({ id: 'b1', text, status: 'fact' as const, reason: '', fallbackText: '', sourceIds: ['exp1'] });

const content = (bullets: string[], dates = '01.2020 – 12.2025'): CvContent => ({
  language: 'pl',
  headline: 'Młodszy specjalista ds. marketingu',
  summary: { id: 's1', text: 'Student marketingu.', status: 'fact', reason: '', fallbackText: '', sourceIds: [] },
  sectionOrder: ['summary', 'experience', 'education'],
  experience: [{ sourceId: 'exp1', role: 'Stażysta ds. marketingu', company: 'Firma', location: 'Kraków', dates, bullets: bullets.map(bullet) }],
  projects: [],
  education: [{ sourceId: 'edu1', school: 'Uniwersytet Testowy', degree: 'licencjat', field: 'Marketing', dates: '2023', details: '' }],
  skills: [], certificates: [], languages: [], interests: [], notes: '',
});

const review = (criteria: [string, number][]): AiReview => ({
  criteria: criteria.map(([key, score]) => ({ key: key as AiReview['criteria'][number]['key'], score, comment: 'OK' })),
  strengths: ['A'], weaknesses: ['B'], fixes: [], wouldInterview: 'raczej tak', verdict: 'Dobre CV, brakuje efektów.}',
});
const full: [string, number][] = [['must_have_match', 7], ['achievements', 8], ['summary_fit', 7], ['clarity', 9], ['red_flags', 10]];

describe('callJson: sprzątanie i temperatura nowej próby', () => {
  const Schema = z.object({ name: z.string() });
  const call = (extra: Partial<Parameters<typeof callJson>[0]> = {}) =>
    callJson({ schema: Schema, schemaName: 'test', system: 's', user: 'u', tier: 'fast', ctx, temperature: 0, ...extra });

  it('ucina "}" bez pary na końcu tekstu, ale nie w tekście przepisywanym dosłownie', async () => {
    replies = [{ content: '{"name":"Brakuje efektów.}"}' }];
    expect(await call()).toEqual({ name: 'Brakuje efektów.' });
    replies = [{ content: '{"name":"Brakuje efektów.}"}' }];
    expect(await call({ verbatim: true })).toEqual({ name: 'Brakuje efektów.}' });
  });

  it('nowa próba od zera używa retryTemperature, a bez niej 0.5 jak dotąd', async () => {
    replies = [{ content: '{"name":"AAAA', finish: 'length' }, { content: '{"name":"A"}' }];
    await call({ retryTemperature: 0.2 });
    expect(sent.map((b) => b.temperature)).toEqual([0, 0.2]);

    sent.length = 0;
    replies = [{ content: '{"name":"AAAA', finish: 'length' }, { content: '{"name":"A"}' }];
    await call();
    expect(sent.map((b) => b.temperature)).toEqual([0, 0.5]);
  });
});

describe('AI-rekruter', () => {
  it('każde z 5 kryteriów dokładnie raz, ocena całkowita 0-10', () => {
    expect(reviewProblems(review(full))).toEqual([]);
    expect(reviewProblems(review(full.slice(0, 4))).join(' ')).toContain('Brak kryteriów: red_flags');
    expect(reviewProblems(review([...full, ['clarity', 6]])).join(' ')).toContain('więcej niż raz: clarity');
    expect(reviewProblems(review([['must_have_match', 7.5], ['achievements', 11], ['summary_fit', -1], ['clarity', 9], ['red_flags', 10]]))).toHaveLength(3);
  });

  it('niepełna ocena wraca do poprawki; prompt ma progi i zasady dla poprawek', async () => {
    replies = [{ content: JSON.stringify(review(full.slice(0, 4))) }, { content: JSON.stringify(review(full)) }];
    const r = await evaluateCv('Tekst CV', posting, ctx);
    expect(r.criteria).toHaveLength(5);
    expect(r.verdict).toBe('Dobre CV, brakuje efektów.');
    expect(lastUserMessage(1)).toContain('nie przeszła walidacji');
    expect(lastUserMessage(1)).toContain('Brak kryteriów: red_flags');
    expect(sent.map((b) => b.temperature)).toEqual([0, 0]);
    const system = sent[0].messages[0].content as string;
    expect(system).toContain('8 = konkretne produkty pracy, skala lub narzędzia nawet bez liczb');
    expect(system).toContain('needsUserInput=true');
    expect(system).toContain('nigdy w 1. osobie');
  });

  it('nowa próba po zapętleniu ma temperaturę 0.2', async () => {
    replies = [{ content: '{"criteria":[', finish: 'length' }, { content: JSON.stringify(review(full)) }];
    await evaluateCv('Tekst CV', posting, ctx);
    expect(sent.map((b) => b.temperature)).toEqual([0, 0.2]);
  });
});

describe('pisanie i poprawa CV', () => {
  it('punkt w 1. osobie i pozycja spoza profilu wracają do poprawki; wynik ma firmę, daty i liczby z profilu', async () => {
    const invented = { ...content(['Obsługa 40 zgłoszeń dziennie']), projects: [{ sourceId: 'zmyslony', name: 'Projekt', role: '', dates: '', technologies: [], link: '', bullets: [] }] };
    replies = [
      { content: JSON.stringify(content(['Przygotowywałem raporty z kampanii'])) },
      { content: JSON.stringify(invented) },
      { content: JSON.stringify(content(['Przygotowywanie raportów z kampanii', 'Obsługa 40 zgłoszeń dziennie'])) },
    ];
    const cv = await generateCv(profile, posting, 'pl', ctx);
    expect(lastUserMessage(1)).toContain('1. osobie („Przygotowywałem”)');
    // Druga nieudana próba idzie od zera, więc trzecia nie ma treści poprawki - ważne, że w końcu przeszła.
    expect(sent).toHaveLength(3);
    expect(cv.experience[0]).toMatchObject({ company: 'Firma Testowa Sp. z o.o.', dates: '07.2025 – 09.2025' });
    expect(cv.education[0].dates).toBe('10.2023 – obecnie');
    expect(cv.experience[0].bullets.map((b) => b.status)).toEqual(['fact', 'suggested']);
    expect(cv.experience[0].bullets[1]).toMatchObject({ reason: 'Liczba spoza profilu (40) - potwierdź albo odrzuć.', fallbackText: 'Obsługa zgłoszeń dziennie' });
    expect(sent[0].messages[0].content).toContain('ZAWSZE formą rzeczownikową');
  });

  it('pozycja spoza profilu dostaje opis błędu przy poprawce', async () => {
    const invented = { ...content([]), projects: [{ sourceId: 'zmyslony', name: 'Projekt X', role: '', dates: '', technologies: [], link: '', bullets: [] }] };
    replies = [{ content: JSON.stringify(invented) }, { content: JSON.stringify(content([])) }];
    await generateCv(profile, posting, 'pl', ctx);
    expect(lastUserMessage(1)).toContain('Pozycja „Projekt X” ma sourceId "zmyslony"');
  });

  it('przy poprawie liczby z zaakceptowanych punktów zostają faktami', async () => {
    const current = content(['Obsługa 40 zgłoszeń dziennie']);
    const report: AtsReport = {
      createdAt: '', version: 1, total: null,
      keywords: { score: 0, max: 40, matched: [], missing: [], stuffing: [] },
      format: { score: 20, max: 20, pages: 1, checks: [] },
      ai: null, aiError: '',
    };
    replies = [{ content: JSON.stringify(content(['Obsługa 40 zgłoszeń dziennie', 'Wsparcie 12 kampanii'])) }];
    const cv = await improveCv(profile, posting, current, report, ctx);
    expect(cv.experience[0].bullets.map((b) => b.status)).toEqual(['fact', 'suggested']);
  });
});

describe('ogłoszenie: języki bez poziomu w słowach kluczowych', () => {
  it('zdejmuje poziom CEFR i opisowy z nazwy języka', () => {
    expect(withoutLevel('angielski B2')).toBe('angielski');
    expect(withoutLevel('Język angielski (min. C1)')).toBe('Język angielski');
    expect(withoutLevel('angielski na poziomie B2+')).toBe('angielski');
    expect(withoutLevel('English - B2/C1')).toBe('English');
    expect(withoutLevel('B2 English')).toBe('English');
    expect(withoutLevel('biegły angielski')).toBe('angielski');
    expect(withoutLevel('angielski - komunikatywny')).toBe('angielski');
    expect(withoutLevel('niemiecki')).toBe('niemiecki');
    expect(withoutLevel('B2')).toBe('B2');
  });

  it('tylko słowa kluczowe z kategorii "język"; synonimy bez powtórzeń', () => {
    const kw: Keyword[] = [
      { term: 'angielski B2', synonyms: ['English B2', 'angielski C1', 'język angielski'], importance: 'must', category: 'język' },
      { term: 'Excel B2', synonyms: [], importance: 'nice', category: 'narzędzie' },
    ];
    expect(withoutLevels(kw)).toEqual([
      { term: 'angielski', synonyms: ['English', 'język angielski'], importance: 'must', category: 'język' },
      { term: 'Excel B2', synonyms: [], importance: 'nice', category: 'narzędzie' },
    ]);
  });

  it('parsePosting zwraca słowa kluczowe bez poziomu; prompt o to prosi', async () => {
    replies = [{ content: JSON.stringify({ ...posting, summary: 'Firma szuka juniora.}' }) }];
    const p = await parsePosting('Treść ogłoszenia', '', ctx);
    expect(p.keywords[0]).toMatchObject({ term: 'angielski', synonyms: ['English', 'język angielski'] });
    expect(p.summary).toBe('Firma szuka juniora.');
    expect(sent[0].messages[0].content).toContain('"term" to sama nazwa języka');
  });
});
