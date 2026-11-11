import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-polanon-'));
process.env.CV_DATA_DIR = dir;

const { polanonStatus, profileTerms, linkHandle, streetParts } = await import('../server/privacy/polanon');
const { profile } = await import('./fixtures');
const { collectStrings, replaceStrings } = await import('../server/llm/strings');
const store = await import('../server/storage/store');

// polanon jest opcjonalny: testy z prawdziwym pakietem idą tylko tam, gdzie jest zainstalowany.
const status = await polanonStatus(store.DEFAULT_SETTINGS);
const withPolanon = !!status.polanon;

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('teksty w odpowiedzi AI', () => {
  it('zbiera i podmienia wszystkie teksty, zostawiając resztę struktury', () => {
    const value = { a: 'x', list: ['y', { b: 'z', n: 3, ok: true, none: null }], empty: [] };
    const texts: string[] = [];
    collectStrings(value, texts);
    expect(texts).toEqual(['x', 'y', 'z']);
    expect(replaceStrings(value, ['X', 'Y', 'Z'][Symbol.iterator]())).toEqual({ a: 'X', list: ['Y', { b: 'Z', n: 3, ok: true, none: null }], empty: [] });
  });
});

// Dane FIKCYJNE: ta osoba nie istnieje.
const kandydat = {
  ...profile,
  contact: {
    fullName: 'Michał Żółtowski',
    email: 'michal.zoltowski@example.com',
    phone: '+48 601 234 567',
    location: 'Kraków, Wrzosowa 12/4',
    links: [
      { label: 'GitHub', url: 'https://github.com/mzoltowski' },
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/michal-zoltowski-example/' },
    ],
  },
  projects: [
    { id: 'pr1', name: 'Weather App', role: '', start: '2024', end: '', description: '', technologies: [], link: 'https://mzoltowski.github.io/weather-app', achievements: [] },
  ],
};

describe('dane z profilu, które polanon maskuje zawsze', () => {
  it('login z linku do profilu, także z GitHub Pages', () => {
    expect(linkHandle('https://github.com/mzoltowski/weather-app')).toBe('mzoltowski');
    expect(linkHandle('mzoltowski.github.io')).toBe('mzoltowski');
    expect(linkHandle('https://www.linkedin.com/in/michal-zoltowski-example/')).toBe('michal-zoltowski-example');
    expect(linkHandle('https://michalzoltowski.example')).toBe('');
  });

  it('z miejscowości tylko ulica z numerem, miasto zostaje dla AI', () => {
    expect(streetParts('Kraków, Wrzosowa 12/4')).toEqual(['Wrzosowa 12/4']);
    expect(streetParts('ul. Wrzosowa 12/4, 31-542 Kraków')).toEqual(['ul. Wrzosowa 12/4']);
    expect(streetParts('Kraków')).toEqual([]);
  });

  it('imię i nazwisko, samo nazwisko, ulica, linki i loginy bez powtórzeń', () => {
    expect(profileTerms(kandydat)).toEqual([
      { type: 'PERSON', text: 'Michał Żółtowski' },
      { type: 'PERSON', text: 'Żółtowski' },
      { type: 'EMAIL', text: 'michal.zoltowski@example.com' },
      { type: 'PHONE', text: '+48 601 234 567' },
      { type: 'ADDRESS', text: 'Wrzosowa 12/4' },
      { type: 'LINK', text: 'https://github.com/mzoltowski' },
      { type: 'LINK', text: 'https://www.linkedin.com/in/michal-zoltowski-example/' },
      { type: 'LINK', text: 'mzoltowski' },
      { type: 'LINK', text: 'michal-zoltowski-example' },
    ]);
  });
});

describe.skipIf(withPolanon)('maskowanie włączone, ale bez polanonu', () => {
  it('nic nie wychodzi do AI, tylko jasny błąd', async () => {
    await store.saveSettings({ apiKey: 'sk-test-key', maskPii: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { callJson } = await import('../server/llm/openrouter');
    const call = callJson({ schema: z.object({}), schemaName: 'test', system: 's', user: 'Jan Kowalski', tier: 'fast', ctx: { profileId: '', task: 'test' } });
    await expect(call).rejects.toMatchObject({ status: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe.skipIf(!withPolanon)('maskowanie przez polanon', () => {
  const sent: any[] = [];
  const Schema = z.object({ header: z.string(), bullets: z.array(z.string()) });

  beforeAll(async () => {
    await store.saveSettings({ apiKey: 'sk-test-key', maskPii: true });
    // "Model" odsyła tokeny, które dostał - tak jak prawdziwy, który pisze CV z danych kandydata.
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      const user: string = body.messages[1].content;
      const tokens = user.match(/<[A-Z_]+_\d+>/g) ?? [];
      const content = JSON.stringify({ header: tokens.join(' | '), bullets: [`Kontakt: ${tokens.find((t) => t.startsWith('<EMAIL')) ?? ''}`] });
      return new Response(
        JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 } }),
      );
    });
  });

  it('do AI idą tokeny, a odpowiedź wraca z prawdziwymi danymi', async () => {
    const { callJson } = await import('../server/llm/openrouter');
    const user = 'Kandydatka: Zofia Żółkiewska, e-mail zofia.zolkiewska@example.com, tel. +48 600 100 200. Umiejętności: SQL, Power BI.';
    const out = await callJson({ schema: Schema, schemaName: 'test', system: 's', user, tier: 'fast', ctx: { profileId: '', task: 'test' } });

    const prompt = JSON.stringify(sent[0].messages);
    expect(prompt).not.toContain('Żółkiewska');
    expect(prompt).not.toContain('zofia.zolkiewska@example.com');
    expect(prompt).not.toContain('600 100 200');
    expect(prompt).toContain('SQL, Power BI'); // umiejętności zostają czytelne
    expect(sent[0].messages[0].content).toContain('<OSOBA_1>'); // model wie, czym są tokeny

    expect(out.header).toContain('Zofia Żółkiewska');
    expect(out.bullets[0]).toBe('Kontakt: zofia.zolkiewska@example.com');
  });

  it('dane z profilu są maskowane zawsze: link z nazwiskiem i imię spoza polskiej listy', async () => {
    const { maskForAi } = await import('../server/privacy/polanon');
    const text = 'Olena Shevchenko, https://www.linkedin.com/in/olena-shevchenko-example/ - junior QA, linkedin.com/in/olena-shevchenko-example';
    const masked = await maskForAi(text, { ...store.DEFAULT_SETTINGS, maskPii: true }, [
      { type: 'PERSON', text: 'Olena Shevchenko' },
      { type: 'LINK', text: 'https://linkedin.com/in/olena-shevchenko-example' },
    ]);
    expect(masked.text).not.toMatch(/olena|shevchenko/i);
    expect(masked.text).toContain('<LINK_1>');
    expect(masked.text).toContain('junior QA');
    expect(await masked.restore({ t: masked.text })).toEqual({ t: text });
  });

  it('login z GitHuba bez linku, nazwisko małymi literami i ulica bez "ul." też', async () => {
    const { maskForAi } = await import('../server/privacy/polanon');
    const text = [
      '{"login": "mzoltowski", "repo": "mzoltowski.github.io"}',
      'mój github to mzoltowski, pracowałem u ojca w żółtowski transport',
      '"location": "Kraków, Wrzosowa 12/4"',
    ].join('\n');
    const masked = await maskForAi(text, { ...store.DEFAULT_SETTINGS, maskPii: true }, profileTerms(kandydat));
    expect(masked.text).not.toMatch(/mzoltowski|żółtowski|wrzosowa/i);
    expect(masked.text).toContain('Kraków');
    expect(await masked.restore({ t: masked.text })).toEqual({ t: text });
  });

  it('próbna rozmowa: dane osobowe z odpowiedzi kandydata idą do oceny tylko jako tokeny', async () => {
    const { mockGrade } = await import('../server/llm/prompts/mockInterview');
    sent.length = 0;
    const answer = 'Nazywam się Zofia Żółkiewska, mój e-mail to zofia.zolkiewska@example.com, telefon +48 600 100 200. Robiłam raporty w Power BI.';
    const at = new Date().toISOString();
    const interview = {
      id: 'm1', startedAt: at, status: 'active' as const, language: 'pl' as const, cvText: 'CV', probes: [],
      plan: { questions: [{ id: 'q1', kind: 'experience' as const, text: 'Proszę opowiedzieć o raportach.', lang: 'pl' as const, why: '' }], companyChecks: [] },
      turns: [
        { id: 't1', role: 'interviewer' as const, kind: 'question' as const, questionId: 'q1', content: 'Proszę opowiedzieć o raportach.', at },
        { id: 't2', role: 'candidate' as const, kind: 'answer' as const, questionId: 'q1', content: answer, at },
      ],
      grades: [], summary: null,
    };
    // Profil zapisany jak w aplikacji: jego dane polanon maskuje zawsze (profileTerms).
    const saved = await store.saveProfile({ ...profile, id: store.newId() });
    // Atrapa odsyła JSON spoza schematu oceny: wystarczy nam pierwsze zapytanie, ocena po 3 próbach się nie uda.
    await mockGrade({ profile: saved, posting: (await import('./fixtures')).posting, cvText: 'CV', interview, questionId: 'q1', answers: [answer], followUpAllowed: true, ctx: { profileId: saved.id, task: 'test' } }).catch(() => {});
    const prompt = JSON.stringify(sent[0].messages);
    expect(prompt).not.toContain('Żółkiewska');
    expect(prompt).not.toContain('zofia.zolkiewska@example.com');
    expect(prompt).not.toContain('600 100 200');
    expect(prompt).toContain('Power BI');
  });
});
