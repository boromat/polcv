import { withPage } from './browser';
import { pdfToText } from './importCv';

/**
 * HTML → PDF z prawdziwym tekstem (Chromium), plus tekst odczytany z gotowego pliku.
 * `fill`: ile strony zajmuje treść po dopasowaniu czcionki (powyżej 1 = nie zmieściła się na jednej).
 */
export async function htmlToPdf(html: string): Promise<{ pdf: Buffer; text: string; pages: number; fill: number | null }> {
  let fill: number | null = null;
  const pdf = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Dopasowanie do strony dopiero przy wczytanych czcionkach, bo od nich zależy wysokość tekstu.
    fill = await page.evaluate(() => (window as any).__cvFit?.()?.fill ?? null);
    return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
  });
  const { text, pages } = await pdfToText(pdf);
  return { pdf, text, pages, fill };
}
