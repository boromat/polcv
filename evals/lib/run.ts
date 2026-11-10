import fs from 'node:fs';
import path from 'node:path';
import { CvContentSchema, type Application, type CvText, type JobPosting } from '../../shared/schemas';
import { errorMessage } from '../../shared/errors';
import * as store from '../../server/storage/store';
import * as svc from '../../server/services';
import { observeCalls, type CallAttempt } from '../../server/llm/openrouter';
import { parsePosting } from '../../server/llm/prompts/parsePosting';
import { educationIssues, sourceIssues, styleIssues } from '../../server/llm/prompts/cvChecks';
import { applyDecisions } from '../../server/llm/prompts/common';
import { renderCvHtml, withoutPending } from '../../server/cv/render';
import { htmlToPdf } from '../../server/cv/pdf';
import { scoreKeywords } from '../../server/ats/keywords';
import { forbiddenInCv, type Violation } from './forbidden';
import type { EvalCase } from './cases';

// Ewaluacja jakości generowania CV: dla każdej pary profil + ogłoszenie ta sama ścieżka co przycisk "Napisz CV"
// (services.generate: pisanie z walidacją i do 3 podejść, liczby z profilu, dopasowanie do jednej strony A4),
// a potem metryki na gotowym CV. UWAGA: CV_DATA_DIR musi wskazywać na tymczasowy folder, zanim ten moduł zostanie wczytany.

export interface CaseResult {
  id: string;
  title: string;
  level: string;
  trap: boolean;
  language: 'pl' | 'en' | null;
  ok: boolean;
  error: string;
  /** podejście pisania CV, które przeszło walidację (1-3); null = nie przeszło żadne */
  acceptedAt: number | null;
  attempts: number;
  /** powody odrzuceń w nieudanych podejściach: wpisy bez źródła w profilu, styl (osoba, forma punktów), brak szkoły, zły format */
  rejected: { unsourced: number; style: number; schools: number; format: number };
  /** CV było za długie i AI je skracało */
  shortened: boolean;
  /** liczby spoza profilu, które kontrola zamieniła w żółte sugestie */
  numbersFlagged: number;
  suggestions: number;
  /** pokrycie słów kluczowych jak w ocenie ATS: punkty / maks. (0-1) */
  keywordCoverage: number | null;
  keywordsMatched: number;
  keywordsTotal: number;
  mustMissing: string[];
  pages: number | null;
  costUsd: number;
  seconds: number;
  forbiddenChecked: boolean;
  forbidden: Violation[];
}

export interface EvalSummary {
  cases: number;
  generated: number;
  /** odsetek wszystkich przypadków: przyjęte w 1., 2. i 3. podejściu oraz nieudane */
  acceptedFirst: number;
  acceptedSecond: number;
  acceptedThird: number;
  failed: number;
  unsourcedCaught: number;
  casesWithUnsourced: number;
  numbersFlagged: number;
  casesWithNumbersFlagged: number;
  keywordCoverage: number | null;
  onePage: number | null;
  shortened: number;
  costPerCv: number | null;
  costTotal: number;
  secondsPerCv: number | null;
  secondsMax: number | null;
  forbiddenCases: number;
  forbiddenAsFact: number;
  forbiddenAsSuggestion: number;
}

export interface EvalResult {
  date: string;
  model: string;
  fastModel: string;
  mock: boolean;
  /** koszt analizy ogłoszeń, gdy nie były jeszcze zamrożone (nie wchodzi do kosztu CV) */
  parseCostUsd: number;
  summary: EvalSummary;
  cases: CaseResult[];
}

export interface EvalOptions {
  model: string;
  fastModel: string;
  cases: EvalCase[];
  outDir: string;
  concurrency?: number;
  /** zapisać ogłoszenia przeanalizowane w tym przebiegu jako posting.parsed.json (zamrożone dla kolejnych modeli) */
  writeParsed?: boolean;
  mock?: boolean;
  log?: (line: string) => void;
}

const NUMBER_REASON = /^Liczba spoza profilu/;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/** Powody odrzucenia jednego podejścia, policzone tymi samymi kontrolami, które odrzuciły odpowiedź modelu. */
function rejectionReasons(a: CallAttempt, c: EvalCase, lang: 'pl' | 'en'): CaseResult['rejected'] {
  const parsed = CvContentSchema.safeParse(a.raw);
  if (!parsed.success) return { unsourced: 0, style: 0, schools: 0, format: 1 };
  return {
    unsourced: sourceIssues(parsed.data, c.profile).length,
    style: styleIssues(parsed.data, lang, undefined, c.profile.pronouns).length,
    schools: educationIssues(parsed.data, c.profile).length,
    format: 0,
  };
}

async function runCase(c: EvalCase, opts: EvalOptions, attempts: Map<string, CallAttempt[]>): Promise<{ result: CaseResult; parseCost: number }> {
  const profile = await store.saveProfile(structuredClone(c.profile));
  let parseCost = 0;
  let posting: JobPosting | null = c.parsed;
  if (!posting) {
    posting = await parsePosting(c.postingText, '', { profileId: profile.id, applicationId: `parse-${c.id}`, task: 'analiza ogłoszenia' });
    parseCost = (attempts.get(`parse-${c.id}`) ?? []).reduce((s, a) => s + a.cost, 0);
    if (opts.writeParsed) fs.writeFileSync(path.join(c.dir, 'posting.parsed.json'), `${JSON.stringify(posting, null, 2)}\n`);
  }
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(),
    profileId: profile.id,
    createdAt: t,
    updatedAt: t,
    url: '',
    rawText: c.postingText,
    fetchMethod: 'wklejony tekst',
    posting,
    gap: null,
    status: 'szkic',
    notes: '',
    currentVersion: 0,
    pdfFile: '',
    hasInterviewPrep: false,
    hasCoverLetter: false,
  };
  await store.saveApplication(app);

  const base: CaseResult = {
    id: c.id,
    title: c.meta.title,
    level: c.meta.level,
    trap: !!c.meta.trap,
    language: null,
    ok: false,
    error: '',
    acceptedAt: null,
    attempts: 0,
    rejected: { unsourced: 0, style: 0, schools: 0, format: 0 },
    shortened: false,
    numbersFlagged: 0,
    suggestions: 0,
    keywordCoverage: null,
    keywordsMatched: 0,
    keywordsTotal: posting.keywords.length,
    mustMissing: [],
    pages: null,
    costUsd: 0,
    seconds: 0,
    forbiddenChecked: c.meta.forbidden.length > 0,
    forbidden: [],
  };

  const started = Date.now();
  let cv;
  try {
    cv = await svc.generate(profile.id, app.id);
  } catch (e) {
    base.error = errorMessage(e);
  }
  base.seconds = (Date.now() - started) / 1000;
  const seen = attempts.get(app.id) ?? [];
  const writing = seen.filter((a) => a.ctx.task === 'pisanie CV');
  base.costUsd = seen.reduce((s, a) => s + a.cost, 0);
  base.attempts = writing.length;
  base.acceptedAt = writing.find((a) => a.accepted)?.attempt ?? null;
  base.shortened = seen.some((a) => a.ctx.task === 'skracanie CV');
  const lang = cv?.content.language ?? posting.language;
  for (const a of writing.filter((x) => !x.accepted)) {
    const r = rejectionReasons(a, c, lang);
    base.rejected.unsourced += r.unsourced;
    base.rejected.style += r.style;
    base.rejected.schools += r.schools;
    base.rejected.format += r.format;
  }
  if (!cv) return { result: base, parseCost };

  const texts: CvText[] = [cv.content.summary, ...cv.content.experience.flatMap((e) => e.bullets), ...cv.content.projects.flatMap((p) => p.bullets)];
  const kw = scoreKeywords(applyDecisions(withoutPending(cv)), posting.keywords);
  const { pages } = await htmlToPdf(renderCvHtml(cv, profile, null, 'pdf'));
  return {
    parseCost,
    result: {
      ...base,
      ok: true,
      language: cv.content.language,
      numbersFlagged: texts.filter((t) => t.status === 'suggested' && NUMBER_REASON.test(t.reason)).length,
      suggestions: texts.filter((t) => t.status === 'suggested').length,
      keywordCoverage: kw.max && posting.keywords.length ? kw.score / kw.max : null,
      keywordsMatched: kw.matched.length,
      mustMissing: kw.missing.filter((m) => m.importance === 'must').map((m) => m.term),
      pages,
      forbidden: forbiddenInCv(cv.content, c.meta.forbidden),
    },
  };
}

const share = (n: number, of: number) => (of ? n / of : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function summarize(cases: CaseResult[]): EvalSummary {
  const ok = cases.filter((c) => c.ok);
  const coverage = ok.map((c) => c.keywordCoverage).filter((x): x is number => x !== null);
  return {
    cases: cases.length,
    generated: ok.length,
    acceptedFirst: share(cases.filter((c) => c.acceptedAt === 1).length, cases.length),
    acceptedSecond: share(cases.filter((c) => c.acceptedAt === 2).length, cases.length),
    acceptedThird: share(cases.filter((c) => c.acceptedAt === 3).length, cases.length),
    failed: share(cases.filter((c) => c.acceptedAt === null).length, cases.length),
    unsourcedCaught: cases.reduce((s, c) => s + c.rejected.unsourced, 0),
    casesWithUnsourced: cases.filter((c) => c.rejected.unsourced > 0).length,
    numbersFlagged: ok.reduce((s, c) => s + c.numbersFlagged, 0),
    casesWithNumbersFlagged: ok.filter((c) => c.numbersFlagged > 0).length,
    keywordCoverage: mean(coverage),
    onePage: ok.length ? share(ok.filter((c) => c.pages === 1).length, ok.length) : null,
    shortened: ok.filter((c) => c.shortened).length,
    costPerCv: mean(ok.map((c) => c.costUsd)),
    costTotal: cases.reduce((s, c) => s + c.costUsd, 0),
    secondsPerCv: mean(ok.map((c) => c.seconds)),
    secondsMax: ok.length ? Math.max(...ok.map((c) => c.seconds)) : null,
    forbiddenCases: cases.filter((c) => c.forbiddenChecked).length,
    forbiddenAsFact: cases.reduce((s, c) => s + c.forbidden.filter((v) => v.status === 'fact').length, 0),
    forbiddenAsSuggestion: cases.reduce((s, c) => s + c.forbidden.filter((v) => v.status === 'suggested').length, 0),
  };
}

const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
const usd = (x: number | null) => (x === null ? '-' : `$${x.toFixed(4)}`);
const sec = (x: number | null) => (x === null ? '-' : `${x.toFixed(1)} s`);

/** Wyniki jednego modelu jako markdown: podsumowanie i tabela przypadków. */
export function toMarkdown(r: EvalResult): string {
  const s = r.summary;
  const lines = [
    `# Ewaluacja: ${r.model}${r.mock ? ' (atrapa modelu)' : ''}`,
    '',
    `Data: ${r.date}. Model pisania CV: \`${r.model}\`. Analiza ogłoszeń: \`${r.fastModel}\`. Przypadków: ${s.cases}.`,
    '',
    '| Miara | Wynik |',
    '|---|---|',
    `| CV przyjęte w 1. / 2. / 3. podejściu | ${pct(s.acceptedFirst)} / ${pct(s.acceptedSecond)} / ${pct(s.acceptedThird)} |`,
    `| Nie powstało (3 odrzucone podejścia albo błąd) | ${pct(s.failed)} |`,
    `| Wpisy bez źródła w profilu odrzucone przez kontrolę | ${s.unsourcedCaught} (w ${s.casesWithUnsourced} przypadkach) |`,
    `| Liczby spoza profilu zamienione w sugestie | ${s.numbersFlagged} (w ${s.casesWithNumbersFlagged} CV) |`,
    `| Pokrycie słów kluczowych (jak w ocenie ATS) | ${pct(s.keywordCoverage)} |`,
    `| CV na jednej stronie A4 | ${pct(s.onePage)} (skracane przez AI: ${s.shortened}) |`,
    `| Zakazane fakty w treści CV / tylko w sugestiach | ${s.forbiddenAsFact} / ${s.forbiddenAsSuggestion} (sprawdzane w ${s.forbiddenCases} przypadkach) |`,
    `| Koszt na CV / razem | ${usd(s.costPerCv)} / ${usd(s.costTotal)} |`,
    `| Czas na CV (średnio / najdłużej) | ${sec(s.secondsPerCv)} / ${sec(s.secondsMax)} |`,
    '',
    '| Przypadek | Podejście | Odrzucone: bez źródła / styl / szkoła / format | Liczby spoza profilu | Słowa kluczowe | Strony | Koszt | Czas | Zakazane fakty |',
    '|---|---|---|---|---|---|---|---|---|',
    ...r.cases.map((c) => {
      const forbidden = !c.forbiddenChecked ? '' : c.forbidden.length ? c.forbidden.map((v) => `${v.foundAs} (${v.status === 'fact' ? 'fakt' : 'sugestia'}, ${v.where})`).join('; ') : 'brak';
      return `| ${c.id} | ${c.acceptedAt ?? `nie (${c.error.slice(0, 60)})`} | ${c.rejected.unsourced} / ${c.rejected.style} / ${c.rejected.schools} / ${c.rejected.format} | ${c.numbersFlagged} | ${pct(c.keywordCoverage)} (${c.keywordsMatched}/${c.keywordsTotal}) | ${c.pages ?? '-'}${c.shortened ? ' (skrócone)' : ''} | ${usd(c.costUsd)} | ${sec(c.seconds)} | ${forbidden} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

/** Porównanie kilku modeli w jednej tabeli (do evals/README.md). */
export function comparisonMarkdown(results: EvalResult[]): string {
  const row = (label: string, f: (s: EvalSummary) => string) => `| ${label} | ${results.map((r) => f(r.summary)).join(' | ')} |`;
  return [
    `| Miara | ${results.map((r) => `\`${r.model}\``).join(' | ')} |`,
    `|---|${results.map(() => '---').join('|')}|`,
    row('CV przyjęte w 1. / 2. / 3. podejściu', (s) => `${pct(s.acceptedFirst)} / ${pct(s.acceptedSecond)} / ${pct(s.acceptedThird)}`),
    row('Nie powstało', (s) => pct(s.failed)),
    row('Wpisy bez źródła odrzucone przez kontrolę', (s) => String(s.unsourcedCaught)),
    row('Liczby spoza profilu zamienione w sugestie', (s) => `${s.numbersFlagged} (w ${s.casesWithNumbersFlagged} CV)`),
    row('Pokrycie słów kluczowych', (s) => pct(s.keywordCoverage)),
    row('CV na jednej stronie A4', (s) => pct(s.onePage)),
    row('Zakazane fakty: w treści / w sugestiach', (s) => `${s.forbiddenAsFact} / ${s.forbiddenAsSuggestion}`),
    row('Koszt na CV', (s) => usd(s.costPerCv)),
    row('Czas na CV', (s) => sec(s.secondsPerCv)),
    '',
  ].join('\n');
}

const slug = (s: string) => s.replace(/[^a-z0-9.-]+/gi, '_');

/** Przebieg dla jednego modelu: wyniki w `outDir` jako <data>_<model>.json i .md. */
export async function runEval(opts: EvalOptions): Promise<{ result: EvalResult; files: string[] }> {
  const log = opts.log ?? (() => {});
  await store.saveSettings({ mainModel: opts.model, fastModel: opts.fastModel, maskPii: false, jobSearch: false, ...(opts.mock ? { apiKey: 'sk-mock' } : {}) });
  const attempts = new Map<string, CallAttempt[]>();
  observeCalls((a) => {
    const key = a.ctx.applicationId ?? '';
    attempts.set(key, [...(attempts.get(key) ?? []), a]);
  });
  const results: CaseResult[] = [];
  let parseCostUsd = 0;
  try {
    await pool(opts.cases, opts.concurrency ?? 3, async (c) => {
      const { result, parseCost } = await runCase(c, opts, attempts);
      parseCostUsd += parseCost;
      results.push(result);
      log(`${c.id}: ${result.ok ? `podejście ${result.acceptedAt}, strony ${result.pages}, $${result.costUsd.toFixed(4)}, ${result.seconds.toFixed(1)} s` : `błąd: ${result.error}`}`);
    });
  } finally {
    observeCalls(null);
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  const result: EvalResult = {
    date: new Date().toISOString().slice(0, 10),
    model: opts.model,
    fastModel: opts.fastModel,
    mock: !!opts.mock,
    parseCostUsd,
    summary: summarize(results),
    cases: results,
  };
  fs.mkdirSync(opts.outDir, { recursive: true });
  const name = `${result.date}_${slug(opts.model)}`;
  const files = [path.join(opts.outDir, `${name}.json`), path.join(opts.outDir, `${name}.md`)];
  fs.writeFileSync(files[0], `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(files[1], toMarkdown(result));
  return { result, files };
}
