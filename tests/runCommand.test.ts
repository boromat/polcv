import { describe, expect, it } from 'vitest';
import { runCommand } from '../server/commands';

// Wspólne uruchamianie programów (aktualizacja PolCV, pip dla polanonu) na prawdziwym procesie Node.
const node = [process.execPath];

describe('runCommand', () => {
  it('zwraca kod wyjścia i oba strumienie osobno', async () => {
    const r = await runCommand(node, ['-e', 'console.log("wynik"); console.error("ostrzeżenie"); process.exit(3)'], { timeoutMs: 20_000 });
    expect(r).toEqual({ code: 3, stdout: 'wynik\n', stderr: 'ostrzeżenie\n' });
  });

  it('brak programu: code null i opis błędu zamiast wyjątku', async () => {
    const r = await runCommand(['polcv-nie-ma-takiego-programu'], [], { timeoutMs: 20_000 });
    expect(r.code).toBeNull();
    expect(r.stderr).toMatch(/ENOENT/);
  });

  it('po przekroczeniu czasu proces jest zatrzymany', async () => {
    const started = Date.now();
    const r = await runCommand(node, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 });
    expect(r.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
