import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Ustawienia uruchamiają git, npm i pip. Atrapa child_process zapisuje, co program próbował uruchomić:
// "--status" odpowiada jak most polanonu z Pythonem 3.12, każda inna komenda kończy się sukcesem.
const spawned: string[][] = [];
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    spawn: vi.fn((cmd: string, args: string[]) => {
      spawned.push([cmd, ...args]);
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
      setImmediate(() => {
        if (args.includes('--status')) child.stdout.emit('data', `${JSON.stringify({ python: '3.12.1', polanon: '0.3.0', spacy: false, model: false })}\n`);
        child.emit('close', 0);
      });
      return child;
    }),
  };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-commands-'));
process.env.CV_DATA_DIR = dir;

const { commandLine, requireConfirmed } = await import('../server/commands');
const { updateCommands } = await import('../server/update');
const { hostGuard } = await import('../server/security');
const { langMiddleware } = await import('../server/i18n');
const { settingsRouter } = await import('../server/routes/settings');

let server: http.Server;
let port = 0;

/** Zapytanie do API jak z przeglądarki: Host tego serwera, Origin podany albo ten sam co Host. */
function send(method: string, url: string, body?: unknown, origin = `http://127.0.0.1:${port}`): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path: url, headers: { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const ran = (part: string) => spawned.filter((c) => c.join(' ').includes(part));

beforeAll(async () => {
  // Bez sieci: wersje z PyPI i GitHuba są tu bez znaczenia.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
  const app = express();
  app.use(express.json());
  app.use('/api', langMiddleware);
  app.use('/api', hostGuard);
  app.use('/api', settingsRouter);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  spawned.length = 0;
});

describe('komendy z Ustawień', () => {
  it('zapis do pokazania: części ze spacją w cudzysłowie', () => {
    expect(commandLine(['C:\\Program Files\\Python312\\python.exe', '-m', 'pip', 'install', 'polanon'])).toBe('"C:\\Program Files\\Python312\\python.exe" -m pip install polanon');
    expect(updateCommands()).toEqual(['git pull --ff-only', 'npm install --no-audit --no-fund', 'npm run build']);
  });

  it('potwierdzenie musi zawierać dokładnie te komendy, w tej kolejności', () => {
    const expected = ['a -m pip install x', 'b'];
    expect(() => requireConfirmed(expected, expected)).not.toThrow();
    for (const wrong of [undefined, [], ['a -m pip install x'], ['b', 'a -m pip install x'], [...expected, 'rm -rf /'], 'a -m pip install x']) {
      expect(() => requireConfirmed(expected, wrong)).toThrow(expect.objectContaining({ status: 409 }));
    }
  });

  it('obca strona nie uruchomi aktualizacji ani pip, nawet z poprawnymi komendami', async () => {
    for (const url of ['/api/settings/update', '/api/settings/polanon/install', '/api/settings/polanon/ner']) {
      const res = await send('POST', url, { confirmed: updateCommands() }, 'https://evil.example');
      expect(res.status).toBe(403);
    }
    expect(spawned).toEqual([]);
  });

  it('bez potwierdzenia dokładnych komend nic nie zostaje uruchomione', async () => {
    expect((await send('POST', '/api/settings/update', {})).status).toBe(409);
    expect((await send('POST', '/api/settings/update', { confirmed: ['git pull'] })).status).toBe(409);
    expect(spawned).toEqual([]);
    expect((await send('POST', '/api/settings/polanon/install', { confirmed: ['pip install polanon'] })).status).toBe(409);
    expect((await send('POST', '/api/settings/polanon/ner', {})).status).toBe(409);
    // Program tylko sprawdził, który Python jest dostępny.
    expect(ran(' -m pip')).toEqual([]);
    expect(ran('spacy')).toEqual([]);
  });

  it('po potwierdzeniu uruchamia dokładnie komendy pokazane w Ustawieniach', async () => {
    const status = (await send('GET', '/api/settings/polanon')).body;
    expect(status.installCommands.polanon).toEqual([`${status.command} -m pip install --upgrade polanon`]);
    const res = await send('POST', '/api/settings/polanon/install', { confirmed: status.installCommands.polanon });
    expect(res.status).toBe(200);
    expect(ran(' -m pip').map((c) => commandLine(c))).toEqual(status.installCommands.polanon);
  });
});
