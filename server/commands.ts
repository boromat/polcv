import { spawn } from 'node:child_process';
import { HttpError } from './storage/store';
import { tr } from './i18n';

// Ustawienia mogą uruchomić programy na tym komputerze (git i npm przy aktualizacji PolCV, pip przy polanonie).
// Serwer ustala dokładne komendy, interfejs pokazuje je przed uruchomieniem, a serwer uruchamia je tylko wtedy,
// gdy zapytanie zawiera dokładnie te potwierdzone komendy. Obce strony odcina wcześniej hostGuard (security.ts).

/** Komenda do pokazania: części ze spacją w cudzysłowie, np. "C:\Program Files\Python312\python.exe" -m pip …. */
export const commandLine = (parts: string[]) => parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');

export interface RunOptions {
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Windows: npm to skrypt .cmd, który bez powłoki się nie uruchomi. */
  shell?: boolean;
}

/** Uruchamia program i czeka na koniec; nigdy nie rzuca (błąd startu = code null i opis w stderr). */
export function runCommand(cmd: string[], args: string[], opts: RunOptions): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: opts.cwd, env: opts.env, shell: opts.shell, windowsHide: true });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr ? `${stderr}\n${e.message}` : e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Rzuca 409, gdy `confirmed` to nie dokładnie te komendy, które serwer zaraz uruchomi (nic nie zostaje uruchomione). */
export function requireConfirmed(expected: string[], confirmed: unknown): void {
  const same = Array.isArray(confirmed) && confirmed.length === expected.length && confirmed.every((c, i) => c === expected[i]);
  if (!same) {
    throw new HttpError(409, tr('Program uruchamia polecenia dopiero po potwierdzeniu dokładnie tych komend. Odśwież stronę i potwierdź je ponownie.'));
  }
}
