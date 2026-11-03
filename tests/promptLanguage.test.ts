import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { posting, profile } from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-lang-'));
process.env.CV_DATA_DIR = dir;

const { withLang } = await import('../server/i18n');
const { gapQuestions } = await import('../server/llm/prompts/gapQuestions');
const store = await import('../server/storage/store');

const systems: string[] = [];

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    systems.push(JSON.parse(init.body).messages[0].content);
    const content = JSON.stringify({ covered: [], questions: [] });
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('teksty od AI w języku interfejsu', () => {
  it('pytania o braki: po polsku domyślnie, po angielsku przy angielskim interfejsie', async () => {
    const ctx = { profileId: '', task: 'test' };
    await withLang('pl', () => gapQuestions(profile, posting, ctx));
    await withLang('en', () => gapQuestions(profile, posting, ctx));
    expect(systems[0]).toContain('pytanie po polsku');
    expect(systems[1]).toContain('pytanie po angielsku');
    expect(systems[1]).not.toContain('po polsku');
  });
});
