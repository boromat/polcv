import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../storage/store';
import { normalize } from '../ats/keywords';
import { APP_UA } from './http';

export interface Point {
  lat: number;
  lon: number;
}

/** Miasto z Nominatim: współrzędne i relacja OSM ("R1234567"); pusta, gdy wynik nie jest granicą administracyjną. */
export interface Place extends Point {
  osm: string;
}

const cacheFile = () => path.join(DATA_DIR, 'geocache.json');
// Wpisy sprzed zapamiętywania relacji OSM mają same współrzędne (Point).
let cache: Record<string, Place | Point | null> | null = null;

async function loadCache(): Promise<Record<string, Place | Point | null>> {
  if (!cache) cache = JSON.parse(await fs.readFile(cacheFile(), 'utf8').catch(() => '{}'));
  return cache!;
}

/**
 * Współrzędne miasta z OpenStreetMap (Nominatim) - potrzebne do filtra promienia, bo portale go nie mają.
 * Wysyłana jest tylko nazwa miasta; wynik trafia do pamięci podręcznej (jedno zapytanie na miasto).
 */
export function geocodeCity(city: string): Promise<Point | null> {
  return place(city, false);
}

/**
 * Jak geocodeCity, ale także z relacją OSM miasta (filtr miasta w Smart Jobs). Wpis zapamiętany
 * przed dodaniem relacji jest pobierany jeszcze raz, tylko przy pierwszym takim użyciu.
 */
export function geocodePlace(city: string): Promise<Place | Point | null> {
  return place(city, true);
}

function place(city: string, needOsm: boolean): Promise<Place | Point | null> {
  const key = normalize(city);
  if (!key) return Promise.resolve(null);
  // Kilka wyszukiwań naraz pyta o to samo miasto - do Nominatim idzie jedno zapytanie.
  const flight = `${needOsm ? 'osm:' : ''}${key}`;
  if (!inflight.has(flight)) inflight.set(flight, lookup(city, key, needOsm).finally(() => inflight.delete(flight)));
  return inflight.get(flight)!;
}

const inflight = new Map<string, Promise<Place | Point | null>>();

async function lookup(city: string, key: string, needOsm: boolean): Promise<Place | Point | null> {
  const c = await loadCache();
  const known = c[key];
  if (key in c && (!needOsm || known === null || 'osm' in known)) return known;
  // Przy chwilowej odmowie albo błędzie sieci zostaje to, co już wiemy (same współrzędne albo nic).
  const fallback = known ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ city, country: 'Polska', format: 'json', limit: '1' })}`;
    const res = await fetch(url, { headers: { 'User-Agent': APP_UA }, signal: AbortSignal.timeout(10_000) });
    // 429, 403, 503 to chwilowa odmowa, nie brak miasta - nie zapamiętujemy jej.
    if (!res.ok) return fallback;
    const [hit] = (await res.json()) as { lat: string; lon: string; osm_type?: string; osm_id?: number }[];
    c[key] = hit ? { lat: Number(hit.lat), lon: Number(hit.lon), osm: hit.osm_type === 'relation' && hit.osm_id ? `R${hit.osm_id}` : '' } : null;
  } catch {
    return fallback; // błąd sieci nie trafia do pamięci - spróbujemy następnym razem
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(cacheFile(), JSON.stringify(c, null, 1), 'utf8');
  return c[key];
}

/** Odległość w linii prostej (km). */
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
