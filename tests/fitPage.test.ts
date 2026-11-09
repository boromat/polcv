import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application, CvContent } from '../shared/schemas';
import * as fixtures from './fixtures';

// PDF bez przeglądarki: CV ze znacznikiem ZA-DŁUGIE udaje, że wychodzi na dwie strony.
vi.mock('../server/cv/pdf', () => ({
  htmlToPdf: async (html: string) => {
    const long = html.includes('ZA-DŁUGIE');
    return { pdf: Buffer.from(''), pages: long ? 2 : 1, fill: long ? 1.08 : 0.93, text: html.replace(/<[^>]+>/g, '\n') };
  },
}));

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-fit-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');

let replies: string[] = [];
const sent: any[] = [];

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    if (!init?.body) return new Response('{}', { status: 404 }); // lista modeli
    sent.push(JSON.parse(init.body));
    const content = replies.shift();
    if (content === undefined) throw new Error('brak odpowiedzi AI w teście');
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  replies = [];
  sent.length = 0;
});

const longCv = (): CvContent => {
  const c = structuredClone(fixtures.cv.content);
  c.summary.text += ' ZA-DŁUGIE';
  return c;
};

async function setup() {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId() });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'przygotowane', notes: '', currentVersion: 0, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  return { pid: profile.id, aid: app.id };
}

describe('CV na jedną stronę', () => {
  it('CV, które się mieści, idzie bez dodatkowego zapytania do AI', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(fixtures.cv.content)];
    const cv = await svc.generate(pid, aid);
    expect(sent).toHaveLength(1);
    expect(cv.content.summary.text).toBe(fixtures.cv.content.summary.text);
  });

  it('CV na dwie strony AI skraca raz, o tyle, ile wystaje, i zapisuje krótszą wersję', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(longCv()), JSON.stringify(fixtures.cv.content)];
    const cv = await svc.generate(pid, aid);
    expect(sent).toHaveLength(2);
    const system: string = sent[1].messages[0].content;
    expect(system).toContain('SKRACANIE DO JEDNEJ STRONY');
    // 8% za dużo + zapas na nagłówek i klauzulę, które się nie skracają.
    expect(system).toContain('Skróć treść o ok. 18%');
    expect(sent[1].messages[1].content).toContain('ZA-DŁUGIE');
    expect(cv.content.summary.text).not.toContain('ZA-DŁUGIE');
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(cv.version);
  });

  it('"Skróć do 1 strony": skrócona wersja jest nowa i bieżąca, poprzednia zostaje', async () => {
    const { pid, aid } = await setup();
    // Wersja sprzed poprawki: zapisana bez skracania.
    const long = await store.addVersion(pid, aid, (version) => ({ ...structuredClone(fixtures.cv), version, content: longCv() }));
    replies = [JSON.stringify(fixtures.cv.content)];
    const short = await svc.shortenVersion(pid, aid, long.version);
    expect(short).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].messages[0].content).toContain('SKRACANIE DO JEDNEJ STRONY');
    expect(short!.content.summary.text).not.toContain('ZA-DŁUGIE');
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(short!.version);
    expect((await store.getVersion(pid, aid, long.version)).content.summary.text).toContain('ZA-DŁUGIE');
  });

  it('"Synchronizuj z profilem": nowa praca z profilu idzie do AI, wynik to nowa, bieżąca wersja "z profilu"', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(fixtures.cv.content)];
    const first = await svc.generate(pid, aid);
    expect(first.profileIds?.length).toBeGreaterThan(0);
    expect(await svc.syncWithProfile(pid, aid)).toEqual({ version: null, message: 'To CV ma już wszystko z profilu: od tej wersji nic nie doszło.' });

    await store.updateProfile(pid, (p) => {
      p.experience.push({
        id: 'exp-new', kind: 'praca', role: 'Specjalista ds. dokumentacji', company: 'Przykładowa Firma', location: '', start: '2025-08', end: '', current: true,
        description: '', achievements: ['Szablony dokumentów z AI'],
      });
    });
    sent.length = 0;
    replies = [JSON.stringify({ ...fixtures.cv.content, notes: 'Dodano pracę w Przykładowej Firmie.' })];
    const res = await svc.syncWithProfile(pid, aid);
    expect(sent).toHaveLength(1);
    const user: string = sent[0].messages[1].content;
    expect(user.slice(user.indexOf('NOWE W PROFILU'))).toContain('Przykładowa Firma');
    expect(res).toEqual({ version: first.version + 1, message: 'Dodano pracę w Przykładowej Firmie.' });
    const synced = await store.getVersion(pid, aid, res.version!);
    expect(synced.origin).toBe('synced');
    expect(synced.profileIds).toContain('exp-new');
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(res.version);
  });

  it('"Skróć do 1 strony" przy CV, które się mieści: bez AI i bez nowej wersji', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(fixtures.cv.content)];
    const cv = await svc.generate(pid, aid);
    sent.length = 0;
    expect(await svc.shortenVersion(pid, aid, cv.version)).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
