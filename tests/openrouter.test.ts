import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Osobny, tymczasowy folder danych — store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-test-'));
process.env.CV_DATA_DIR = dir;

const Schema = z.object({ name: z.string(), score: z.number() });

type Reply = { status?: number; body: unknown };
let replies: Reply[] = [];
const sent: any[] = [];

beforeAll(async () => {
  const store = await import('../server/storage/store');
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
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

const ok = (content: string, cost = 0.001, finish = 'stop') => ({
  body: { model: 'test/model', choices: [{ message: { content }, finish_reason: finish }], usage: { cost, prompt_tokens: 10, completion_tokens: 5 } },
});

async function call() {
  const { callJson } = await import('../server/llm/openrouter');
  return callJson({ schema: Schema, schemaName: 'test', system: 's', user: 'u', tier: 'fast', ctx: { profileId: '', task: 'test' } });
}

describe('klient OpenRouter', () => {
  it('wysyła schemat w trybie strict i wyciąga JSON z bloku markdown', async () => {
    replies = [ok('```json\n{"name":"A","score":7}\n```')];
    expect(await call()).toEqual({ name: 'A', score: 7 });
    expect(sent[0].response_format.json_schema.strict).toBe(true);
    expect(sent[0].provider).toEqual({ require_parameters: true });
    expect(sent[0].model).toBe('anthropic/claude-haiku-5.5');
  });

  it('zapętlona/ucięta albo pusta odpowiedź → nowa próba od zera, bez odsyłania śmieci', async () => {
    replies = [ok('{"name":"A","score":1,"name2":"AAAAAAAA', 0.001, 'length'), ok(''), ok('{"name":"A","score":2}')];
    expect(await call()).toEqual({ name: 'A', score: 2 });
    expect(sent).toHaveLength(3);
    expect(sent.every((b) => b.messages.length === 2)).toBe(true);
    expect(sent[1].temperature).not.toBe(sent[0].temperature);
  });

  it('po 3 nieudanych próbach — zrozumiały błąd', async () => {
    replies = [ok('x', 0, 'length'), ok('x', 0, 'length'), ok('x', 0, 'length')];
    await expect(call()).rejects.toThrow(/zapętlił się/);
  });

  it('gdy żaden dostawca nie wymusza schematu — najpierw bez require_parameters', async () => {
    replies = [{ status: 404, body: { error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } } }, ok('{"name":"D","score":4}')];
    expect(await call()).toEqual({ name: 'D', score: 4 });
    expect(sent[1].provider).toBeUndefined();
    expect(sent[1].response_format).toBeDefined();
  });

  it('jedna próba naprawy, gdy odpowiedź nie pasuje do schematu', async () => {
    replies = [ok('{"name":"A"}'), ok('{"name":"A","score":3}')];
    expect(await call()).toEqual({ name: 'A', score: 3 });
    expect(sent[1].messages.at(-1).content).toContain('nie przeszła walidacji');
  });

  it('bez json_schema, gdy model go nie obsługuje', async () => {
    replies = [{ status: 400, body: { error: { code: 400, message: 'response_format not supported' } } }, ok('{"name":"B","score":1}')];
    expect(await call()).toEqual({ name: 'B', score: 1 });
    expect(sent[1].response_format).toBeUndefined();
    expect(sent[1].messages[0].content).toContain('Schemat JSON');
  });

  it('zrozumiałe komunikaty dla złego klucza i braku środków', async () => {
    replies = [{ status: 401, body: { error: { code: 401, message: 'bad' } } }];
    await expect(call()).rejects.toThrow(/odrzucił klucz/);
    replies = [{ status: 402, body: { error: { code: 402, message: 'credits' } } }];
    await expect(call()).rejects.toThrow(/Brak środków/);
  });

  it('zapisuje koszt każdego wywołania', async () => {
    replies = [ok('{"name":"C","score":2}', 0.0123)];
    await call();
    const { readUsage } = await import('../server/storage/store');
    const usage = await readUsage();
    expect(usage.at(-1)).toMatchObject({ task: 'test', model: 'test/model', cost: 0.0123 });
  });
});
