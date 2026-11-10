// Ewaluacja jakości generowania CV.
//   npm run eval -- --model <id> [--fast-model <id>] [--cases 01,02] [--concurrency 3] [--out evals/results]
//   npm run eval -- --mock            atrapa modelu zamiast OpenRouter (bez kosztów; sprawdza skrypt, nie model)
//   npm run eval -- --report          tabela porównawcza wszystkich wyników z evals/results
// Klucz: zmienna OPENROUTER_API_KEY (nie trafia na dysk). Dane robocze w folderze tymczasowym, nie w data/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'fast-model': { type: 'string', default: 'anthropic/claude-haiku-5.5' },
    cases: { type: 'string', default: '' },
    concurrency: { type: 'string', default: '3' },
    out: { type: 'string' },
    mock: { type: 'boolean', default: false },
    report: { type: 'boolean', default: false },
  },
});

const RESULTS = path.resolve(import.meta.dirname, 'results');

async function report(): Promise<void> {
  const { comparisonMarkdown } = await import('./lib/run');
  const files = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')) : [];
  const results = files.map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'))).filter((r) => !r.mock);
  if (!results.length) throw new Error(`Brak wyników w ${RESULTS}. Najpierw: npm run eval -- --model <id>`);
  console.log(comparisonMarkdown(results));
}

async function main(): Promise<void> {
  if (values.report) return report();
  const mock = values.mock;
  const model = values.model ?? (mock ? 'mock/model' : '');
  if (!model) throw new Error('Podaj model: npm run eval -- --model <id> (albo --mock).');
  if (!mock && !process.env.OPENROUTER_API_KEY?.trim()) throw new Error('Ustaw zmienną OPENROUTER_API_KEY (klucz nie jest zapisywany na dysku).');

  // Przed wczytaniem modułów serwera: zapis tylko do folderu tymczasowego.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-eval-'));
  process.env.CV_DATA_DIR = work;
  try {
    if (mock) globalThis.fetch = (await import('./lib/mock')).mockFetch();
    const { loadCases } = await import('./lib/cases');
    const { runEval, toMarkdown } = await import('./lib/run');
    const only = values.cases ? values.cases.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const cases = loadCases(undefined, only);
    if (!cases.length) throw new Error('Nie znaleziono przypadków.');
    console.log(`Model: ${model}, przypadków: ${cases.length}${mock ? ' (atrapa modelu, bez kosztów)' : ''}`);
    const { result, files } = await runEval({
      model,
      fastModel: values['fast-model']!,
      cases,
      // Wyniki atrapy nie mieszają się z prawdziwymi w evals/results.
      outDir: values.out ? path.resolve(values.out) : mock ? path.join(os.tmpdir(), 'polcv-eval-mock') : RESULTS,
      concurrency: Math.max(1, Number(values.concurrency) || 3),
      // Ogłoszenia analizujemy raz i zamrażamy, żeby każdy model dostał to samo; atrapa niczego nie zapisuje.
      writeParsed: !mock,
      mock,
      log: (line) => console.log(`  ${line}`),
    });
    console.log(`\n${toMarkdown(result)}`);
    if (result.parseCostUsd) console.log(`Analiza ogłoszeń (raz, zamrożona): $${result.parseCostUsd.toFixed(4)}`);
    console.log(`Zapisano: ${files.join(', ')}`);
  } finally {
    const { closeBrowser } = await import('../server/cv/browser');
    await closeBrowser();
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
