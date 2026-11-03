import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-reasoning-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const { callJson } = await import('../server/llm/openrouter');

// Wycinek listy modeli z OpenRouter: parametry jak u prawdziwych modeli.
const CATALOG = [
  { id: 'anthropic/claude-haiku-5.5', supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'] },
  { id: 'openai/gpt-5-nano', supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs'] },
  { id: 'openai/gpt-4o-mini', supported_parameters: ['max_tokens', 'response_format', 'structured_outputs', 'temperature'] },
];

type Reply = { status?: number; body: unknown };
let replies: Reply[] = [];
const sent: any[] = [];
let catalogCalls = 0;

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (url: string, init: any) => {
    if (String(url).endsWith('/models')) {
      catalogCalls++;
      return new Response(JSON.stringify({ data: CATALOG }));
    }
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

const ok = (content: string) => ({ body: { model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } } });

async function call(model: string) {
  await store.saveSettings({ fastModel: model });
  return callJson({ schema: z.object({ name: z.string() }), schemaName: 'test', system: 's', user: 'u', tier: 'fast', temperature: 0.2, ctx: { profileId: '', task: 'test' } });
}

describe('parametry według listy modeli', () => {
  it('Claude 5.5: bez temperatury (inaczej require_parameters nie znajduje dostawcy) i z wyłączonym myśleniem', async () => {
    replies = [ok('{"name":"A"}')];
    expect(await call('anthropic/claude-haiku-5.5')).toEqual({ name: 'A' });
    expect(sent[0]).not.toHaveProperty('temperature');
    expect(sent[0].reasoning).toEqual({ enabled: false });
    expect(sent[0].provider).toEqual({ require_parameters: true });
  });

  it('model, który musi myśleć: po odmowie myśli krótko, a schemat zostaje wymuszony', async () => {
    replies = [
      { status: 400, body: { error: { code: 400, message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } } },
      ok('{"name":"B"}'),
    ];
    expect(await call('openai/gpt-5-nano')).toEqual({ name: 'B' });
    expect(sent[1].reasoning).toEqual({ effort: 'low' });
    expect(sent[1].response_format).toBeDefined();
    expect(sent[1].provider).toEqual({ require_parameters: true });
  });

  it('model bez myślenia: temperatura jest, parametru reasoning nie ma', async () => {
    replies = [ok('{"name":"C"}')];
    expect(await call('openai/gpt-4o-mini')).toEqual({ name: 'C' });
    expect(sent[0].temperature).toBe(0.2);
    expect(sent[0]).not.toHaveProperty('reasoning');
  });

  it('modelu nie ma na liście: zachowanie jak dotąd', async () => {
    replies = [ok('{"name":"D"}')];
    expect(await call('vendor/unknown-model')).toEqual({ name: 'D' });
    expect(sent[0].temperature).toBe(0.2);
    expect(sent[0]).not.toHaveProperty('reasoning');
  });

  it('listę modeli pobiera raz, a nie przy każdym wywołaniu', () => {
    expect(catalogCalls).toBe(1);
  });
});
