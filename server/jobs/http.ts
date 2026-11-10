import { VERSION } from '../version';

/**
 * Jedyny napis, którym program przedstawia się innym serwisom: pobieranie ogłoszeń (także przez przeglądarkę),
 * wyszukiwanie ofert, geokodowanie, GitHub i PyPI.
 */
export const APP_UA = `PolCV/${VERSION} (+https://github.com/boromat/polcv)`;

/**
 * Najnowsza wersja z publicznego API (wydania PolCV na GitHubie, polanon na PyPI; nic o użytkowniku nie wysyłamy):
 * numer jest pamiętany godzinę, a gdy sieci nie było, 5 minut. `pick` wyciąga numer z odpowiedzi JSON.
 */
export function latestVersionFrom(url: string, pick: (json: unknown) => string | null, headers: Record<string, string> = {}): () => Promise<string | null> {
  let cache: { at: number; version: string | null } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < (cache.version ? 3600_000 : 300_000)) return cache.version;
    const version = await fetch(url, { headers: { 'User-Agent': APP_UA, ...headers }, signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((j) => (j && typeof j === 'object' ? pick(j) : null))
      .catch(() => null);
    cache = { at: Date.now(), version };
    return version;
  };
}
