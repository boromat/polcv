import { chromium, type Browser, type Page } from 'playwright';
import { tr } from '../i18n';
import { APP_UA } from '../jobs/http';

let browserPromise: Promise<Browser> | null = null;

/** Jedna współdzielona instancja Chromium - start trwa ~1 s, więc trzymamy ją otwartą. */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launching: Promise<Browser> = chromium.launch({ headless: true }).then(
      (b) => {
        // Obsługa zamknięcia tylko po udanym starcie - osobny .then() bez .catch() kończył proces przy błędzie startu.
        b.on('disconnected', () => {
          if (browserPromise === launching) browserPromise = null;
        });
        return b;
      },
      (e) => {
        // Kolejna próba uruchomi Chromium od nowa (np. po doinstalowaniu przeglądarki).
        if (browserPromise === launching) browserPromise = null;
        throw new Error(
          tr('Nie udało się uruchomić przeglądarki Chromium ({error}). Uruchom w folderze programu: npx playwright install chromium', { error: e?.message ?? String(e) }),
        );
      },
    );
    browserPromise = launching;
  }
  return browserPromise;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  // Stronom przedstawiamy się jako PolCV, tak samo jak przy zwykłym pobieraniu, a nie jako czyjś Chrome.
  const context = await browser.newContext({ locale: 'pl-PL', userAgent: APP_UA });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}
