import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
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

  it('obserwator (dla evals/) widzi każdą próbę: odrzuconą z powodem i surowym JSON-em, potem przyjętą, z kosztem', async () => {
    const { observeCalls } = await import('../server/llm/openrouter');
    const seen: { attempt: number; accepted: boolean; raw: unknown; error: string; cost: number; task: string }[] = [];
    observeCalls((a) => seen.push({ attempt: a.attempt, accepted: a.accepted, raw: a.raw, error: a.error, cost: a.cost, task: a.ctx.task }));
    try {
      replies = [ok('{"name":"A","score":"siedem"}', 0.002), ok('{"name":"A","score":7}', 0.003)];
      expect(await call()).toEqual({ name: 'A', score: 7 });
    } finally {
      observeCalls(null);
    }
    expect(seen).toMatchObject([
      { attempt: 1, accepted: false, raw: { name: 'A', score: 'siedem' }, cost: 0.002, task: 'test' },
      { attempt: 2, accepted: true, raw: { name: 'A', score: 7 }, error: '', cost: 0.003 },
    ]);
    expect(seen[0].error).toContain('score');
    // Bez obserwatora nic się nie zmienia.
    replies = [ok('{"name":"B","score":1}')];
    expect(await call()).toEqual({ name: 'B', score: 1 });
    expect(seen).toHaveLength(2);
  });

  it('zapętlona/ucięta albo pusta odpowiedź → nowa próba od zera, bez odsyłania śmieci', async () => {
    replies = [ok('{"name":"A","score":1,"name2":"AAAAAAAA', 0.001, 'length'), ok(''), ok('{"name":"A","score":2}')];
    expect(await call()).toEqual({ name: 'A', score: 2 });
    expect(sent).toHaveLength(3);
    expect(sent.every((b) => b.messages.length === 2)).toBe(true);
    expect(sent[1].temperature).not.toBe(sent[0].temperature);
  });

  it('po 3 nieudanych próbach - zrozumiały błąd', async () => {
    replies = [ok('x', 0, 'length'), ok('x', 0, 'length'), ok('x', 0, 'length')];
    await expect(call()).rejects.toThrow(/zapętlił się/);
  });

  it('gdy żaden dostawca nie wymusza schematu - najpierw bez require_parameters', async () => {
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

  it('długą pauzę i półpauzę od modelu zamienia na zwykły myślnik, ale tekst przepisywany dosłownie zostawia', async () => {
    replies = [ok('{"name":"Raporty w Power BI — co tydzień, 03.2024 – 06.2025, 2–3 razy","score":1}')];
    expect(await call()).toEqual({ name: 'Raporty w Power BI - co tydzień, 03.2024 - 06.2025, 2-3 razy', score: 1 });
    expect(sent[0].messages[0].content).toContain('nie używaj długiej pauzy (—) ani półpauzy (–)');

    const { callJson } = await import('../server/llm/openrouter');
    replies = [ok('{"name":"Klauzula — dosłownie z ogłoszenia","score":1}')];
    const verbatim = await callJson({ schema: Schema, schemaName: 'test', system: 's', user: 'u', tier: 'fast', verbatim: true, ctx: { profileId: '', task: 'test' } });
    expect(verbatim.name).toBe('Klauzula — dosłownie z ogłoszenia');
    expect(sent[1].messages[0].content).not.toContain('półpauzy');
  });
});

// Maskowanie z prawdziwym polanonem: jest opcjonalny, więc te testy idą tam, gdzie jest zainstalowany w wersji, z którą
// PolCV maskuje (w CI osobne zadanie "Maskowanie danych z polanon"). Dane FIKCYJNE: ta osoba nie istnieje.
const polanon = await (await import('../server/privacy/polanon')).polanonStatus((await import('../server/storage/store')).DEFAULT_SETTINGS);
const withPolanon = !!polanon.polanon && !polanon.updateRequired;

describe.skipIf(!withPolanon)('maskowanie przez polanon: notka o tokenach i tokeny z przypadkiem', () => {
  const user = 'Kandydatka: Zofia Żółkiewska, e-mail zofia.zolkiewska@example.com. Umiejętności: SQL, Power BI.';
  const callMasked = async (language?: 'pl' | 'en') => {
    const { callJson } = await import('../server/llm/openrouter');
    return callJson({ schema: Schema, schemaName: 'test', system: 's', user, tier: 'fast', ctx: { profileId: '', task: 'test' }, language });
  };
  /** Notki polanonu (token_instructions) z mostka, po polsku i po angielsku. */
  const polanonNotes = async () => {
    const { maskForAi } = await import('../server/privacy/polanon');
    const store = await import('../server/storage/store');
    return (await maskForAi('Kandydatka: Zofia Żółkiewska', { ...store.DEFAULT_SETTINGS, maskPii: true })).notes;
  };

  beforeAll(async () => {
    const store = await import('../server/storage/store');
    await store.saveSettings({ maskPii: true });
  });
  afterAll(async () => {
    const store = await import('../server/storage/store');
    await store.saveSettings({ maskPii: false });
  });

  it('list po polsku: notka polanonu prosi o przypadek, a imię i nazwisko wraca odmienione', async () => {
    const { withLang } = await import('../server/i18n');
    replies = [ok(JSON.stringify({ name: 'List od <OSOBA_1:dopełniacz>. Szanowna Pani <OSOBA_1:wołacz>, dziękuję.', score: 1 }))];
    const out = await withLang('pl', () => callMasked());
    expect(out.name).toBe('List od Zofii Żółkiewskiej. Szanowna Pani Zofio Żółkiewska, dziękuję.');

    const notes = await polanonNotes();
    expect(notes.pl).toMatch(/<OSOBA_1:\p{L}+>/u); // po polsku polanon prosi o przypadek po dwukropku
    expect(sent[0].messages[0].content).toContain(notes.pl);
    expect(sent[0].messages[1].content).toContain('<OSOBA_1>');
    expect(JSON.stringify(sent[0].messages)).not.toMatch(/Żółkiewska|zofia\.zolkiewska@example\.com/);
  });

  it('angielski interfejs: notka po angielsku, bez prośby o przypadek; list po polsku dostaje polską', async () => {
    const { withLang } = await import('../server/i18n');
    replies = [ok('{"name":"<OSOBA_1>","score":1}'), ok('{"name":"<OSOBA_1>","score":1}'), ok('{"name":"<OSOBA_1>","score":1}')];
    expect(await withLang('en', () => callMasked())).toEqual({ name: 'Zofia Żółkiewska', score: 1 });
    await withLang('en', () => callMasked('pl'));
    await withLang('pl', () => callMasked('en'));

    const notes = await polanonNotes();
    expect(notes.en).not.toMatch(/<OSOBA_1:\p{L}+>/u);
    const systems = sent.map((body) => body.messages[0].content as string);
    expect(systems.map((s) => (s.includes(notes.pl) ? 'pl' : s.includes(notes.en) ? 'en' : '?'))).toEqual(['en', 'pl', 'en']);
  });

  it('token z przypadkiem, którego nie ma w mapowaniu, liczy się do ostrzeżenia o nieznanych tokenach', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    replies = [ok(JSON.stringify({ name: 'Od <OSOBA_1:dopełniacz> i <OSOBA_7:dopełniacz>', score: 1 }))];
    try {
      expect((await callMasked('pl')).name).toBe('Od Zofii Żółkiewskiej i <OSOBA_7:dopełniacz>');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('zostało 1 tokenów'));
    } finally {
      warn.mockRestore();
    }
  });
});
