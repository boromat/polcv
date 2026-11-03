import os from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './storage/store';
import { tr } from './i18n';

/**
 * Ochrona API bez logowania:
 * - Host: odpowiadamy tylko pod localhost / 127.0.0.1 / [::1]. Strona z cudzą domeną, która po "DNS rebinding"
 *   wskazuje na ten komputer, wysyła swój Host i dostaje 403, więc nie odczyta profilu ani nie wyda kredytu OpenRouter.
 * - Origin: zapytanie zmieniające dane (POST/PUT/PATCH/DELETE) z innej strony niż PolCV dostaje 403
 *   (np. formularz na obcej stronie, który próbuje uruchomić `pip install`).
 * Z CV_HOST (dostęp z sieci lokalnej) dochodzą adresy IP tego komputera i jego nazwa. Inne nazwy, pod którymi
 * otwierasz PolCV (np. `polcv.lan`), dopisz po przecinku w CV_ALLOWED_HOSTS - ta lista działa zawsze.
 * `npm run dev`: Vite przekazuje /api z portu 5173 i zmienia Host na localhost:3000, a Origin zostaje
 * http://localhost:5173 - dlatego, gdy oba adresy są lokalne, port nie musi się zgadzać.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Nazwa hosta bez portu, małymi literami (IPv6 w nawiasach); null, gdy wartość jest pusta albo niepoprawna. */
export function hostnameOf(host: string | undefined | null): string | null {
  const h = host?.trim();
  // Host to sama nazwa albo adres z portem - bez "@", "/" i spacji, które URL potraktowałby inaczej niż przeglądarka.
  if (!h || !/^[a-z0-9._\-:[\]]+$/i.test(h)) return null;
  try {
    // "::1" bez nawiasów (np. w CV_ALLOWED_HOSTS) to też poprawny zapis adresu.
    const withBrackets = h.includes(':') && !h.startsWith('[') && h.split(':').length > 2 ? `[${h}]` : h;
    return new URL(`http://${withBrackets}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const isLoopback = (name: string) => LOOPBACK.has(name);

/** Adresy i nazwa tego komputera - przy CV_HOST dostęp z sieci lokalnej idzie właśnie pod nie. */
function ownNames(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      const n = hostnameOf(a.family === 'IPv6' ? `[${a.address}]` : a.address);
      if (n) out.push(n);
    }
  }
  const name = os.hostname().toLowerCase();
  if (name) out.push(name, `${name}.local`);
  return out;
}

export function isAllowedHost(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isLoopback(hostname)) return true;
  const extra = (env.CV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => hostnameOf(h))
    .filter((h): h is string => !!h);
  if (extra.includes(hostname)) return true;
  return !!env.CV_HOST && ownNames().includes(hostname);
}

/** Czy Origin wskazuje na tę samą stronę co Host (dla adresów lokalnych wystarczy, że oba są lokalne). */
export function isSameOrigin(origin: string, host: string): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false; // np. "null" z pliku albo ramki sandbox
  }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  if (o.host.toLowerCase() === host.trim().toLowerCase()) return true;
  const h = hostnameOf(host);
  return !!h && isLoopback(h) && isLoopback(o.hostname.toLowerCase());
}

/** Sprawdzenie Host i Origin; zwraca komunikat odmowy albo null. Komunikat powstaje w chwili zapytania (tr). */
export function checkRequest(method: string, host: string | undefined, origin: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = hostnameOf(host);
  if (!name || !isAllowedHost(name, env)) {
    return tr('Odmowa dostępu: PolCV przyjmuje zapytania tylko pod adresem localhost, a to przyszło pod adres {host}. Jeśli otwierasz program pod inną nazwą, dopisz ją w zmiennej CV_ALLOWED_HOSTS.', { host: String(host ?? '') });
  }
  if (method !== 'GET' && method !== 'HEAD' && origin !== undefined && !isSameOrigin(origin, host!)) {
    return tr('Odmowa dostępu: zapytanie z innej strony ({origin}) zostało zablokowane.', { origin });
  }
  return null;
}

export function hostGuard(req: Request, _res: Response, next: NextFunction) {
  const denied = checkRequest(req.method, req.headers.host, req.headers.origin);
  next(denied ? new HttpError(403, denied) : undefined);
}
