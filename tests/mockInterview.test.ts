import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from '../shared/schemas';
import * as fixtures from './fixtures';

// PDF bez przeglądarki: tekst CV to treść HTML bez stylów, skryptów i znaczników (jak tekst z prawdziwego PDF).
vi.mock('../server/cv/pdf', () => ({
  htmlToPdf: async (html: string) => ({
    pdf: Buffer.from(''),
    pages: 1,
    fill: 0.9,
    text: html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n'),
  }),
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-mock-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const mock = await import('../server/mockInterview');

/** Odpowiedzi atrapy modelu według nazwy schematu; `hold` wstrzymuje ocenę do wywołania `release`. */
let replies: Record<string, string[]> = {};
const sent: any[] = [];
let hold: Promise<void> | null = null;

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    if (!init?.body) return new Response('{}', { status: 404 }); // lista modeli
    const body = JSON.parse(init.body);
    sent.push(body);
    const name: string = body.response_format?.json_schema?.name ?? '';
    if (name === 'mock_interview_grade' && hold) await hold;
    const content = replies[name]?.shift();
    if (content === undefined) throw new Error(`brak odpowiedzi AI w teście: ${name}`);
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0.001, prompt_tokens: 1, completion_tokens: 1 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  replies = {};
  sent.length = 0;
  hold = null;
});

const KINDS = ['intro', 'experience', 'situational', 'knowledge', 'tools', 'gap', 'probe'];
const plan = (n = 7) =>
  JSON.stringify({
    questions: KINDS.slice(0, n).map((kind, i) => ({ kind, text: `Pytanie ${i + 1}: proszę opowiedzieć o tym.`, lang: 'pl', why: 'sprawdzenie' })),
    companyChecks: ['Czym firma się zajmuje poza ogłoszeniem'],
  });

// Bez form z rodzajem: fikcyjny profil nie podaje zaimków.
const SAFE = 'Moim zadaniem było prowadzenie profilu firmy na Instagramie i przygotowywanie raportów w Google Analytics 4 [ile raportów miesięcznie].';
const grade = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    criteria: { concrete: 2, fit: 3, structure: 3, correctness: 4 },
    good: ['Dobry przykład'],
    missing: ['Brak liczb'],
    stronger: SAFE,
    factualErrors: [],
    companyChecks: [],
    newFacts: [],
    followUp: '',
    ...over,
  });
const summary = () => JSON.stringify({ strengths: ['a', 'b', 'c'], improvements: ['x', 'y', 'z'], topicsToReview: [{ topic: 'GA4', why: 'raporty' }], candidateQuestions: 'Dobre pytania.' });

async function setup() {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId() });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'przygotowane', notes: '', currentVersion: 0, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  const v = await store.addVersion(profile.id, app.id, (version) => ({ ...structuredClone(fixtures.cv), version }));
  await store.updateApplication(profile.id, app.id, (a) => void (a.currentVersion = v.version));
  return { pid: profile.id, aid: app.id };
}

const lastTurn = (v: Awaited<ReturnType<typeof mock.getMock>>) => v.current!.turns.at(-1)!;

describe('próbna rozmowa: przebieg', () => {
  it('plan: 6-8 pytań i każdy rodzaj (zły plan wraca do modelu), lista do dopytania z CV, pierwsze pytanie', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan(5), plan(7)] };
    const v = await mock.startMock(pid, aid);
    expect(sent.map((s) => s.response_format.json_schema.name)).toEqual(['mock_interview_plan', 'mock_interview_plan']);
    expect(sent[1].messages.at(-1).content).toContain('Plan ma 5 pytań');
    const m = v.current!;
    expect(m.plan.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
    expect(m.turns).toEqual([expect.objectContaining({ role: 'interviewer', kind: 'question', questionId: 'q1', content: 'Pytanie 1: proszę opowiedzieć o tym.' })]);
    expect(m.probes.map((p) => p.item)).toContain('Canva');
    // Lista do dopytania i tekst CV idą do modelu.
    expect(sent[0].messages[1].content).toContain('Umiejętność „Canva”');
    expect(m.cvText).toContain('Zażółć gęślą jaźń');
    // Trwająca rozmowa się wznawia, bez nowego planu.
    sent.length = 0;
    expect((await mock.startMock(pid, aid)).current!.id).toBe(m.id);
    expect(sent).toHaveLength(0);
  });

  it('jedno dopytanie na pytanie: drugie program pomija i zadaje następne pytanie; pominięcie bez AI', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan()], mock_interview_grade: [grade({ followUp: 'Jaki był efekt w liczbach?' }), grade({ followUp: 'A jeszcze jeden przykład?' })] };
    await mock.startMock(pid, aid);
    let v = await mock.answerMock(pid, aid, 'Robiłam raporty.');
    expect(lastTurn(v)).toMatchObject({ role: 'interviewer', kind: 'followup', questionId: 'q1', content: 'Jaki był efekt w liczbach?' });
    v = await mock.answerMock(pid, aid, 'Raporty co tydzień dla działu marketingu.');
    expect(lastTurn(v)).toMatchObject({ role: 'interviewer', kind: 'question', questionId: 'q2' });
    expect(v.current!.grades.map((g) => [g.questionId, g.score])).toEqual([['q1', 3], ['q1', 3]]);
    // Ocena po dopytaniu dostaje obie części odpowiedzi.
    expect(sent.at(-1).messages[1].content).toContain('po dopytaniu');
    sent.length = 0;
    v = await mock.skipMock(pid, aid);
    expect(sent).toHaveLength(0);
    expect(v.current!.turns.slice(-2).map((t) => [t.kind, t.questionId])).toEqual([['skip', 'q2'], ['question', 'q3']]);
  });

  it('dopytanie tylko po ogólnikowej odpowiedzi: przy konkrecie 3-5 program je pomija i zadaje następne pytanie', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan()], mock_interview_grade: [grade({ criteria: { concrete: 4, fit: 4, structure: 4, correctness: 4 }, followUp: 'A jaki był efekt?' })] };
    await mock.startMock(pid, aid);
    const v = await mock.answerMock(pid, aid, 'Przygotowywałam 12 raportów miesięcznie w Google Analytics 4 dla zespołu.');
    expect(lastTurn(v)).toMatchObject({ role: 'interviewer', kind: 'question', questionId: 'q2' });
    expect(v.current!.turns.some((t) => t.kind === 'followup')).toBe(false);
  });

  it('mocniejsza wersja z liczbą spoza źródeł wraca do modelu; z miejscem w nawiasach przechodzi', async () => {
    const { pid, aid } = await setup();
    replies = {
      mock_interview_plan: [plan()],
      mock_interview_grade: [grade({ stronger: 'Moim zadaniem było prowadzenie profilu firmy na Instagramie, co dało 250 nowych obserwujących.' }), grade()],
    };
    await mock.startMock(pid, aid);
    const v = await mock.answerMock(pid, aid, 'Prowadziłam Instagram firmy.');
    expect(sent.at(-1).messages.at(-1).content).toContain('250');
    expect(v.current!.grades[0]).toMatchObject({ stronger: SAFE, placeholders: ['[ile raportów miesięcznie]'] });
  });

  it('trzy odrzucone mocniejsze wersje nie przerywają rozmowy: ocena wraca bez mocniejszej wersji', async () => {
    const { pid, aid } = await setup();
    const bad = grade({ stronger: 'Moim zadaniem było prowadzenie profilu firmy na Instagramie, co dało 250 nowych obserwujących.' });
    replies = { mock_interview_plan: [plan()], mock_interview_grade: [bad, bad, bad, bad] };
    await mock.startMock(pid, aid);
    sent.length = 0;
    const v = await mock.answerMock(pid, aid, 'Prowadziłam Instagram firmy.');
    expect(sent).toHaveLength(4);
    expect(sent[3].messages[0].content).toContain('"stronger" zostaw pusty');
    expect(v.current!.grades[0]).toMatchObject({ stronger: '', strongerFailed: true, placeholders: [] });
    // Rozmowa idzie dalej (ocena konkretu 2 dopuszcza dopytanie, ale atrapa go nie proponuje).
    expect(lastTurn(v)).toMatchObject({ role: 'interviewer', kind: 'question', questionId: 'q2' });
  });

  it('nowy fakt z odpowiedzi trafia do profilu dopiero po kliknięciu kandydata', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan()], mock_interview_grade: [grade({ newFacts: [{ topic: 'Skrypt do raportów', answer: 'Oszczędza godzinę dziennie' }] })] };
    await mock.startMock(pid, aid);
    const v = await mock.answerMock(pid, aid, 'Napisałam skrypt, który oszczędza godzinę dziennie.');
    const g = v.current!.grades[0];
    expect(g.facts).toEqual([{ topic: 'Skrypt do raportów', answer: 'Oszczędza godzinę dziennie', added: false }]);
    expect((await store.getProfile(pid)).extraFacts).toEqual([]);
    const after = await mock.addMockFact(pid, aid, g.answerId, 0);
    expect(after.current!.grades[0].facts[0].added).toBe(true);
    expect((await store.getProfile(pid)).extraFacts).toEqual([expect.objectContaining({ topic: 'Skrypt do raportów', answer: 'Oszczędza godzinę dziennie', has: true, source: 'Próbna rozmowa' })]);
    // Drugie kliknięcie nie dubluje faktu.
    await mock.addMockFact(pid, aid, g.answerId, 0);
    expect((await store.getProfile(pid)).extraFacts).toHaveLength(1);
  });

  it('rozmowa wyczyszczona w trakcie oceny: odpowiedź AI do starej rozmowy jest pomijana', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan()], mock_interview_grade: [grade()] };
    await mock.startMock(pid, aid);
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const pending = mock.answerMock(pid, aid, 'Odpowiedź w trakcie oceny.');
    // Odpowiedź kandydata jest zapisana od razu, zanim AI odpowie.
    await vi.waitFor(async () => expect(lastTurn(await mock.getMock(pid, aid))).toMatchObject({ role: 'candidate', content: 'Odpowiedź w trakcie oceny.' }));
    await mock.clearMock(pid, aid);
    release();
    const v = await pending;
    expect(v.current).toBeNull();
  });

  it('podsumowanie: średnia, miejsca w nawiasach, koszt z zapisu zużycia; kolejne podejścia zostają w historii', async () => {
    const { pid, aid } = await setup();
    replies = {
      mock_interview_plan: [plan(), plan()],
      mock_interview_grade: [grade({ criteria: { concrete: 5, fit: 5, structure: 4, correctness: 5 } }), grade()],
      mock_interview_summary: [summary(), summary()],
    };
    await mock.startMock(pid, aid);
    // Pierwsza odpowiedź ma 50 słów (długość 5), druga 2 słowa (długość 1): długość liczy program, nie model.
    await mock.answerMock(pid, aid, Array.from({ length: 50 }, (_, i) => `słowo${i}`).join(' '));
    await mock.answerMock(pid, aid, 'Druga odpowiedź.');
    await mock.skipMock(pid, aid);
    const v = await mock.finishMock(pid, aid);
    const s = v.current!.summary!;
    expect(v.current!.status).toBe('finished');
    expect(v.current!.grades.map((g) => [g.criteria.length, g.score])).toEqual([[5, 5], [1, 3]]);
    expect(s).toMatchObject({ average: 4, answered: 2, skipped: 1, strengths: ['a', 'b', 'c'] });
    expect(s.placeholders).toEqual([
      { question: 'Pytanie 1: proszę opowiedzieć o tym.', items: ['[ile raportów miesięcznie]'] },
      { question: 'Pytanie 2: proszę opowiedzieć o tym.', items: ['[ile raportów miesięcznie]'] },
    ]);
    // Plan, dwie oceny i podsumowanie po $0,001 każde.
    expect(s.costUsd).toBeCloseTo(0.004);
    expect((await store.readUsage()).filter((u) => u.applicationId === aid).every((u) => u.task === 'próbna rozmowa')).toBe(true);
    expect(v.history).toHaveLength(1);
    // Drugie podejście: nowa rozmowa, poprzednie podsumowanie zostaje.
    await mock.startMock(pid, aid, true);
    const second = await mock.finishMock(pid, aid);
    expect(second.history.map((h) => h.interviewId)).toEqual([v.current!.id, second.current!.id]);
  });

  it('pytania kandydata do firmy kończą rozmowę podsumowaniem, bez oceny', async () => {
    const { pid, aid } = await setup();
    replies = { mock_interview_plan: [plan(6)], mock_interview_summary: [summary()] };
    await mock.startMock(pid, aid);
    for (let i = 0; i < 6; i++) await mock.skipMock(pid, aid);
    const before = await mock.getMock(pid, aid);
    expect(lastTurn(before)).toMatchObject({ kind: 'closing', content: 'Na koniec: czy są jakieś pytania do nas?' });
    const v = await mock.answerMock(pid, aid, 'Jak wygląda wdrożenie w pierwszym miesiącu?');
    expect(v.current!.status).toBe('finished');
    expect(v.current!.grades).toEqual([]);
    expect(sent.at(-1).messages[1].content).toContain('Jak wygląda wdrożenie w pierwszym miesiącu?');
  });
});
