import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Mostek z atrapą polanonu: pakiet Pythona w folderze tymczasowym, na PYTHONPATH przed prawdziwym. Tak sprawdzamy
// ścieżki, których prawdziwy polanon 0.4.3 nie daje wywołać, bo jego maskowanie i ostatnia kontrola idą tymi samymi
// regułami: wartość, która została w tekście, błąd z kawałkiem CV w treści i wersję starszą niż wymagana.
// Prawdziwy pakiet sprawdzają tests/polanon.test.ts i tests/openrouter.test.ts w osobnym zadaniu CI. Dane FIKCYJNE.

const FAKE = `
__version__ = "{version}"


class Span:
    def __init__(self, start, end, entity_type, score, source):
        self.start, self.end, self.entity_type, self.score, self.source = start, end, entity_type, score, source


class Guard:
    pass


class PadError(BaseException):
    """Wyjątek spoza Exception: mostek go nie łapie i kończy się z nim."""


def default_guards(with_ner=False):
    return []


class Result:
    def __init__(self, anonymized, mapping):
        self.anonymized, self.mapping = anonymized, mapping


class Anonymizer:
    def __init__(self, guards, **options):
        self.guards = guards

    def anonymize_sync(self, text):
        if "AWARIA" in text:
            raise ValueError("nie umiem zamaskować: " + text)
        if "PRZERWIJ" in text:
            raise PadError(text)
        # Atrapa z dziurą: imię i nazwisko razem zamienia na token, samo nazwisko zostawia.
        mapping = {}
        if "Zofia Żółkiewska" in text:
            text = text.replace("Zofia Żółkiewska", "<OSOBA_1>")
            mapping["<OSOBA_1>"] = "Zofia Żółkiewska"
        return Result(text, mapping)

    @staticmethod
    def restore(text, mapping):
        for token, value in mapping.items():
            text = text.replace(token, value)
        return text


def leaked_tokens(payload, mapping):
    return sorted(token for token, value in mapping.items() if value.split()[-1] in payload)


def token_instructions(language="pl"):
    return {"pl": "NOTKA-PL: przypadek po dwukropku, <OSOBA_1:dopełniacz>.", "en": "NOTE-EN: copy <OSOBA_1> as written."}[language]
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-fakepolanon-'));
const site = path.join(dir, 'site');
fs.mkdirSync(path.join(site, 'polanon'), { recursive: true });
const installFake = (version: string) => fs.writeFileSync(path.join(site, 'polanon', '__init__.py'), FAKE.replace('{version}', version), 'utf8');
installFake('0.4.2');
process.env.CV_DATA_DIR = path.join(dir, 'data');
process.env.PYTHONPATH = [site, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
// Bez plików .pyc: atrapa podmieniona w tej samej sekundzie nie może wrócić ze starego cache.
process.env.PYTHONDONTWRITEBYTECODE = '1';

const { errorType, polanonStatus } = await import('../server/privacy/polanon');
const { callJson } = await import('../server/llm/openrouter');
const { withLang } = await import('../server/i18n');
const store = await import('../server/storage/store');

// Bez Pythona 3.11+ mostka nie ma czym uruchomić: zostają tylko testy bez Pythona.
const python = (await polanonStatus(store.DEFAULT_SETTINGS)).python;

const sent: any[] = [];
const Schema = z.object({ t: z.string() });
const call = (user: string, language?: 'pl' | 'en') =>
  callJson({ schema: Schema, schemaName: 'test', system: 's', user, tier: 'fast', ctx: { profileId: '', task: 'test' }, language });
/** Błąd, którym kończy się wywołanie; gdy się uda, test pada. */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('wywołanie AI się udało, a miało odmówić');
    },
    (e: InstanceType<typeof store.HttpError>) => e,
  );

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('nazwa wyjątku z mostka, bez jego treści', () => {
  it('z ostatniej linii stderr zostaje sama nazwa wyjątku', () => {
    expect(errorType("Traceback (most recent call last):\n  File \"x.py\", line 1\nKeyError: 'Żółkiewska'\n")).toBe('KeyError');
    expect(errorType('json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)')).toBe('json.decoder.JSONDecodeError');
    expect(errorType('KeyboardInterrupt')).toBe('KeyboardInterrupt');
  });

  it('linia, która nie jest wyjątkiem, nie trafia do komunikatu: może być dalszym ciągiem treści', () => {
    expect(errorType('ValueError: tekst\nZofia Żółkiewska, Wrzosowa 12/4')).toBe('');
    expect(errorType('Zofia Żółkiewska')).toBe('');
    expect(errorType('')).toBe('');
  });
});

describe.skipIf(!python)('mostek z atrapą polanonu', () => {
  beforeAll(async () => {
    await store.saveSettings({ apiKey: 'sk-test-key', maskPii: true });
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body));
      const content = JSON.stringify({ t: 'Kontakt: <OSOBA_1>' });
      return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } }));
    });
  });
  beforeEach(() => {
    sent.length = 0;
  });

  it('polanon starszy niż 0.4.3: Ustawienia proszą o aktualizację, a do AI nic nie wychodzi', async () => {
    const status = await withLang('pl', () => polanonStatus(store.DEFAULT_SETTINGS));
    expect(status).toMatchObject({ polanon: '0.4.2', required: '0.4.3', updateRequired: true });
    expect(status.error).toContain('PolCV potrzebuje wersji 0.4.3 lub nowszej');
    await expect(withLang('pl', () => call('Kandydatka: Zofia Żółkiewska'))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('za stary') });
    expect(sent).toEqual([]);
  });

  it('polanon 0.4.3: aktualizacja niewymagana', async () => {
    installFake('0.4.3');
    expect(await polanonStatus(store.DEFAULT_SETTINGS)).toMatchObject({ polanon: '0.4.3', updateRequired: false, error: '' });
  });

  it('ostatnia kontrola znalazła wartość w zamaskowanym tekście: 503, komunikat podaje sam token', async () => {
    const call503 = withLang('pl', () => call('Kandydatka: Zofia Żółkiewska. Podpis: Żółkiewska.'));
    const error = await failure(call503);
    expect(error.status).toBe(503);
    expect(error.message).toContain('<OSOBA_1>');
    expect(error.message).toContain('Nic nie zostało wysłane do AI');
    expect(error.message).not.toMatch(/Zofia|Żółkiewska/);
    expect(sent).toEqual([]);
  });

  it('błąd maskowania: komunikat podaje nazwę wyjątku, bez tekstu z CV', async () => {
    const error = await failure(withLang('pl', () => call('AWARIA. Kandydatka: Zofia Żółkiewska, Wrzosowa 12/4')));
    expect(error.status).toBe(503);
    expect(error.message).toContain('ValueError');
    expect(error.message).not.toMatch(/AWARIA|Zofia|Żółkiewska|Wrzosowa/);
    expect(sent).toEqual([]);
  });

  it('bez wycieku tekst idzie do AI z notką polanonu w języku tekstu, który pisze model', async () => {
    expect(await withLang('pl', () => call('Kandydatka: Zofia Żółkiewska, SQL'))).toEqual({ t: 'Kontakt: Zofia Żółkiewska' });
    await withLang('en', () => call('Kandydatka: Zofia Żółkiewska, SQL'));
    await withLang('en', () => call('Kandydatka: Zofia Żółkiewska, SQL', 'pl'));
    await withLang('pl', () => call('Kandydatka: Zofia Żółkiewska, SQL', 'en'));
    const systems = sent.map((body) => body.messages[0].content as string);
    expect(systems.map((s) => (s.includes('NOTKA-PL') ? 'pl' : s.includes('NOTE-EN') ? 'en' : '?'))).toEqual(['pl', 'en', 'pl', 'en']);
    expect(sent[0].messages[1].content).toBe('Kandydatka: <OSOBA_1>, SQL');
  });

  it('mostek pada z wyjątkiem: komunikat podaje jego nazwę, bez tekstu z CV, a następne wywołanie uruchamia go od nowa', async () => {
    const error = await failure(withLang('pl', () => call('PRZERWIJ. Kandydatka: Zofia Żółkiewska')));
    expect(error.status).toBe(503);
    expect(error.message).toContain('PadError');
    expect(error.message).not.toMatch(/PRZERWIJ|Zofia|Żółkiewska/);
    expect(await call('Kandydatka: Zofia Żółkiewska')).toEqual({ t: 'Kontakt: Zofia Żółkiewska' });
  });
});
