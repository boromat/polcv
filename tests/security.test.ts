import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRequest, hostGuard, hostnameOf } from '../server/security';
import { langMiddleware, withLang } from '../server/i18n';
import { EN } from '../server/i18n/en';

const ok = (method: string, host: string | undefined, origin?: string, env: NodeJS.ProcessEnv = {}) => checkRequest(method, host, origin, env) === null;

describe('nagłówek Host', () => {
  it('przepuszcza localhost, 127.0.0.1 i [::1] z dowolnym portem', () => {
    for (const h of ['localhost:3000', 'LOCALHOST:3000', 'localhost', '127.0.0.1:3000', '[::1]:3000', '[::1]']) expect(ok('GET', h), h).toBe(true);
  });

  it('odrzuca obce nazwy (DNS rebinding), brak nagłówka i sztuczki w rodzaju "evil@localhost"', () => {
    for (const h of [undefined, '', 'evil.example:3000', 'localhost.evil.example', '192.168.1.20:3000', 'evil.example@localhost:3000', 'localhost/x', 'local host']) {
      expect(ok('GET', h), String(h)).toBe(false);
    }
  });

  it('CV_ALLOWED_HOSTS dopisuje własne nazwy (także ::1 bez nawiasów)', () => {
    const env = { CV_ALLOWED_HOSTS: ' polcv.lan , Moj-Komputer ' };
    expect(ok('GET', 'polcv.lan:3000', undefined, env)).toBe(true);
    expect(ok('GET', 'moj-komputer:3000', undefined, env)).toBe(true);
    expect(ok('GET', 'inny.lan:3000', undefined, env)).toBe(false);
    expect(hostnameOf('::1')).toBe('[::1]');
  });

  it('z CV_HOST przepuszcza adresy IP tego komputera, bez CV_HOST nie', () => {
    const ip = Object.values(os.networkInterfaces())
      .flatMap((l) => l ?? [])
      .find((a) => a.family === 'IPv4' && !a.internal)?.address;
    if (!ip) return; // komputer bez sieci - nie ma czego sprawdzać
    expect(ok('GET', `${ip}:3000`, undefined, { CV_HOST: '0.0.0.0' })).toBe(true);
    expect(ok('GET', `${ip}:3000`, undefined, {})).toBe(false);
    expect(ok('GET', `${os.hostname()}:3000`, undefined, { CV_HOST: '0.0.0.0' })).toBe(true);
  });

  it('komunikat odmowy jest tłumaczony', () => {
    const en = withLang('en', () => checkRequest('GET', 'evil.example', undefined, {}));
    expect(en).toContain('Access denied');
    expect(en).toContain('evil.example');
    expect(Object.values(EN)).toContain(en!.replace('evil.example', '{host}'));
  });
});

describe('nagłówek Origin', () => {
  it('blokuje zapytania zmieniające dane z obcej strony', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(ok(m, 'localhost:3000', 'https://evil.example'), m).toBe(false);
    expect(ok('POST', 'localhost:3000', 'null')).toBe(false);
    expect(ok('POST', '127.0.0.1:3000', 'http://127.0.0.1.evil.example:3000')).toBe(false);
  });

  it('przepuszcza tę samą stronę i zapytania bez Origin', () => {
    expect(ok('POST', 'localhost:3000', 'http://localhost:3000')).toBe(true);
    expect(ok('POST', '[::1]:3000', 'http://[::1]:3000')).toBe(true);
    expect(ok('POST', 'localhost:3000')).toBe(true);
    expect(ok('POST', 'polcv.lan:3000', 'http://polcv.lan:3000', { CV_ALLOWED_HOSTS: 'polcv.lan' })).toBe(true);
    expect(ok('POST', 'polcv.lan:3000', 'http://inna.lan:3000', { CV_ALLOWED_HOSTS: 'polcv.lan,inna.lan' })).toBe(false);
  });

  it('GET i HEAD nie są blokowane przez Origin (tylko przez Host)', () => {
    expect(ok('GET', 'localhost:3000', 'https://evil.example')).toBe(true);
    expect(ok('HEAD', 'localhost:3000', 'https://evil.example')).toBe(true);
  });

  it('npm run dev: Vite zmienia Host na localhost:3000, a Origin zostaje z portu 5173', () => {
    expect(ok('POST', 'localhost:3000', 'http://localhost:5173')).toBe(true);
    expect(ok('POST', 'localhost:3000', 'http://127.0.0.1:5173')).toBe(true);
    expect(ok('POST', 'localhost:3000', 'http://[::1]:5173')).toBe(true);
  });
});

// ---------- Prawdziwe zapytania: Express z hostGuard i serwer Vite z tym samym proxy co w vite.config.ts ----------

function send(port: number, opts: { method?: string; host?: string; origin?: string; lang?: string }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.host !== undefined) headers.host = opts.host;
    if (opts.origin) headers.origin = opts.origin;
    if (opts.lang) headers['x-polcv-lang'] = opts.lang;
    const req = http.request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: '/api/ping', headers }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(opts.method && opts.method !== 'GET' ? '{}' : undefined);
  });
}

let api: http.Server;
let apiPort = 0;
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | null = null;
let vitePort = 0;
const viteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-vite-'));

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', langMiddleware);
  app.use('/api', hostGuard);
  app.all('/api/ping', (req, res) => res.json({ ok: true, host: req.headers.host, origin: req.headers.origin ?? null }));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message }));
  api = app.listen(0, '127.0.0.1');
  await new Promise((r) => api.once('listening', r));
  apiPort = (api.address() as AddressInfo).port;

  const { createServer } = await import('vite');
  vite = await createServer({
    configFile: false,
    root: viteRoot,
    logLevel: 'silent',
    appType: 'custom',
    // Ten sam skrót co w vite.config.ts ("'/api': 'http://localhost:3000'"), tylko z portem testowego serwera.
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://localhost:${apiPort}` }, hmr: false, watch: null },
  });
  await vite.listen();
  vitePort = (vite.httpServer!.address() as AddressInfo).port;
});

afterAll(async () => {
  await vite?.close();
  await new Promise((r) => api.close(r));
  fs.rmSync(viteRoot, { recursive: true, force: true });
});

describe('middleware na żywym serwerze', () => {
  it('odpowiada 403 z przetłumaczonym komunikatem', async () => {
    const pl = await send(apiPort, { host: 'evil.example:3000' });
    expect(pl.status).toBe(403);
    expect(pl.body.error).toContain('Odmowa dostępu');
    const en = await send(apiPort, { method: 'POST', host: `localhost:${apiPort}`, origin: 'https://evil.example', lang: 'en' });
    expect(en.status).toBe(403);
    expect(en.body.error).toContain('Access denied');
  });

  it('przepuszcza zwykłe zapytania z przeglądarki', async () => {
    expect((await send(apiPort, { host: `localhost:${apiPort}` })).status).toBe(200);
    expect((await send(apiPort, { method: 'POST', host: `127.0.0.1:${apiPort}`, origin: `http://127.0.0.1:${apiPort}` })).status).toBe(200);
  });

  it('npm run dev: zapytanie przez proxy Vite przechodzi, obca strona nie', async () => {
    const res = await send(vitePort, { method: 'POST', host: `localhost:${vitePort}`, origin: `http://localhost:${vitePort}` });
    expect(res.status).toBe(200);
    // Proxy Vite zmienia Host (changeOrigin), ale zostawia Origin przeglądarki.
    expect(res.body).toMatchObject({ host: `localhost:${apiPort}`, origin: `http://localhost:${vitePort}` });
    expect((await send(vitePort, { host: `localhost:${vitePort}` })).status).toBe(200);
    expect((await send(vitePort, { method: 'POST', host: `localhost:${vitePort}`, origin: 'https://evil.example' })).status).toBe(403);
  });
});
