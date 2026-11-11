import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Ewaluacja próbnej rozmowy (evals/interview) na atrapie modelu: bez płatnego API sprawdzamy przypadki, przebieg rozmowy
// przez kod aplikacji i miary. Jakość prawdziwego modelu opisuje evals/README.md.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-evalinterview-'));
process.env.CV_DATA_DIR = path.join(dir, 'data');
delete process.env.OPENROUTER_API_KEY;

const { mockFetch } = await import('../evals/lib/mock');
const { AnswerTypes, loadInterviewCases, runInterviewEval } = await import('../evals/lib/interview');
const { closeBrowser } = await import('../server/cv/browser');

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('przypadki próbnej rozmowy', () => {
  it('każdy ma parę z zamrożonym ogłoszeniem, a razem pokrywają wszystkie rodzaje odpowiedzi', () => {
    const cases = loadInterviewCases();
    expect(cases.length).toBeGreaterThanOrEqual(5);
    for (const c of cases) {
      expect(c.base.parsed, c.id).not.toBeNull();
      const types = new Set(Object.values(c.meta.answers).map((a) => a.type));
      // W każdej rozmowie: dobra, ogólnikowa (z odpowiedzią na dopytanie) i z błędem merytorycznym.
      expect([...types], c.id).toEqual(expect.arrayContaining(['good', 'vague', 'factual-error']));
      expect(Object.values(c.meta.answers).filter((a) => a.type === 'vague').every((a) => !!a.followUp), c.id).toBe(true);
    }
    const all = new Set(cases.flatMap((c) => Object.values(c.meta.answers).map((a) => a.type)));
    expect([...all].sort()).toEqual([...AnswerTypes].sort());
  });
});

describe('npm run eval -- --interview na atrapie modelu', () => {
  it('przechodzi rozmowę przez kod aplikacji i liczy dopytania, błędy, wyniki, wymyślone fakty, koszt i czas', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const cases = loadInterviewCases(undefined, ['01', '09']);
    const outDir = path.join(dir, 'results');
    const { result, files } = await runInterviewEval({ model: 'mock/model', cases, outDir, mock: true });

    const [pl, en] = result.cases;
    expect(pl).toMatchObject({ id: '01-marketing', ok: true, language: 'pl', questions: 7 });
    expect(en).toMatchObject({ id: '09-frontend-en', ok: true, language: 'en', questions: 7 });
    // Ogólnikowa odpowiedź dostaje dopytanie, a błąd merytoryczny jest wskazany (atrapa rozpoznaje go po słowach).
    expect(pl.answers.find((a) => a.type === 'vague')).toMatchObject({ followUp: true });
    expect(pl.answers.find((a) => a.type === 'factual-error')).toMatchObject({ factualErrors: 1 });
    expect(result.summary).toMatchObject({
      cases: 2,
      completed: 2,
      vagueFollowUp: { asked: 2, total: 2 },
      // Atrapa dopytuje też po krótkiej dobrej odpowiedzi bez liczb (domyślna odpowiedź w 09): miara to pokazuje.
      goodFollowUp: { asked: 1, total: 6 },
      factualFlagged: { flagged: 2, total: 2 },
      goodAboveVague: { yes: 2, total: 2 },
      fabricated: 0,
      rejected: 0,
    });
    expect(result.summary.scoreByType.good).toBeGreaterThan(result.summary.scoreByType.vague!);
    // Plan, 7 ocen, 1 ocena po dopytaniu i podsumowanie po $0,001.
    expect(pl.costUsd).toBeCloseTo(0.01);
    expect(pl.seconds).toBeGreaterThan(0);

    expect(files.map((f) => path.basename(f))).toEqual([`${result.date}_mock_model_interview.json`, `${result.date}_mock_model_interview.md`]);
    const md = fs.readFileSync(files[1], 'utf8');
    expect(md).toContain('| Ogólnikowa odpowiedź dostała dopytanie | 2 z 2 |');
    expect(md).toContain('| Wymyślone fakty w mocniejszych wersjach | 0 |');
    expect(md).toMatch(/\| 01-marketing \| pl \| 7 \|/);
  });
});
