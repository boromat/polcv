import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { posting, profile } from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-gap-'));
process.env.CV_DATA_DIR = dir;

const { gapQuestions } = await import('../server/llm/prompts/gapQuestions');
const store = await import('../server/storage/store');

const sent: any[] = [];
let answer = '';

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ model: 'test/model', choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { cost: 0 } }),
    );
  });
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gap = (question: string) =>
  JSON.stringify({ covered: ['SQL (projekt)'], questions: [{ id: 'q1', requirement: 'Testy A/B', importance: 'must', question, hint: 'Podaj, gdzie to było.' }] });

describe('pytania o braki: styl nie blokuje CV', () => {
  it('neutralne pytania przechodzą od razu, z większym limitem odpowiedzi', async () => {
    answer = gap('Czy masz doświadczenie z testami A/B?');
    const res = await gapQuestions(profile, posting, { profileId: '', task: 'test' });
    expect(res.questions[0].question).toBe('Czy masz doświadczenie z testami A/B?');
    expect(sent).toHaveLength(1);
    expect(sent[0].max_tokens).toBe(8000);
  });

  it('gdy model uparcie pisze "używałeś", pytania i tak wracają (po 3 próbach poprawki jedno zapytanie bez tej kontroli)', async () => {
    answer = gap('Gdzie używałeś testów A/B?');
    const res = await gapQuestions(profile, posting, { profileId: '', task: 'test' });
    expect(res.questions[0].question).toBe('Gdzie używałeś testów A/B?');
    expect(sent).toHaveLength(4);
  });
});
