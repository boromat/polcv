import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Application } from '../shared/schemas';
import * as fixtures from './fixtures';

// Przy włączonym maskowaniu cała historia próbnej rozmowy (z odpowiedziami kandydata) idzie przez polanon, jak każde
// inne wywołanie AI. Tu polanon jest podmieniony: zamienia dane z profilu na tokeny tak jak prawdziwy (prawdziwy
// pakiet sprawdza tests/polanon.test.ts w osobnym zadaniu CI).

vi.mock('../server/cv/pdf', () => ({
  htmlToPdf: async (html: string) => ({ pdf: Buffer.from(''), pages: 1, fill: 0.9, text: html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n') }),
}));

vi.mock('../server/privacy/polanon', async (importOriginal) => {
  const real = await importOriginal<typeof import('../server/privacy/polanon')>();
  return {
    ...real,
    maskForAi: async (text: string, _settings: unknown, terms: { type: string; text: string }[]) => {
      const mapping: Record<string, string> = {};
      let out = text;
      terms
        .filter((t) => t.text.trim())
        .sort((a, b) => b.text.length - a.text.length)
        .forEach((t, i) => {
          const token = `<${t.type === 'PERSON' ? 'OSOBA' : t.type === 'PHONE' ? 'TELEFON' : t.type}_${i + 1}>`;
          if (out.includes(t.text)) {
            out = out.split(t.text).join(token);
            mapping[token] = t.text;
          }
        });
      const swap = (s: string) => Object.entries(mapping).reduce((acc, [k, v]) => acc.split(k).join(v), s);
      const restore = <T,>(v: T): T => JSON.parse(swap(JSON.stringify(v)));
      return { text: out, restore: async <T,>(v: T) => restore(v) };
    },
  };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-mockmask-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const mock = await import('../server/mockInterview');

const sent: any[] = [];
const SAFE = 'Moim zadaniem było prowadzenie profilu firmy na Instagramie [jaki był efekt].';

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key', maskPii: true });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    if (!init?.body) return new Response('{}', { status: 404 });
    const body = JSON.parse(init.body);
    sent.push(body);
    const name: string = body.response_format?.json_schema?.name ?? '';
    const content =
      name === 'mock_interview_plan'
        ? JSON.stringify({ questions: ['intro', 'experience', 'situational', 'knowledge', 'tools', 'gap'].map((kind) => ({ kind, text: 'Proszę opowiedzieć o tym.', lang: 'pl', why: '' })), companyChecks: [] })
        : JSON.stringify({ criteria: { concrete: 3, fit: 3, structure: 3, correctness: 3 }, good: [], missing: [], stronger: SAFE, factualErrors: [], companyChecks: [], newFacts: [], followUp: '' });
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('próbna rozmowa przy włączonym maskowaniu', () => {
  it('dane osobowe z odpowiedzi kandydata i z CV idą do modelu tylko jako tokeny', async () => {
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

    await mock.startMock(profile.id, app.id);
    const answer = 'Nazywam się Zofia Żółkiewska, piszcie na zofia.zolkiewska@example.com albo dzwońcie: +48 600 100 200. Prowadziłam Instagram firmy.';
    const out = await mock.answerMock(profile.id, app.id, answer);

    expect(sent.map((s) => s.response_format.json_schema.name)).toEqual(['mock_interview_plan', 'mock_interview_grade']);
    for (const body of sent) {
      const prompt = JSON.stringify(body.messages);
      expect(prompt).not.toContain('Żółkiewska');
      expect(prompt).not.toContain('zofia.zolkiewska@example.com');
      expect(prompt).not.toContain('600 100 200');
    }
    // Odpowiedź z tokenami w historii rozmowy, a reszta odpowiedzi zostaje czytelna dla modelu.
    const user: string = sent[1].messages[1].content;
    expect(user).toContain('<OSOBA_');
    expect(user).toContain('Prowadziłam Instagram firmy.');
    // Na dysku odpowiedź zostaje w oryginale.
    expect(out.current!.turns.find((x) => x.role === 'candidate')!.content).toBe(answer);
  });
});
