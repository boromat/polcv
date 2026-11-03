import { chromium, type Browser, type Page } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

/** Jedna współdzielona instancja Chromium — start trwa ~1 s, więc trzymamy ją otwartą. */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((e) => {
      browserPromise = null;
      throw new Error(
        `Nie udało się uruchomić przeglądarki Chromium (${e.message}). Uruchom w folderze programu: npx playwright install chromium`,
      );
    });
    browserPromise.then((b) => b.on('disconnected', () => (browserPromise = null)));
  }
  return browserPromise;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'pl-PL',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) await (await browserPromise).close().catch(() => {});
  browserPromise = null;
}
