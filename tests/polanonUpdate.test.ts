import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewer } from '../server/privacy/polanon';

afterEach(() => vi.unstubAllGlobals());

/** Świeży moduł: wersja z PyPI jest trzymana w pamięci modułu. */
async function freshUpdate(reply: () => Promise<Response>) {
  const fetchSpy = vi.fn(async (url: string) => {
    expect(url).toBe('https://pypi.org/pypi/polanon/json');
    return reply();
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.resetModules();
  const { polanonUpdate } = await import('../server/privacy/polanon');
  return { polanonUpdate, fetchSpy };
}

describe('wersje polanonu', () => {
  it.each([
    ['0.2.1', '0.1.1', true],
    ['0.3.0', '0.2.10', true],
    ['0.2.10', '0.2.9', true],
    ['1.0', '0.9.9', true],
    ['0.3.0rc1', '0.2.1', true],
    ['0.2.1', '0.2.1', false],
    ['0.2.0', '0.2.1', false],
    ['abc', '0.1.0', false],
  ])('%s nowsze niż %s: %s', (latest, installed, newer) => {
    expect(isNewer(latest, installed)).toBe(newer);
  });

  it('PyPI ma nowszą wersję: aktualizacja dostępna; numer pobierany raz', async () => {
    const { polanonUpdate, fetchSpy } = await freshUpdate(async () => new Response(JSON.stringify({ info: { version: '0.2.1' } })));
    expect(await polanonUpdate('0.1.1')).toEqual({ latest: '0.2.1', updateAvailable: true });
    expect(await polanonUpdate('0.2.1')).toEqual({ latest: '0.2.1', updateAvailable: false });
    expect(await polanonUpdate(null)).toEqual({ latest: '0.2.1', updateAvailable: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('bez sieci albo przy błędzie PyPI: brak numeru i brak propozycji aktualizacji', async () => {
    const { polanonUpdate } = await freshUpdate(async () => {
      throw new Error('offline');
    });
    expect(await polanonUpdate('0.1.1')).toEqual({ latest: null, updateAvailable: false });

    const down = await freshUpdate(async () => new Response('błąd', { status: 503 }));
    expect(await down.polanonUpdate('0.1.1')).toEqual({ latest: null, updateAvailable: false });
  });
});
