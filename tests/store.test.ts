import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Application, CareerTurn, CvContent, JobLead, RoleProposal } from '../shared/schemas';
import * as fixtures from './fixtures';

// AI i portale zastępujemy atrapami - testy sprawdzają tylko zapis danych przy długich wywołaniach.
vi.mock('../server/llm/prompts/generateCv', () => ({ generateCv: vi.fn(), improveCv: vi.fn() }));
vi.mock('../server/llm/prompts/career', () => ({ careerTurn: vi.fn(), proposeRoles: vi.fn(), rankOffers: vi.fn() }));
vi.mock('../server/jobs/search', () => ({ searchRole: vi.fn() }));

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-store-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');
const career = await import('../server/career');
const gen = await import('../server/llm/prompts/generateCv');
const prompts = await import('../server/llm/prompts/career');
const search = await import('../server/jobs/search');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(gen.generateCv).mockReset();
  vi.mocked(prompts.careerTurn).mockReset();
  vi.mocked(prompts.rankOffers).mockReset();
  vi.mocked(search.searchRole).mockReset();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const newProfile = () => store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId(), extraFacts: [] });

const newApp = (profileId: string, patch: Partial<Application> = {}) => {
  const t = store.nowIso();
  return store.saveApplication({
    id: store.newId(), profileId, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'szkic', notes: '', currentVersion: 0, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false, ...patch,
  });
};

describe('zapis plików JSON', () => {
  it('równoległe zapisy tego samego pliku zostawiają poprawny JSON i ostatnią wersję', async () => {
    const p = await newProfile();
    const file = path.join(store.profileDir(p.id), 'career.json');
    for (let round = 0; round < 40; round++) {
      // Różne długości: przy wspólnym pliku tymczasowym krótszy zapis zostawiał "ogon" dłuższego.
      await Promise.all(Array.from({ length: 6 }, (_, i) => store.saveCareer(p.id, { ...store.emptyCareer(), summary: `r${round}-${i};`.repeat(400 - i * 60) })));
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(saved.summary).toBe(`r${round}-5;`.repeat(100));
    }
    expect(fs.readdirSync(store.profileDir(p.id)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('ponawia rename, gdy Windows na chwilę blokuje plik (EPERM/EBUSY)', async () => {
    const real = fsp.rename;
    let fails = 2;
    const spy = vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (fails-- > 0) throw Object.assign(new Error('zablokowany'), { code: fails % 2 ? 'EPERM' : 'EBUSY' });
      return real(from, to);
    });
    const s = await store.saveSettings({ fastModel: 'test/model' });
    expect(s.fastModel).toBe('test/model');
    expect(spy).toHaveBeenCalledTimes(3);
    expect((await store.getSettings()).fastModel).toBe('test/model');
  });

  it('nieudany zapis nie zostawia pliku tymczasowego i nie psuje poprzedniej wersji', async () => {
    const p = await newProfile();
    vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('brak dostępu'), { code: 'ENOSPC' }));
    await expect(store.saveProfile({ ...p, headline: 'nowy' })).rejects.toThrow('brak dostępu');
    vi.restoreAllMocks();
    expect((await store.getProfile(p.id)).headline).toBe(p.headline);
    expect(fs.readdirSync(store.profileDir(p.id)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('równoległe updateCareer nie gubią swoich zmian', async () => {
    const p = await newProfile();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.updateCareer(p.id, (c) => {
          c.chat.push({ role: 'user', content: `m${i}`, at: store.nowIso() });
        }),
      ),
    );
    const c = await store.getCareer(p.id);
    expect(c.chat.map((m) => m.content).sort()).toEqual(Array.from({ length: 25 }, (_, i) => `m${i}`).sort());
  });

  it('błąd w funkcji zmiany nic nie zapisuje i zwalnia blokadę', async () => {
    const p = await newProfile();
    await expect(store.updateProfile(p.id, () => Promise.reject(new Error('stop')))).rejects.toThrow('stop');
    const next = await store.updateProfile(p.id, (x) => {
      x.headline = 'po błędzie';
    });
    expect(next.headline).toBe('po błędzie');
  });

  it('lista profili pomija uszkodzony plik zamiast przerywać', async () => {
    const ok = await newProfile();
    const broken = await newProfile();
    fs.writeFileSync(path.join(store.profileDir(broken.id), 'profile.json'), '{"id": "x", "displayName": ');
    fs.writeFileSync(path.join(dir, 'profiles', 'zwykly-plik.txt'), 'nie katalog');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ids = (await store.listProfiles()).map((p) => p.id);
    expect(ids).toContain(ok.id);
    expect(ids).not.toContain(broken.id);
    expect(warn).toHaveBeenCalled();
    // Pojedynczy odczyt mówi, który plik jest uszkodzony.
    await expect(store.getProfile(broken.id)).rejects.toThrow(/profile\.json/);
    fs.rmSync(store.profileDir(broken.id), { recursive: true, force: true });
  });

  it('lista aplikacji i wersji pomija uszkodzone pliki', async () => {
    const p = await newProfile();
    const good = await newApp(p.id);
    const bad = await newApp(p.id);
    fs.writeFileSync(path.join(store.appDir(p.id, bad.id), 'application.json'), 'oops');
    await store.saveVersion(p.id, good.id, { ...fixtures.cv, version: 1 });
    fs.writeFileSync(path.join(store.appDir(p.id, good.id), 'cv.v2.json'), '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await store.listApplications(p.id)).map((a) => a.id)).toEqual([good.id]);
    expect((await store.listVersions(p.id, good.id)).map((v) => v.version)).toEqual([1]);
    // Nowa wersja nie nadpisuje nieczytelnego cv.v2.json.
    const added = await store.addVersion(p.id, good.id, (version) => ({ ...fixtures.cv, version }));
    expect(added.version).toBe(3);
  });

  it('równoległe addVersion dostają różne numery', async () => {
    const p = await newProfile();
    const app = await newApp(p.id);
    const list = await Promise.all(Array.from({ length: 5 }, () => store.addVersion(p.id, app.id, (version) => ({ ...fixtures.cv, version }))));
    expect(list.map((v) => v.version).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('długie wywołania AI nie cofają równoległych zmian', () => {
  const content = (): CvContent => structuredClone(fixtures.cv.content);

  it('generate: notatka i status zapisane w trakcie pisania CV zostają', async () => {
    const p = await newProfile();
    const app = await newApp(p.id);
    const gate = deferred<CvContent>();
    vi.mocked(gen.generateCv).mockImplementation(() => gate.promise);
    const running = svc.generate(p.id, app.id, 'pl');
    await vi.waitFor(() => expect(gen.generateCv).toHaveBeenCalled());
    await store.updateApplication(p.id, app.id, (a) => {
      a.notes = 'zadzwonić w piątek';
      a.status = 'wysłane';
    });
    gate.resolve(content());
    const cv = await running;
    expect(await store.getApplication(p.id, app.id)).toMatchObject({ notes: 'zadzwonić w piątek', status: 'wysłane', currentVersion: cv.version });
  });

  it('generate: bez zmian w trakcie szkic przechodzi w "przygotowane"', async () => {
    const p = await newProfile();
    const app = await newApp(p.id);
    vi.mocked(gen.generateCv).mockResolvedValue(content());
    const cv = await svc.generate(p.id, app.id, 'pl');
    expect(await store.getApplication(p.id, app.id)).toMatchObject({ status: 'przygotowane', currentVersion: cv.version });
  });

  const role = (id: string): RoleProposal => ({ id, title: `Stanowisko ${id}`, fit: 'wysokie', seniority: 'junior', why: '', gaps: [], howToClose: '', keywords: ['marketing'] });
  const lead = (id: string): JobLead => ({
    id, portal: 'pracuj', title: `Oferta ${id}`, company: 'Firma', location: 'Kraków', workModes: [], workTime: '', salary: '', salaryMonthly: null,
    contracts: [], seniority: '', skills: [], url: `https://example.com/${id}`, publishedAt: '2026-01-01', match: null, matchReason: '', excludedBy: '',
  });
  const found = (id: string) => ({ kept: [lead(`${id}-1`)], excluded: [], stats: {}, errors: [], scanned: 1 });

  async function withProposals() {
    const p = await newProfile();
    await store.saveSettings({ jobSearch: true });
    await store.saveCareer(p.id, { ...store.emptyCareer('Kraków'), proposals: { createdAt: '2026-01-01T00:00:00.000Z', intro: '', roles: [role('r1'), role('r2')] } });
    vi.mocked(prompts.rankOffers).mockResolvedValue({ ranked: [] });
    return p;
  }

  it('findOffers: dwa równoległe wyszukiwania zapisują oba wyniki', async () => {
    const p = await withProposals();
    const gates = { r1: deferred<ReturnType<typeof found>>(), r2: deferred<ReturnType<typeof found>>() };
    vi.mocked(search.searchRole).mockImplementation((r) => gates[r.id as 'r1' | 'r2'].promise as any);
    const one = career.findOffers(p.id, 'r1');
    const two = career.findOffers(p.id, 'r2');
    await vi.waitFor(() => expect(search.searchRole).toHaveBeenCalledTimes(2));
    gates.r2.resolve(found('r2'));
    await two;
    gates.r1.resolve(found('r1'));
    await one;
    const c = await store.getCareer(p.id);
    expect(Object.keys(c.offers).sort()).toEqual(['r1', 'r2']);
    expect(c.offers.r1.items[0].id).toBe('r1-1');
  });

  it('findOffers: wynik dla starych propozycji jest pomijany', async () => {
    const p = await withProposals();
    const gate = deferred<ReturnType<typeof found>>();
    vi.mocked(search.searchRole).mockImplementation(() => gate.promise as any);
    const running = career.findOffers(p.id, 'r1');
    await vi.waitFor(() => expect(search.searchRole).toHaveBeenCalled());
    await store.updateCareer(p.id, (c) => {
      c.proposals = { createdAt: '2026-02-01T00:00:00.000Z', intro: 'nowe', roles: [role('r1')] };
      c.offers = {};
    });
    gate.resolve(found('r1'));
    const res = await running;
    expect(res.offers).toEqual({});
    expect((await store.getCareer(p.id)).proposals?.intro).toBe('nowe');
  });

  const turn = (): CareerTurn => ({
    reply: 'Opowiedz więcej o stażu.',
    done: false,
    prefs: { ...store.emptyCareer('Kraków').prefs, remote: false },
    newFacts: [{ topic: 'Excel', answer: 'Tabele przestawne w raportach sprzedaży' }],
    summary: 'Szuka pracy w marketingu.',
  });

  it('chat: zmiana profilu w trakcie odpowiedzi AI zostaje, a fakty się dopisują', async () => {
    const p = await newProfile();
    const gate = deferred<CareerTurn>();
    vi.mocked(prompts.careerTurn).mockImplementation(() => gate.promise);
    const running = career.chat(p.id, 'Szukam pracy w marketingu');
    await vi.waitFor(() => expect(prompts.careerTurn).toHaveBeenCalled());
    // Wiadomość kandydata jest zapisana, zanim AI odpowie.
    expect((await store.getCareer(p.id)).chat.map((m) => m.role)).toEqual(['user']);
    await store.updateProfile(p.id, (x) => {
      x.headline = 'Zmienione w trakcie';
    });
    gate.resolve(turn());
    const c = await running;
    expect(c.chat.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(c.prefs.remote).toBe(false);
    const profile = await store.getProfile(p.id);
    expect(profile.headline).toBe('Zmienione w trakcie');
    expect(profile.extraFacts.map((f) => f.topic)).toEqual(['Excel']);
  });

  it('chat: odpowiedź na rozmowę wyczyszczoną w trakcie jest pomijana', async () => {
    const p = await newProfile();
    const gate = deferred<CareerTurn>();
    vi.mocked(prompts.careerTurn).mockImplementation(() => gate.promise);
    const running = career.chat(p.id, 'Pierwsza wiadomość');
    await vi.waitFor(() => expect(prompts.careerTurn).toHaveBeenCalled());
    await career.resetChat(p.id);
    gate.resolve(turn());
    const c = await running;
    expect(c.chat).toEqual([]);
  });
});
