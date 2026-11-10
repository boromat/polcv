import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fixtures from './fixtures';

// Klucze OpenRouter: jedno miejsce na dysku (data/settings.json), pierwszeństwo zmiennej OPENROUTER_API_KEY.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-keys-'));
process.env.CV_DATA_DIR = dir;
delete process.env.OPENROUTER_API_KEY;

const store = await import('../server/storage/store');
const { callJson } = await import('../server/llm/openrouter');
const { settingsRouter } = await import('../server/routes/settings');

const onDisk = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const profileOnDisk = (id: string) => onDisk(`profiles/${id}/profile.json`);
const newProfile = (apiKey = '') => store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId(), apiKey });

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  vi.unstubAllGlobals();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('gdzie leży klucz', () => {
  it('klucz profilu trafia do settings.json, a profile.json zostaje bez niego', async () => {
    const p = await newProfile('sk-or-v1-kolega-0001');
    expect(profileOnDisk(p.id).apiKey).toBe('');
    expect(onDisk('settings.json').profileKeys[p.id]).toBe('sk-or-v1-kolega-0001');
    expect((await store.getProfile(p.id)).apiKey).toBe('sk-or-v1-kolega-0001');
    expect((await store.listProfiles()).find((x) => x.id === p.id)?.apiKey).toBe('sk-or-v1-kolega-0001');

    await store.updateProfile(p.id, (x) => void (x.apiKey = 'sk-or-v1-kolega-0002'));
    expect(profileOnDisk(p.id).apiKey).toBe('');
    expect(onDisk('settings.json').profileKeys[p.id]).toBe('sk-or-v1-kolega-0002');

    // Inne zmiany profilu nie ruszają klucza.
    await store.updateProfile(p.id, (x) => void (x.headline = 'Nowy nagłówek'));
    expect((await store.getProfile(p.id)).apiKey).toBe('sk-or-v1-kolega-0002');

    await store.deleteProfile(p.id);
    expect(onDisk('settings.json').profileKeys[p.id]).toBeUndefined();
  });

  it('migracja: klucz ze starszego profile.json przechodzi do settings.json', async () => {
    const p = await newProfile();
    // Tak zapisywały profil starsze wersje: klucz w profile.json.
    fs.writeFileSync(path.join(dir, 'profiles', p.id, 'profile.json'), JSON.stringify({ ...profileOnDisk(p.id), apiKey: 'sk-or-v1-stary-0001' }));
    expect((await store.getProfile(p.id)).apiKey).toBe('sk-or-v1-stary-0001');

    expect(await store.migrateProfileKeys()).toBe(1);
    expect(profileOnDisk(p.id).apiKey).toBe('');
    expect(onDisk('settings.json').profileKeys[p.id]).toBe('sk-or-v1-stary-0001');
    expect((await store.getProfile(p.id)).apiKey).toBe('sk-or-v1-stary-0001');
    expect(await store.migrateProfileKeys()).toBe(0);
  });
});

describe('OPENROUTER_API_KEY', () => {
  const sentKeys: string[] = [];
  const stubOpenRouter = () =>
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (!init?.body) return new Response('{}', { status: 404 }); // lista modeli
      sentKeys.push(String(init.headers?.Authorization ?? ''));
      return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { cost: 0 } }));
    });
  const call = (profileId: string) => callJson({ schema: z.object({ ok: z.boolean() }), schemaName: 'test', system: 's', user: 'u', tier: 'fast', ctx: { profileId, task: 'test' } });

  it('ma pierwszeństwo przed kluczem z Ustawień i kluczem profilu, i nie trafia na dysk', async () => {
    await store.saveSettings({ apiKey: 'sk-or-v1-ustawienia' });
    const p = await newProfile('sk-or-v1-profil');
    stubOpenRouter();
    sentKeys.length = 0;
    await call(p.id);
    await call('');
    expect(sentKeys).toEqual(['Bearer sk-or-v1-profil', 'Bearer sk-or-v1-ustawienia']);

    process.env.OPENROUTER_API_KEY = 'sk-or-v1-ze-zmiennej';
    sentKeys.length = 0;
    await call(p.id);
    await call('');
    expect(sentKeys).toEqual(['Bearer sk-or-v1-ze-zmiennej', 'Bearer sk-or-v1-ze-zmiennej']);
    await store.saveSettings({ jobSearch: false });
    expect(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).not.toContain('ze-zmiennej');
  });
});

describe('/api/settings', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', settingsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const get = () => fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.json());

  it('nie zwraca kluczy profili, a klucz ze zmiennej tylko zamaskowany', async () => {
    await newProfile('sk-or-v1-profil-tajny');
    await store.saveSettings({ apiKey: 'sk-or-v1-ustawienia' });
    let s = await get();
    expect(s).not.toHaveProperty('profileKeys');
    expect(s).not.toHaveProperty('apiKey');
    expect(JSON.stringify(s)).not.toContain('profil-tajny');
    expect(s).toMatchObject({ hasKey: true, keyFromEnv: false });

    process.env.OPENROUTER_API_KEY = 'sk-or-v1-ze-zmiennej-1234';
    s = await get();
    expect(s.keyFromEnv).toBe(true);
    expect(s.apiKeyMasked).toBe('sk-or-v1…1234');
  });
});
