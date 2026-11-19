import { afterEach, describe, expect, it, vi } from 'vitest';

// DNS w testach: nazwy z tej tabeli wskazują adresy spoza internetu, każda inna adres publiczny (TEST-NET-3).
// Żaden test nie pyta prawdziwego DNS.
const DNS = vi.hoisted((): Record<string, string> => ({
  'intranet.example': '10.0.0.5',
  'metadata.example': '169.254.169.254',
  'v6.example': 'fd00::1',
  'self.example': '::ffff:127.0.0.1',
}));
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    const address = DNS[host] ?? '203.0.113.10';
    return [{ address, family: address.includes(':') ? 6 : 4 }];
  }),
}));

// Przeglądarka nie jest potrzebna, gdy link prowadzi do pliku - atrapa sprawdza, że nikt jej nie uruchamia.
vi.mock('../server/cv/browser', () => ({
  withPage: vi.fn(async () => {
    throw new Error('przeglądarka nie powinna być uruchamiana');
  }),
}));

const { fetchPosting } = await import('../server/jobs/fetchPosting');
const { withPage } = await import('../server/cv/browser');
const { APP_UA } = await import('../server/jobs/http');
const { VERSION } = await import('../server/version');

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

  it('zwykła strona HTML działa jak dotąd, a program przedstawia się jako PolCV z linkiem do repozytorium', async () => {
    // Strona musi mieć min. 600 znaków treści, inaczej program uznaje ją za pustą i próbuje przeglądarką.
    const html = `<html><body><main><h1>Analityk danych</h1>${[...POSTING, ...POSTING].map((l) => `<p>${l}</p>`).join('')}</main></body></html>`;
    const fetchMock = serve(html, 'text/html; charset=utf-8');
    const res = await fetchPosting('https://example.com/oferta');
    expect(res.method).toBe('html');
    expect(res.text).toContain('Power BI');
    const headers = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(APP_UA);
    expect(APP_UA).toBe(`PolCV/${VERSION} (+https://github.com/boromat/polcv)`);
  });
});

describe('strona, która blokuje automaty', () => {
  it.each([
    ['403', '<html><body>Forbidden</body></html>', 403],
    ['429', '<html><body>Too many requests</body></html>', 429],
    ['weryfikacja Cloudflare przy 200', '<html><head><title>Just a moment...</title></head><body>cf-chl-bypass</body></html>', 200],
  ])('%s: prośba o wklejenie treści, bez drugiej próby przeglądarką', async (_name, html, status) => {
    serve(html, 'text/html', status);
    await expect(fetchPosting('https://example.com/oferta')).rejects.toMatchObject({ status: 422, message: expect.stringContaining('wklej') });
    expect(withPage).not.toHaveBeenCalled();
  });
});

describe('link do ogłoszenia: tylko adresy w internecie (CodeQL js/request-forgery)', () => {
  it.each([
    'http://127.0.0.1:3000/api/settings',
    'http://[::1]/',
    'http://0x7f000001/',
    'http://192.168.1.1/',
    'http://intranet.example/oferta',
    'http://metadata.example/latest/meta-data/',
    'https://v6.example/',
    'https://self.example/',
  ])('%s: nic nie jest pobierane', async (link) => {
    const fetchMock = serve('<html><body>tajne</body></html>', 'text/html');
    await expect(fetchPosting(link)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('sieci lokalnej') });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withPage).not.toHaveBeenCalled();
  });

  it('przekierowanie do sieci lokalnej zatrzymuje pobieranie', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/admin' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPosting('https://example.com/oferta')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('sieci lokalnej') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(withPage).not.toHaveBeenCalled();
  });

  it('przekierowanie do innej strony w internecie działa jak wcześniej', async () => {
    const html = `<html><body><main><h1>Analityk danych</h1>${[...POSTING, ...POSTING].map((l) => `<p>${l}</p>`).join('')}</main></body></html>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/oferta-2' } }))
      .mockResolvedValueOnce(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchPosting('https://example.com/oferta');
    expect(res.method).toBe('html');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://example.com/oferta-2');
  });
});
