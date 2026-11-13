import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-geo-'));
process.env.CV_DATA_DIR = dir;

const { geocodeCity, geocodePlace } = await import('../server/jobs/geocode');

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
    expect(await geocodeCity('Kraków')).toEqual({ lat: 50.06, lon: 19.94, osm: '' });
    expect(Object.values(cached())).toEqual([{ lat: 50.06, lon: 19.94, osm: '' }]);
    expect(await geocodeCity('Kraków')).toEqual({ lat: 50.06, lon: 19.94, osm: '' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('zapamiętuje relację OSM miasta (filtr miasta w Smart Jobs), a punkt bez granicy zostawia ją pustą', async () => {
    nominatim({ status: 200, body: [{ lat: '52.53', lon: '17.6', osm_type: 'relation', osm_id: 2905441 }] }, { status: 200, body: [{ lat: '52.1', lon: '20.6', osm_type: 'node', osm_id: 77 }] });
    expect(await geocodePlace('Gniezno')).toEqual({ lat: 52.53, lon: 17.6, osm: 'R2905441' });
    expect(await geocodePlace('Mała Wieś')).toEqual({ lat: 52.1, lon: 20.6, osm: '' });
  });

  it('prawdziwy brak wyniku zostaje w pamięci (bez kolejnych zapytań)', async () => {
    const fetchMock = nominatim({ status: 200, body: [] });
    expect(await geocodeCity('Nieistniejące Miasto')).toBeNull();
    expect(await geocodeCity('Nieistniejące Miasto')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.values(cached())).toContain(null);
  });
});

describe('pamięć geokodowania sprzed relacji OSM', () => {
  it('stary wpis (same współrzędne) wystarcza do promienia, a dla filtra miasta jest pobierany raz ponownie', async () => {
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-geo-old-'));
    const { normalize } = await import('../server/ats/keywords');
    fs.writeFileSync(path.join(oldDir, 'geocache.json'), JSON.stringify({ [normalize('Konin')]: { lat: 52.22, lon: 18.25 } }));
    process.env.CV_DATA_DIR = oldDir;
    vi.resetModules();
    const geo = await import('../server/jobs/geocode');
    try {
      const fetchMock = nominatim({ status: 429 }, { status: 200, body: [{ lat: '52.22', lon: '18.25', osm_type: 'relation', osm_id: 2700 }] });
      expect(await geo.geocodeCity('Konin')).toEqual({ lat: 52.22, lon: 18.25 });
      expect(fetchMock).toHaveBeenCalledTimes(0);
      // Chwilowa odmowa: zostają znane współrzędne, bez relacji.
      expect(await geo.geocodePlace('Konin')).toEqual({ lat: 52.22, lon: 18.25 });
      expect(await geo.geocodePlace('Konin')).toEqual({ lat: 52.22, lon: 18.25, osm: 'R2700' });
      expect(await geo.geocodePlace('Konin')).toEqual({ lat: 52.22, lon: 18.25, osm: 'R2700' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      process.env.CV_DATA_DIR = dir;
      fs.rmSync(oldDir, { recursive: true, force: true });
    }
  });
});
