import { withPage } from './browser';
import { pdfToText } from './importCv';

/** HTML → PDF z prawdziwym tekstem (Chromium), plus tekst odczytany z gotowego pliku. */
export async function htmlToPdf(html: string): Promise<{ pdf: Buffer; text: string; pages: number }> {
  const pdf = await withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
  });
  const { text, pages } = await pdfToText(pdf);
  return { pdf, text, pages };
}
