import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { HttpError } from '../storage/store';

export async function pdfToText(buf: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { text: (text as string[]).join('\n\n'), pages: totalPages };
}

/** Tekst z wgranego CV (PDF albo DOCX). */
export async function cvFileToText(buf: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop();
  let text = '';
  if (ext === 'pdf') text = (await pdfToText(buf)).text;
  else if (ext === 'docx') text = (await mammoth.extractRawText({ buffer: buf })).value;
  else if (ext === 'txt' || ext === 'md') text = buf.toString('utf8');
  else throw new HttpError(400, 'Obsługiwane formaty CV: PDF, DOCX, TXT.');

  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) {
    throw new HttpError(
      422,
      'Z tego pliku nie da się odczytać tekstu (to może być skan lub obrazek). Wgraj CV zapisane jako PDF z Worda/Google Docs albo plik DOCX.',
    );
  }
  return text.slice(0, 30_000);
}
