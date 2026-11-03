import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiReview, Application, AtsReport, CvContent, CvVersion } from '../shared/schemas';
import * as fixtures from './fixtures';

// PDF bez przeglądarki: tekst z HTML wystarcza do kontroli formatu.
vi.mock('../server/cv/pdf', () => ({
  htmlToPdf: async (html: string) => ({
    pdf: Buffer.from(''),
    pages: 1,
    text: html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').replace(/&[a-z#0-9]+;/g, ' '),
  }),
}));

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-improve-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');

// Odpowiedzi AI po nazwie schematu: "cv" (pisanie, poprawa) i "cv_review" (ocena).
let replies: Record<string, string[]> = {};
const sent: { schema: string; body: any }[] = [];

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const schema = body.response_format?.json_schema?.name ?? '';
    sent.push({ schema, body });
    const content = replies[schema]?.shift();
    if (content === undefined) throw new Error(`brak odpowiedzi dla ${schema}`);
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  replies = {};
  sent.length = 0;
});

const review = (score: number, extra: Partial<AiReview> = {}): AiReview => ({
  ...fixtures.review,
  criteria: fixtures.review.criteria.map((c) => ({ ...c, score })),
  ...extra,
});

/** CV bez oczekujących sugestii (jak po decyzjach kandydata). */
const decided = (): CvContent => {
  const c = structuredClone(fixtures.cv.content);
  c.experience[0].bullets = [c.experience[0].bullets[0]];
  return c;
};

async function setup(content: CvContent, report?: (v: CvVersion) => AtsReport) {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId() });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'przygotowane', notes: '', currentVersion: 1, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  const cv = await store.addVersion(profile.id, app.id, (version) => ({ ...structuredClone(fixtures.cv), version, decisions: {}, content }));
  // Świeży raport (późniejszy niż zapis wersji): improve nie ocenia jeszcze raz.
  if (report) await store.saveReport(profile.id, app.id, { ...report(cv), createdAt: new Date(Date.now() + 1000).toISOString() });
  return { pid: profile.id, aid: app.id };
}

const savedReport = (total: number, ai: AiReview): ((v: CvVersion) => AtsReport) => (v) => ({
  createdAt: '', version: v.version, total,
  keywords: { score: 30, max: 40, matched: [], missing: [], stuffing: [] },
  format: { score: 20, max: 20, pages: 1, checks: [] },
  ai: { score: 20, max: 40, review: ai },
  aiError: '',
});

describe('Popraw automatycznie', () => {
  it('nic do zrobienia: AI nie jest wywoływane, a komunikat mówi, co dopisać w profilu', async () => {
    const ask = { section: 'experience', find: '', replace: 'Ile postów publikowałaś tygodniowo?', why: 'Skala.', needsUserInput: true };
    const { pid, aid } = await setup(decided(), savedReport(80, review(8, { fixes: [ask] })));
    const res = await svc.improve(pid, aid);
    expect(sent).toEqual([]);
    expect(res).toMatchObject({ kept: 'none', version: null, before: 80, after: null, needsInput: ['Ile postów publikowałaś tygodniowo?'] });
    expect(res.message).toContain('Możesz dopisać w profilu:\n- Ile postów publikowałaś tygodniowo?');
    expect((await store.listVersions(pid, aid)).map((v) => v.version)).toEqual([1]);
  });

  it('gorsza nowa wersja zostaje na liście, ale bieżąca jest poprzednia', async () => {
    const { pid, aid } = await setup(decided(), savedReport(80, review(8, { criteria: review(8).criteria.map((c) => (c.key === 'clarity' ? { ...c, score: 5 } : c)) })));
    replies = { cv: [JSON.stringify(decided())], cv_review: [JSON.stringify(review(1))] };
    const res = await svc.improve(pid, aid);
    expect(res.kept).toBe('old');
    expect(res.before).toBe(80);
    expect(res.after).toBeLessThan(80);
    expect(res.version).toBe(2);
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(1);
    expect((await store.getVersion(pid, aid, 2)).origin).toBe('improved');
    expect((await store.getReport(pid, aid, 2))?.total).toBe(res.after);
    // Plan trafił do modelu zamiast surowego raportu.
    const improveCall = sent.find((s) => s.schema === 'cv')!;
    expect(improveCall.body.messages[1].content).toContain('PLAN POPRAWEK');
  });

  it('lepsza nowa wersja zostaje bieżąca; wynik "przed" pochodzi ze świeżej oceny serwera', async () => {
    const { pid, aid } = await setup(decided(), savedReport(30, review(5)));
    replies = { cv: [JSON.stringify(decided())], cv_review: [JSON.stringify(review(10))] };
    const res = await svc.improve(pid, aid);
    expect(res).toMatchObject({ kept: 'new', version: 2, before: 30 });
    expect(res.after).toBeGreaterThan(30);
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(2);
  });

  it('nieaktualny raport: najpierw ocena obecnej wersji, potem poprawa i ocena nowej', async () => {
    const { pid, aid } = await setup(decided());
    replies = { cv_review: [JSON.stringify(review(5)), JSON.stringify(review(9))], cv: [JSON.stringify(decided())] };
    const res = await svc.improve(pid, aid);
    expect(sent.map((s) => s.schema)).toEqual(['cv_review', 'cv', 'cv_review']);
    expect(res.before).toBe((await store.getReport(pid, aid, 1))?.total);
    expect(res.kept).toBe('new');
  });
});

describe('Napisz od nowa', () => {
  it('liczba z zaakceptowanej wcześniej sugestii nie wraca jako sugestia', async () => {
    // v1: zaakceptowana sugestia wpisana w treść jako fakt.
    const accepted = decided();
    accepted.experience[0].bullets.push({ id: 'b3', text: 'Obsługa 25 zgłoszeń klientów', status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp1'] });
    const { pid, aid } = await setup(accepted);
    // v2: starsza wersja z decyzją zapisaną osobno (sprzed wpisywania decyzji w treść).
    await store.addVersion(pid, aid, (version) => ({ ...structuredClone(fixtures.cv), version, decisions: { b2: 'accepted' } }));
    const written = decided();
    const bullet = (id: string, text: string) => ({ id, text, status: 'fact' as const, reason: '', fallbackText: '', sourceIds: ['exp1'] });
    written.experience[0].bullets.push(
      bullet('n1', 'Obsługa 25 zgłoszeń klientów'),
      bullet('n2', 'Zwiększenie zasięgu profilu o ok. 30%'),
      bullet('n3', 'Obsługa 12 kampanii'),
    );
    replies = { cv: [JSON.stringify(written)] };
    const cv = await svc.generate(pid, aid, 'pl');
    expect(cv.content.experience[0].bullets.map((b) => [b.text, b.status])).toEqual([
      ['Prowadzenie profilu firmy na Instagramie (social media)', 'fact'],
      ['Obsługa 25 zgłoszeń klientów', 'fact'],
      ['Zwiększenie zasięgu profilu o ok. 30%', 'fact'],
      ['Obsługa 12 kampanii', 'suggested'], // liczba nigdy nie potwierdzona
    ]);
    // Do profilu nic nie trafia.
    expect((await store.getProfile(pid)).extraFacts).toEqual([]);
  });
});
