import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-python-'));
process.env.CV_DATA_DIR = dir;

const { checkPythonPath, polanonStatus } = await import('../server/privacy/polanon');
const store = await import('../server/storage/store');
const { settingsRouter } = await import('../server/routes/settings');
const { langMiddleware, withLang } = await import('../server/i18n');
const express = (await import('express')).default;

const win = process.platform === 'win32';
const pythonName = win ? 'python.exe' : 'python3';
// Pusty plik o nazwie Pythona - do sprawdzenia ścieżki wystarczy, nie jest uruchamiany.
const fakePython = path.join(dir, 'Python312', pythonName);
fs.mkdirSync(path.dirname(fakePython), { recursive: true });
fs.writeFileSync(fakePython, '');
const notPython = path.join(dir, win ? 'calc.exe' : 'bash');
fs.writeFileSync(notPython, '');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const error = (raw: string, platform?: NodeJS.Platform) => {
  const r = withLang('pl', () => checkPythonPath(raw, platform));
  return r.ok ? null : r.error;
};

describe('ścieżka do Pythona w Ustawieniach', () => {
  it('puste pole = wykrywanie automatyczne', () => {
    expect(checkPythonPath('')).toEqual({ ok: true, path: '' });
    expect(checkPythonPath('   ')).toEqual({ ok: true, path: '' });
    expect(checkPythonPath('""')).toEqual({ ok: true, path: '' });
  });

  it('przyjmuje istniejący plik Pythona, także w cudzysłowie z "Kopiuj jako ścieżkę"', () => {
    expect(checkPythonPath(fakePython)).toEqual({ ok: true, path: fakePython });
    expect(checkPythonPath(`  "${fakePython}"  `)).toEqual({ ok: true, path: fakePython });
    expect(checkPythonPath(`'${fakePython}'`)).toEqual({ ok: true, path: fakePython });
  });

  it('odrzuca ścieżki względne i sieciowe (UNC)', () => {
    for (const p of ['python.exe', 'tools\\python.exe', '.\\python.exe', '\\\\serwer\\udzial\\python.exe', '//serwer/udzial/python.exe', '\\Python312\\python.exe']) {
      expect(error(p, 'win32'), p).toContain('pełną ścieżkę');
    }
    for (const p of ['python3', 'bin/python3', '//serwer/udzial/python3', 'C:\\Python312\\python.exe']) {
      expect(error(p, 'linux'), p).toContain('pełną ścieżkę');
    }
  });

  it('odrzuca pliki, które nie są Pythonem', () => {
    expect(error(notPython)).toContain('to nie Python');
    for (const p of ['C:\\Windows\\System32\\cmd.exe', 'C:\\Tools\\pythonw.exe', 'C:\\x\\python.exe.bat', 'C:\\x\\python']) expect(error(p, 'win32'), p).toContain('to nie Python');
    for (const p of ['/bin/sh', '/usr/bin/python.exe', '/usr/bin/py']) expect(error(p, 'linux'), p).toContain('to nie Python');
  });

  it('akceptuje typowe nazwy Pythona', () => {
    // Nazwa przechodzi, więc zostaje tylko brak pliku.
    for (const p of ['C:\\P\\python.exe', 'C:\\P\\PYTHON.EXE', 'C:\\P\\python3.exe', 'C:\\P\\python3.12.exe', 'C:\\Windows\\nie-ma\\py.exe', 'D:/P/python.exe']) {
      expect(error(p, 'win32'), p).toContain('Nie znaleziono pliku');
    }
    for (const p of ['/nie-ma/python', '/nie-ma/python3', '/nie-ma/python3.12']) expect(error(p, 'linux'), p).toContain('Nie znaleziono pliku');
  });

  it('wymaga istniejącego pliku (katalog się nie liczy)', () => {
    expect(error(path.join(dir, 'brak', pythonName))).toContain('Nie znaleziono pliku');
    const folder = path.join(dir, 'folder', pythonName);
    fs.mkdirSync(folder, { recursive: true });
    expect(error(folder)).toContain('Nie znaleziono pliku');
  });

  it('polanon nie uruchamia błędnej ścieżki wpisanej ręcznie w settings.json', async () => {
    const status = await withLang('pl', () => polanonStatus({ ...store.DEFAULT_SETTINGS, pythonPath: notPython }));
    expect(status.python).toBeNull();
    expect(status.command).toBeNull();
    expect(status.error).toContain('to nie Python');
  });
});

describe('PUT /api/settings', () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', langMiddleware, settingsRouter);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const put = (body: unknown, lang = 'pl') =>
    fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-polcv-lang': lang }, body: JSON.stringify(body) }).then(
      async (r) => ({ status: r.status, body: await r.json() }),
    );

  it('zapisuje poprawną ścieżkę bez cudzysłowów', async () => {
    const res = await put({ pythonPath: `"${fakePython}"` });
    expect(res.status).toBe(200);
    expect(res.body.pythonPath).toBe(fakePython);
    expect((await store.getSettings()).pythonPath).toBe(fakePython);
  });

  it('odrzuca złą ścieżkę kodem 400 i nic nie zapisuje', async () => {
    const res = await put({ pythonPath: notPython, jobSearch: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('to nie Python');
    const en = await put({ pythonPath: '\\\\serwer\\udzial\\python.exe' }, 'en');
    expect(en.status).toBe(400);
    expect(en.body.error).toContain('Enter the full path');
    const saved = await store.getSettings();
    expect(saved.pythonPath).toBe(fakePython);
    expect(saved.jobSearch).toBe(false);
  });

  it('puste pole wraca do wykrywania automatycznego', async () => {
    const res = await put({ pythonPath: '' });
    expect(res.status).toBe(200);
    expect((await store.getSettings()).pythonPath).toBe('');
  });
});
