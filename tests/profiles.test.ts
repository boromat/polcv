import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExtraFact, Profile } from '../shared/schemas';
import * as fixtures from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-profiles-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const { profilesRouter, keepServerFacts } = await import('../server/routes/profiles');
const { langMiddleware } = await import('../server/i18n');
const { withPage, closeBrowser } = await import('../server/cv/browser');
const express = (await import('express')).default;

let server: http.Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', langMiddleware, profilesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500)).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true });
});

const fact = (id: string, answer = 'tak'): ExtraFact => ({ id, topic: `temat ${id}`, has: true, answer, source: 'test', date: '2026-11-01' });
const newProfile = (extraFacts: ExtraFact[] = []) => store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId(), photo: '', extraFacts });

const put = (pid: string, body: unknown) =>
  fetch(`${base}/profiles/${pid}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as Profile & { error?: string },
  }));

describe('autozapis profilu a odpowiedzi dopisane w tym czasie na serwerze', () => {
  it('fakt od doradcy zostaje, fakt usunięty w formularzu znika, edycja z formularza wygrywa', async () => {
    const loaded = await newProfile([fact('a'), fact('b')]);
    // Formularz jest otwarty, a doradca kariery w innej karcie dopisuje odpowiedź.
    await store.updateProfile(loaded.id, (p) => {
      p.extraFacts.push(fact('c', 'od doradcy'));
    });
    // Użytkownik poprawił "a", usunął "b" i dodał własne "d".
    const form = { ...loaded, headline: 'Nowy nagłówek', extraFacts: [fact('a', 'poprawione'), fact('d')], extraFactsBase: ['a', 'b'] };
    const res = await put(loaded.id, form);
    expect(res.status).toBe(200);
    expect(res.body.extraFacts.map((f) => [f.id, f.answer])).toEqual([['a', 'poprawione'], ['d', 'tak'], ['c', 'od doradcy']]);
    const stored = await store.getProfile(loaded.id);
    expect(stored.headline).toBe('Nowy nagłówek');
    expect(stored.extraFacts.map((f) => f.id)).toEqual(['a', 'd', 'c']);
    expect(stored).not.toHaveProperty('extraFactsBase');
  });

  it('formularz, który widział fakt z serwera, może go usunąć', async () => {
    const p = await newProfile([fact('a'), fact('c')]);
    const res = await put(p.id, { ...p, extraFacts: [fact('a')], extraFactsBase: ['a', 'c'] });
    expect(res.body.extraFacts.map((f) => f.id)).toEqual(['a']);
  });

  it('bez extraFactsBase (starszy klient) lista z formularza zastępuje zapisaną', () => {
    expect(keepServerFacts([fact('a'), fact('c')], [fact('a')], undefined).map((f) => f.id)).toEqual(['a']);
    expect(keepServerFacts([fact('a'), fact('c')], [fact('a')], ['a']).map((f) => f.id)).toEqual(['a', 'c']);
    // Śmieci w liście ids są pomijane.
    expect(keepServerFacts([fact('c')], [], [1, null, 'x']).map((f) => f.id)).toEqual(['c']);
  });

  it('zapis bez pola extraFacts nie rusza zapisanych odpowiedzi', async () => {
    const p = await newProfile([fact('a')]);
    const res = await put(p.id, { headline: 'Tylko nagłówek' });
    expect(res.status).toBe(200);
    expect(res.body.extraFacts.map((f) => f.id)).toEqual(['a']);
  });
});

/** Szerokość i wysokość z nagłówka JPG (znacznik SOF). */
function jpegSize(buf: Buffer): { w: number; h: number } {
  expect([buf[0], buf[1]]).toEqual([0xff, 0xd8]);
  for (let i = 2; i < buf.length; ) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('brak znacznika SOF');
}

/** Duże zdjęcie jak z telefonu: gradient z szumem, żeby JPG ważył kilka MB. */
const bigPhoto = (w: number, h: number, type: 'image/jpeg' | 'image/png') =>
  withPage((page) =>
    page.evaluate(
      ({ w, h, type }) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < img.data.length; i += 4) {
          const x = (i / 4) % w;
          img.data[i] = (x * 255) / w + Math.random() * 60;
          img.data[i + 1] = 120 + Math.random() * 60;
          img.data[i + 2] = 200 - Math.random() * 60;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return c.toDataURL(type, 0.95);
      },
      { w, h, type },
    ),
  ).then((url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));

const upload = async (pid: string, data: Buffer, type: string, name: string) => {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(data)], { type }), name);
  const r = await fetch(`${base}/profiles/${pid}/photo`, { method: 'POST', body: form });
  return { status: r.status, body: (await r.json()) as Profile & { error?: string } };
};

describe('zdjęcie profilowe', () => {
  it('duże zdjęcie z telefonu zostaje zmniejszone do ok. 600×750 px i ok. 100 KB', async () => {
    const p = await newProfile();
    const photo = await bigPhoto(3000, 4000, 'image/jpeg');
    expect(photo.length).toBeGreaterThan(1_000_000);
    const res = await upload(p.id, photo, 'image/jpeg', 'IMG_1234.jpg');
    expect(res.status).toBe(200);
    expect(res.body.photo).toBe('photo.jpg');
    const saved = fs.readFileSync(path.join(store.profileDir(p.id), 'photo.jpg'));
    expect(saved.length).toBeLessThan(250_000);
    expect(jpegSize(saved)).toEqual({ w: 600, h: 800 });
  });

  it('PNG w poziomie: krótszy bok wypełnia ramkę, plik zapisany jako JPG, stary plik usunięty', async () => {
    const p = await newProfile();
    fs.mkdirSync(store.profileDir(p.id), { recursive: true });
    fs.writeFileSync(path.join(store.profileDir(p.id), 'photo.png'), 'stare');
    await store.updateProfile(p.id, (x) => {
      x.photo = 'photo.png';
    });
    const res = await upload(p.id, await bigPhoto(2000, 1500, 'image/png'), 'image/png', 'zdjecie.png');
    expect(res.status).toBe(200);
    expect(res.body.photo).toBe('photo.jpg');
    expect(fs.existsSync(path.join(store.profileDir(p.id), 'photo.png'))).toBe(false);
    expect(jpegSize(fs.readFileSync(path.join(store.profileDir(p.id), 'photo.jpg')))).toEqual({ w: 1000, h: 750 });
  });

  it('mały JPG zostaje bez zmian', async () => {
    const p = await newProfile();
    const small = await bigPhoto(300, 375, 'image/jpeg');
    expect(small.length).toBeLessThan(300 * 1024);
    expect((await upload(p.id, small, 'image/jpeg', 'male.jpg')).status).toBe(200);
    expect(fs.readFileSync(path.join(store.profileDir(p.id), 'photo.jpg')).equals(small)).toBe(true);
  });

  it('plik, który nie jest obrazkiem, daje czytelny komunikat (także po angielsku)', async () => {
    const p = await newProfile();
    const res = await upload(p.id, Buffer.alloc(400_000, 7), 'image/png', 'zepsute.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Nie udało się odczytać zdjęcia');
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(400_000)], { type: 'image/webp' }), 'x.webp');
    const en = await fetch(`${base}/profiles/${p.id}/photo`, { method: 'POST', body: form, headers: { 'x-polcv-lang': 'en' } }).then((r) => r.json());
    expect(en.error).toContain('could not be read');
    expect((await store.getProfile(p.id)).photo).toBe('');
  });
});
