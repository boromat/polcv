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

  it('CV na dwie strony AI skraca o tyle, ile wystaje (raz, gdy to wystarczy), i zapisuje krótszą wersję', async () => {
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

  it('gdy po skróceniu CV dalej wystaje, AI skraca drugi raz, od skróconej wersji', async () => {
    const { pid, aid } = await setup();
    const stillLong = longCv();
    stillLong.summary.text = 'Studiuję marketing. PIERWSZE-SKRÓCENIE ZA-DŁUGIE';
    replies = [JSON.stringify(longCv()), JSON.stringify(stillLong), JSON.stringify(fixtures.cv.content)];
    const cv = await svc.generate(pid, aid);
    expect(sent).toHaveLength(3);
    expect(sent[2].messages[0].content).toContain('SKRACANIE DO JEDNEJ STRONY');
    expect(sent[2].messages[1].content).toContain('PIERWSZE-SKRÓCENIE');
    expect(cv.content.summary.text).not.toContain('ZA-DŁUGIE');
  });

  it('po dwóch skróceniach CV zostaje, jakie jest: bez trzeciego zapytania do AI', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(longCv()), JSON.stringify(longCv()), JSON.stringify(longCv())];
    const cv = await svc.generate(pid, aid);
    expect(sent).toHaveLength(3);
    expect(cv.content.summary.text).toContain('ZA-DŁUGIE');
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

  /** CV z ręczną poprawką kandydata w podsumowaniu (podsumowanie nie przechodzi do profilu). */
  async function editedCv(pid: string, aid: string, summary = 'Studiuję marketing i sama poprawiłam to podsumowanie.') {
    replies = [JSON.stringify(fixtures.cv.content)];
    const first = await svc.generate(pid, aid);
    await store.saveVersion(pid, aid, { ...first, content: { ...first.content, summary: { ...first.content.summary, text: summary } } });
    sent.length = 0;
    return first;
  }

  it('"Synchronizuj z profilem": nowa praca z profilu idzie do AI, reszta CV zostaje z poprawkami kandydata', async () => {
    const { pid, aid } = await setup();
    const first = await editedCv(pid, aid);
    expect(first.profileIds?.length).toBeGreaterThan(0);
    expect(first.profileEntries?.experience.map((e) => e.id)).toEqual(['exp1']);
    expect(await svc.syncWithProfile(pid, aid)).toEqual({ version: null, message: 'To CV ma już wszystko z profilu: od tej wersji nic nie doszło.' });

    await store.updateProfile(pid, (p) => {
      p.experience.push({
        id: 'exp-new', kind: 'praca', role: 'Specjalista ds. dokumentacji', company: 'Przykładowa Firma', location: '', start: '2025-08', end: '', current: true,
        description: '', achievements: ['Szablony dokumentów z AI'],
      });
    });
    const current = await store.getVersion(pid, aid, first.version);
    const job = { sourceId: 'exp-new', role: 'Specjalista ds. dokumentacji', company: 'Przykładowa Firma', location: '', dates: '08.2025 - obecnie', bullets: [{ id: 'n1', text: 'Tworzenie szablonów dokumentów z AI', status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp-new'] }] };
    // AI przy okazji przepisuje podsumowanie: to ma nie przejść.
    replies = [JSON.stringify({ ...current.content, summary: { ...current.content.summary, text: 'Studiuję marketing i pracuję z dokumentacją.' }, experience: [job, ...current.content.experience], notes: 'Dodano pracę w Przykładowej Firmie.' })];
    const res = await svc.syncWithProfile(pid, aid);
    expect(sent).toHaveLength(1);
    const user: string = sent[0].messages[1].content;
    expect(user.slice(user.indexOf('NOWE W PROFILU'))).toContain('Przykładowa Firma');
    expect(res.version).toBe(first.version + 1);
    expect(res.message).toContain('Dodano pracę w Przykładowej Firmie.');
    const synced = await store.getVersion(pid, aid, res.version!);
    expect(synced.origin).toBe('synced');
    expect(synced.content.summary.text).toBe('Studiuję marketing i sama poprawiłam to podsumowanie.');
    expect(synced.content.experience.map((e) => e.sourceId)).toEqual(['exp-new', 'exp1']);
    expect(synced.profileIds?.some((s) => s.startsWith('exp-new#'))).toBe(true);
    expect(synced.profileEntries?.experience.map((e) => e.id)).toEqual(['exp1', 'exp-new']);
    expect((await store.getApplication(pid, aid)).currentVersion).toBe(res.version);
  });

  it('"Synchronizuj z profilem": zmienione stanowisko wchodzi bez AI, a za długiego CV nic samo nie skraca', async () => {
    const { pid, aid } = await setup();
    const first = await editedCv(pid, aid, 'Studiuję marketing i sama poprawiłam to podsumowanie. ZA-DŁUGIE');
    await store.updateProfile(pid, (p) => {
      p.experience[0].role = 'Specjalistka ds. marketingu';
    });
    const res = await svc.syncWithProfile(pid, aid);
    expect(sent).toHaveLength(0);
    expect(res.version).toBe(first.version + 1);
    expect(res.message).toContain('Poprawione według profilu: Specjalistka ds. marketingu.');
    expect(res.message).toContain('Skróć do 1 strony');
    const synced = await store.getVersion(pid, aid, res.version!);
    expect(synced.content.experience[0].role).toBe('Specjalistka ds. marketingu');
    expect(synced.content.experience[0].bullets.map((b) => b.text)).toEqual(first.content.experience[0].bullets.map((b) => b.text));
    expect(synced.content.summary.text).toContain('sama poprawiłam');
    expect(await svc.profileNewsCount(await store.getProfile(pid), await store.getApplication(pid, aid))).toBe(0);
  });

  it('"Synchronizuj z profilem": gdy nic z nowości nie pasuje, nie ma nowej wersji, a licznik się zeruje', async () => {
    const { pid, aid } = await setup();
    const first = await editedCv(pid, aid);
    await store.updateProfile(pid, (p) => {
      p.skills.push({ id: 's9', name: 'Spawanie MIG', category: 'inne', level: '' });
    });
    const current = await store.getVersion(pid, aid, first.version);
    replies = [JSON.stringify({ ...current.content, notes: 'Spawanie nie pasuje do tego ogłoszenia.' })];
    const res = await svc.syncWithProfile(pid, aid);
    expect(sent).toHaveLength(1);
    expect(res).toEqual({ version: null, message: 'Spawanie nie pasuje do tego ogłoszenia.' });
    expect((await store.listVersions(pid, aid)).map((v) => v.version)).toEqual([first.version]);
    expect(await svc.profileNewsCount(await store.getProfile(pid), await store.getApplication(pid, aid))).toBe(0);
  });

  it('polecenie dla AI: idzie do modelu dosłownie, wynik to nowa, bieżąca wersja; puste polecenie jest odrzucane', async () => {
    const { pid, aid } = await setup();
    replies = [JSON.stringify(fixtures.cv.content)];
    const first = await svc.generate(pid, aid);
    await expect(svc.instructVersion(pid, aid, first.version, '   ')).rejects.toMatchObject({ status: 400 });
    sent.length = 0;
    replies = [JSON.stringify({ ...fixtures.cv.content, notes: 'Dodano praktyki.' })];
    const res = await svc.instructVersion(pid, aid, first.version, 'dodaj praktyki zawodowe z mojego profilu');
    expect(sent).toHaveLength(1);
    expect(sent[0].messages[0].content).toContain('POLECENIE KANDYDATA');
    expect(sent[0].messages[1].content).toContain('dodaj praktyki zawodowe z mojego profilu');
    expect(res).toEqual({ version: first.version + 1, message: 'Dodano praktyki.' });
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
