import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Atrapa Playwright: test sprawdza tylko, co serwer robi, gdy Chromium nie startuje albo się rozłącza.
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

const { chromium } = await import('playwright');
const { withPage, closeBrowser } = await import('../server/cv/browser');
const launch = vi.mocked(chromium.launch);

function fakeBrowser() {
  const b = Object.assign(new EventEmitter(), {
    newContext: vi.fn(async () => ({ newPage: async () => ({}), close: async () => {} })),
    close: vi.fn(async () => {}),
  });
  return b;
}

afterEach(async () => {
  await closeBrowser();
  launch.mockReset();
});

describe('współdzielona przeglądarka Chromium', () => {
  it('błąd startu daje czytelny komunikat, nie kończy procesu i pozwala spróbować ponownie', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      launch.mockRejectedValue(new Error("Executable doesn't exist"));
      await expect(withPage(async () => 'x')).rejects.toThrow(/npx playwright install chromium/);
      await expect(withPage(async () => 'x')).rejects.toThrow(/Executable doesn't exist/);
      // Każde zapytanie po błędzie próbuje uruchomić Chromium od nowa (np. po doinstalowaniu).
      expect(launch).toHaveBeenCalledTimes(2);
      launch.mockResolvedValue(fakeBrowser() as any);
      expect(await withPage(async () => 'działa')).toBe('działa');
      // Daj czas na ewentualne "unhandled rejection" z osieroconej obietnicy.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('po rozłączeniu przeglądarki kolejne zapytanie uruchamia nową', async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    launch.mockResolvedValueOnce(first as any).mockResolvedValueOnce(second as any);
    await withPage(async () => null);
    await withPage(async () => null);
    expect(launch).toHaveBeenCalledTimes(1);
    first.emit('disconnected');
    await withPage(async () => null);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(second.newContext).toHaveBeenCalledTimes(1);
  });
});
