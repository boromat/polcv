import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-geo-'));
process.env.CV_DATA_DIR = dir;

const { geocodeCity } = await import('../server/jobs/geocode');

const cached = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'geocache.json'), 'utf8'));
  } catch {
    return {};
  }
};

function nominatim(...replies: { status: number; body?: unknown }[]) {
  const fetchMock = vi.fn(async () => {
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body ?? { error: 'odmowa' }), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('geokodowanie miasta (Nominatim)', () => {
  it('chwilowa odmowa (429, 403, 503) nie zapisuje miasta jako nieistniejącego', async () => {
    const fetchMock = nominatim({ status: 429 }, { status: 503 }, { status: 403 }, { status: 200, body: [{ lat: '50.06', lon: '19.94' }] });
    for (let i = 0; i < 3; i++) expect(await geocodeCity('Kraków')).toBeNull();
    expect(Object.keys(cached())).toEqual([]);
    // Następna próba pyta ponownie i zapamiętuje wynik.
    expect(await geocodeCity('Kraków')).toEqual({ lat: 50.06, lon: 19.94 });
    expect(Object.values(cached())).toEqual([{ lat: 50.06, lon: 19.94 }]);
    expect(await geocodeCity('Kraków')).toEqual({ lat: 50.06, lon: 19.94 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('prawdziwy brak wyniku zostaje w pamięci (bez kolejnych zapytań)', async () => {
    const fetchMock = nominatim({ status: 200, body: [] });
    expect(await geocodeCity('Nieistniejące Miasto')).toBeNull();
    expect(await geocodeCity('Nieistniejące Miasto')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.values(cached())).toContain(null);
  });
});
