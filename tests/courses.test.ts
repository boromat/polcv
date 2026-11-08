import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Application, AtsReport, CourseAdvice } from '../shared/schemas';
import * as fixtures from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-courses-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');

const advice: CourseAdvice = {
  overview: 'Zacznij od Google Ads, bo to wymaganie obowiązkowe.',
  items: [
    { name: 'Google Ads Search Certification', provider: 'Google Skillshop', kind: 'certyfikat', importance: 'must', covers: ['Google Ads'], why: 'Pokrywa wymaganie Google Ads.', cost: 'bezpłatny', time: 'ok. 6 godzin' },
  ],
  alreadyCovered: ['Google Analytics 4'],
};
const sent: any[] = [];

beforeAll(async () => {
  await store.saveSettings({ apiKey: 'sk-test-key' });
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    if (!init?.body) return new Response('{}', { status: 404 }); // lista modeli
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content: JSON.stringify(advice) }, finish_reason: 'stop' }], usage: { cost: 0 } }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function setup(withCv: boolean) {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId() });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting), gap: null, status: 'przygotowane', notes: '', currentVersion: withCv ? 1 : 0, pdfFile: '',
    hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  if (withCv) {
    await store.addVersion(profile.id, app.id, (version) => ({ ...structuredClone(fixtures.cv), version }));
    const report: AtsReport = {
      createdAt: t, version: 1, total: 70, aiError: '', ai: null,
      keywords: { score: 30, max: 40, matched: [], missing: [{ term: 'Google Ads', importance: 'must' }], stuffing: [] },
      format: { score: 20, max: 20, pages: 1, checks: [] },
    };
    await store.saveReport(profile.id, app.id, report);
  }
  return { pid: profile.id, aid: app.id };
}

describe('kursy i certyfikaty pod ogłoszenie', () => {
  it('propozycje biorą braki z ostatniej oceny i zapisują się przy aplikacji', async () => {
    const { pid, aid } = await setup(true);
    expect(await svc.makeCourses(pid, aid)).toEqual(advice);
    expect(sent.at(-1).response_format.json_schema.name).toBe('course_advice');
    const user: string = sent.at(-1).messages[1].content;
    expect(user.slice(user.indexOf('BRAKUJĄCE W CV SŁOWA KLUCZOWE'))).toContain('"Google Ads"');
    expect(await store.getCourses(pid, aid)).toEqual(advice);
    expect((await store.getApplication(pid, aid)).hasCourses).toBe(true);
  });

  it('bez CV nie ma czego proponować', async () => {
    const { pid, aid } = await setup(false);
    await expect(svc.makeCourses(pid, aid)).rejects.toMatchObject({ status: 409 });
  });
});
