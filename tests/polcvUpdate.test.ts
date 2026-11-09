import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../server/version';

afterEach(() => vi.unstubAllGlobals());

/** Świeży moduł: najnowsze wydanie jest trzymane w pamięci modułu. */
async function freshStatus(reply: () => Promise<Response>) {
  vi.stubGlobal('fetch', async (url: string) => {
    expect(url).toBe('https://api.github.com/repos/boromat/polcv/releases/latest');
    return reply();
  });
  vi.resetModules();
  return (await import('../server/update')).polcvUpdateStatus();
}

describe('nowa wersja PolCV', () => {
  it('nowsze wydanie na GitHubie: aktualizacja dostępna (numer bez "v")', async () => {
    const s = await freshStatus(async () => new Response(JSON.stringify({ tag_name: 'v99.0.0' })));
    expect(s).toMatchObject({ current: VERSION, latest: '99.0.0', updateAvailable: true, releasesUrl: 'https://github.com/boromat/polcv/releases' });
  });

  it('to samo wydanie co zainstalowane: bez propozycji', async () => {
    const s = await freshStatus(async () => new Response(JSON.stringify({ tag_name: `v${VERSION}` })));
    expect(s.updateAvailable).toBe(false);
  });

  it('bez sieci: brak numeru i brak propozycji', async () => {
    const s = await freshStatus(async () => {
      throw new Error('offline');
    });
    expect(s).toMatchObject({ latest: null, updateAvailable: false });
  });
});
