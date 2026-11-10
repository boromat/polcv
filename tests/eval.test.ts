import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CvContent } from '../shared/schemas';
import * as fixtures from './fixtures';

// Ewaluacja jakości (evals/) na atrapie modelu: bez płatnego API sprawdzamy, że skrypt przechodzi całą ścieżkę
// generowania i dobrze liczy metryki. Jakość prawdziwych modeli opisuje evals/README.md.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-evaltest-'));
process.env.CV_DATA_DIR = path.join(dir, 'data');
delete process.env.OPENROUTER_API_KEY;

const { mockFetch } = await import('../evals/lib/mock');
const { loadCases } = await import('../evals/lib/cases');
const { runEval, comparisonMarkdown } = await import('../evals/lib/run');
const { forbiddenInCv } = await import('../evals/lib/forbidden');
const { closeBrowser } = await import('../server/cv/browser');

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeBrowser();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('npm run eval na atrapie modelu', () => {
  it('przechodzi całą ścieżkę i liczy podejścia, odrzucenia, liczby spoza profilu, słowa kluczowe, strony i zakazane fakty', async () => {
    // Dwa prawdziwe przypadki ze zbioru; ogłoszenie z fikstur, żeby były słowa kluczowe.
    const cases = loadCases(undefined, ['01', '16']).map((c) => ({ ...c, parsed: structuredClone(fixtures.posting) }));
    const frozen = path.join(cases[0].dir, 'posting.parsed.json');
    const frozenBefore = fs.existsSync(frozen) ? fs.readFileSync(frozen, 'utf8') : null;
    const marketing = cases[0].profile.contact.fullName;
    // Pierwsza odpowiedź: pozycja i umiejętność spoza profilu (kontrola odrzuca); w każdej: punkt z zakazanym faktem
    // (punktów doświadczenia ta kontrola nie sprawdza, więc przechodzi i ma go wyłapać ewaluacja).
    vi.stubGlobal(
      'fetch',
      mockFetch({ invalidFirst: [marketing], extraSkillsFirst: { [marketing]: ['Google Ads'] }, extraBullet: { [marketing]: 'Prowadzenie kampanii Google Ads' } }),
    );
    const outDir = path.join(dir, 'results');
    const { result, files } = await runEval({ model: 'mock/model', fastModel: 'mock/fast', cases, outDir, concurrency: 2, mock: true });

    const [first, second] = result.cases;
    expect(first).toMatchObject({ id: '01-marketing-studentka', ok: true, acceptedAt: 2, attempts: 2, rejected: { unsourced: 1, skills: 1, format: 0 }, pages: 1, language: 'pl' });
    expect(second).toMatchObject({ id: '16-pulapka-bez-liczb', ok: true, acceptedAt: 1, attempts: 1, pages: 1, shortened: false, shortenPasses: 0 });
    // Atrapa wpisuje liczbę spoza profilu: kontrola zamienia ją w żółtą sugestię.
    expect(first.numbersFlagged).toBe(1);
    expect(second.numbersFlagged).toBe(1);
    expect(first.keywordCoverage).toBeGreaterThan(0);
    expect(first.keywordsTotal).toBe(fixtures.posting.keywords.length);
    // "Google Ads" w punkcie doświadczenia: zakazany fakt, który przeszedł; z umiejętności kontrola go usunęła.
    expect(first.forbidden).toEqual([expect.objectContaining({ term: 'Google Ads', status: 'fact', where: 'bullet' })]);
    expect(second.forbiddenChecked).toBe(false);
    expect(first.costUsd).toBeCloseTo(0.002);
    expect(first.seconds).toBeGreaterThan(0);

    expect(result.summary).toMatchObject({ cases: 2, generated: 2, acceptedFirst: 0.5, acceptedSecond: 0.5, acceptedThird: 0, failed: 0, unsourcedCaught: 1, skillsCaught: 1, onePage: 1, forbiddenAsFact: 1 });
    expect(files.map((f) => path.basename(f))).toEqual([`${result.date}_mock_model.json`, `${result.date}_mock_model.md`]);
    expect(JSON.parse(fs.readFileSync(files[0], 'utf8')).summary.cases).toBe(2);
    const md = fs.readFileSync(files[1], 'utf8');
    expect(md).toContain('| CV przyjęte w 1. / 2. / 3. podejściu | 50% / 50% / 0% |');
    expect(md).toContain('Google Ads (fakt, bullet)');
    expect(md).toContain('| 01-marketing-studentka | 2 | 1 / 1 / 0 / 0 / 0 |');
    // Nazwy odrzuconych umiejętności są w wyniku, żeby było widać, co kontrola odrzuciła.
    expect(first.rejectedSkills).toEqual(['Google Ads']);
    expect(md).toMatch(/\| 01-marketing-studentka \|.*\| Google Ads \|$/m);
    expect(comparisonMarkdown([result, { ...result, model: 'inny/model' }])).toContain('| Miara | `mock/model` | `inny/model` |');
    // Drugi przebieg tego samego dnia z opisem nie nadpisuje pierwszego.
    const again = await runEval({ model: 'mock/model', fastModel: 'mock/fast', cases: cases.slice(1), outDir, mock: true, label: 'po-poprawce' });
    expect(again.files.map((f) => path.basename(f))).toEqual([`${result.date}_mock_model_po-poprawce.json`, `${result.date}_mock_model_po-poprawce.md`]);
    expect(fs.existsSync(files[0])).toBe(true);
    expect(fs.readFileSync(again.files[1], 'utf8')).toContain('# Ewaluacja: mock/model (po-poprawce)');
    expect(comparisonMarkdown([result, again.result])).toContain('| Miara | `mock/model` | `mock/model` (po-poprawce) |');
    // Atrapa niczego nie zapisuje w zbiorze przypadków (zamrożone ogłoszenie zostaje takie, jak było).
    expect(fs.existsSync(frozen) ? fs.readFileSync(frozen, 'utf8') : null).toBe(frozenBefore);
  });
});

describe('zakazane fakty', () => {
  const cv = (): CvContent => structuredClone(fixtures.cv.content);
  const docker = [{ term: 'Docker', synonyms: [], why: 'nie ma w profilu' }];

  it('rozróżnia fakt w treści od żółtej sugestii, a bezpieczną wersję sugestii liczy jak fakt', () => {
    const c = cv();
    c.experience[0].bullets[1] = { ...c.experience[0].bullets[1], text: 'Wdrożenie aplikacji w Dockerze', status: 'suggested', fallbackText: 'Wdrożenie aplikacji' };
    expect(forbiddenInCv(c, docker)).toEqual([expect.objectContaining({ foundAs: 'Docker', status: 'suggested', where: 'bullet' })]);
    c.experience[0].bullets[1].fallbackText = 'Praca z Dockerem';
    expect(forbiddenInCv(c, docker).map((v) => v.status)).toEqual(['suggested', 'fact']);
  });

  it('kategoria prawa jazdy: "kat. B" nie pasuje do zakazanego "kat. C"', () => {
    const c = cv();
    c.skills[0].items.push('Prawo jazdy kat. B');
    const ce = [{ term: 'kategorii C', synonyms: ['kat. C', 'C+E'], why: 'tylko kat. B' }];
    expect(forbiddenInCv(c, ce)).toEqual([]);
    c.skills[0].items.push('Prawo jazdy kat. C+E');
    expect(forbiddenInCv(c, ce)).toHaveLength(1);
  });
});
