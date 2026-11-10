import { HttpError } from './storage/store';
import { tr } from './i18n';

// Ustawienia mogą uruchomić programy na tym komputerze (git i npm przy aktualizacji PolCV, pip przy polanonie).
// Serwer ustala dokładne komendy, interfejs pokazuje je przed uruchomieniem, a serwer uruchamia je tylko wtedy,
// gdy zapytanie zawiera dokładnie te potwierdzone komendy. Obce strony odcina wcześniej hostGuard (security.ts).

/** Komenda do pokazania: części ze spacją w cudzysłowie, np. "C:\Program Files\Python312\python.exe" -m pip …. */
export const commandLine = (parts: string[]) => parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');

/** Rzuca 409, gdy `confirmed` to nie dokładnie te komendy, które serwer zaraz uruchomi (nic nie zostaje uruchomione). */
export function requireConfirmed(expected: string[], confirmed: unknown): void {
  const same = Array.isArray(confirmed) && confirmed.length === expected.length && confirmed.every((c, i) => c === expected[i]);
  if (!same) {
    throw new HttpError(409, tr('Program uruchamia polecenia dopiero po potwierdzeniu dokładnie tych komend. Odśwież stronę i potwierdź je ponownie.'));
  }
}
