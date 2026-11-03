import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../storage/store';
import { normalize } from '../ats/keywords';
import { APP_UA } from './http';

export interface Point {
  lat: number;
  lon: number;
}

const cacheFile = () => path.join(DATA_DIR, 'geocache.json');
let cache: Record<string, Point | null> | null = null;

async function loadCache(): Promise<Record<string, Point | null>> {
  if (!cache) cache = JSON.parse(await fs.readFile(cacheFile(), 'utf8').catch(() => '{}'));
  return cache!;
}

/**
 * Współrzędne miasta z OpenStreetMap (Nominatim) - potrzebne, bo nofluffjobs nie ma filtra promienia.
 * Wysyłana jest tylko nazwa miasta; wynik trafia do pamięci podręcznej (jedno zapytanie na miasto).
 */
export async function geocodeCity(city: string): Promise<Point | null> {
  const key = normalize(city);
  if (!key) return null;
  // Kilka wyszukiwań naraz pyta o to samo miasto - do Nominatim idzie jedno zapytanie.
  if (!inflight.has(key)) inflight.set(key, lookup(city, key).finally(() => inflight.delete(key)));
  return inflight.get(key)!;
}

const inflight = new Map<string, Promise<Point | null>>();

async function lookup(city: string, key: string): Promise<Point | null> {
  const c = await loadCache();
  if (key in c) return c[key];
  try {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ city, country: 'Polska', format: 'json', limit: '1' })}`;
    const res = await fetch(url, { headers: { 'User-Agent': APP_UA }, signal: AbortSignal.timeout(10_000) });
    const [hit] = res.ok ? ((await res.json()) as { lat: string; lon: string }[]) : [];
    c[key] = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  } catch {
    return null; // błąd sieci nie trafia do pamięci - spróbujemy następnym razem
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
