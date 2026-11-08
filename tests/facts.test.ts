import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Application } from '../shared/schemas';
import * as fixtures from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-facts-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function setup() {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId() });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'przygotowane', notes: '', currentVersion: 1, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  await store.addVersion(profile.id, app.id, (version) => ({ ...structuredClone(fixtures.cv), version }));
  return { pid: profile.id, aid: app.id };
}

describe('"mam to" w raporcie', () => {
  it('odpowiedź trafia do profilu, a ponowna na ten sam temat ją podmienia', async () => {
    const { pid, aid } = await setup();
    expect(await svc.addFacts(pid, aid, [{ topic: 'Google Ads', answer: 'Kampania na studiach, budżet 500 zł' }])).toBe(1);
    await svc.addFacts(pid, aid, [{ topic: 'google ads', answer: 'Kampania na studiach i kurs Google Skillshop' }]);
    const facts = (await store.getProfile(pid)).extraFacts;
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: svc.answerFactId(aid, 'Google Ads'), has: true, answer: 'Kampania na studiach i kurs Google Skillshop' });
  });

  it('pusta odpowiedź niczego nie zapisuje', async () => {
    const { pid, aid } = await setup();
    expect(await svc.addFacts(pid, aid, [{ topic: 'Google Ads', answer: '  ' }])).toBe(0);
    expect((await store.getProfile(pid)).extraFacts).toEqual([]);
  });
});

describe('zapis CV a profil', () => {
  it('poprawka faktu w CV zmienia profil i mówi, co zmieniła', async () => {
    const { pid, aid } = await setup();
    const content = structuredClone(fixtures.cv.content);
    content.experience[0].company = 'Firma Testowa S.A.';
    const { profileUpdates } = await svc.updateVersion(pid, aid, 1, { content });
    expect(profileUpdates).toEqual(['doświadczenie „Stażystka ds. marketingu”']);
    expect((await store.getProfile(pid)).experience[0].company).toBe('Firma Testowa S.A.');
  });

  it('zmiana szablonu albo decyzji o sugestii nie rusza profilu', async () => {
    const { pid, aid } = await setup();
    const before = await store.getProfile(pid);
    const { profileUpdates } = await svc.updateVersion(pid, aid, 1, { template: 'classic', decisions: { b2: 'accepted' } });
    expect(profileUpdates).toEqual([]);
    expect((await store.getProfile(pid)).updatedAt).toBe(before.updatedAt);
  });
});
