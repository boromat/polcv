import { afterEach, describe, expect, it, vi } from 'vitest';

// Przeglądarka nie jest potrzebna, gdy link prowadzi do pliku - atrapa sprawdza, że nikt jej nie uruchamia.
vi.mock('../server/cv/browser', () => ({
  withPage: vi.fn(async () => {
    throw new Error('przeglądarka nie powinna być uruchamiana');
  }),
}));

const { fetchPosting } = await import('../server/jobs/fetchPosting');
const { withPage } = await import('../server/cv/browser');

/** Najprostszy PDF z jedną stroną tekstu (Helvetica, same znaki ASCII). */
function tinyPdf(lines: string[]): Uint8Array<ArrayBuffer> {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 11 Tf 50 800 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const POSTING = [
  'Stanowisko: Mlodszy analityk danych',
  'Firma: Przykladowa Spolka z o.o., Warszawa',
  'Obowiazki: przygotowywanie raportow sprzedazowych w Excelu i Power BI,',
  'analiza danych z systemu CRM, wspolpraca z dzialem marketingu.',
  'Wymagania: znajomosc SQL, Excel na poziomie zaawansowanym, jezyk angielski B2.',
  'Oferujemy: umowe o prace, prace hybrydowa, prywatna opieke medyczna.',
];

function serve(body: Uint8Array<ArrayBuffer> | string, type: string | null, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: type ? { 'content-type': type } : {} }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(withPage).mockClear();
});

describe('pobieranie ogłoszenia z linku do pliku', () => {
  it('PDF z nagłówkiem application/pdf: tekst z pliku, nie bajty', async () => {
    serve(tinyPdf(POSTING), 'application/pdf');
    const res = await fetchPosting('https://example.com/oferta.pdf');
    expect(res.method).toBe('pdf');
    expect(res.text).toContain('Mlodszy analityk danych');
    expect(res.text).toContain('Power BI');
    expect(res.text).not.toContain('%PDF');
    expect(res.text).not.toContain('endobj');
    expect(withPage).not.toHaveBeenCalled();
  });

  it('PDF rozpoznany po początku pliku, gdy serwer podaje zły typ', async () => {
    serve(tinyPdf(POSTING), 'application/octet-stream');
    const res = await fetchPosting('https://example.com/download?id=1');
    expect(res.method).toBe('pdf');
    expect(res.text).toContain('SQL');
  });

  it('inny plik (obrazek) i PDF bez tekstu kończą się prośbą o wklejenie treści', async () => {
    serve(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'image/png');
    await expect(fetchPosting('https://example.com/oferta.png')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('wklej') });
    serve(tinyPdf([]), 'application/pdf');
    await expect(fetchPosting('https://example.com/skan.pdf')).rejects.toMatchObject({ status: 422 });
    expect(withPage).not.toHaveBeenCalled();
  });

  it('zwykła strona HTML działa jak dotąd', async () => {
    // Strona musi mieć min. 600 znaków treści, inaczej program uznaje ją za pustą i próbuje przeglądarką.
    const html = `<html><body><main><h1>Analityk danych</h1>${[...POSTING, ...POSTING].map((l) => `<p>${l}</p>`).join('')}</main></body></html>`;
    serve(html, 'text/html; charset=utf-8');
    const res = await fetchPosting('https://example.com/oferta');
    expect(res.method).toBe('html');
    expect(res.text).toContain('Power BI');
  });
});
