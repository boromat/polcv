import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Application, CvContent, CvText, MockInterview, MockQuestionKinds, Profile } from '../../shared/schemas';
import * as store from '../../server/storage/store';
import * as mock from '../../server/mockInterview';
import { countPhrase, tokenize } from '../../server/ats/keywords';
import { knownNumbers, numberFinder, numberedNames, profileTexts } from '../../server/llm/prompts/cvChecks';
import { candidateAnswers } from '../../server/llm/prompts/mockInterview';
import { observeCalls } from '../../server/llm/openrouter';
import { ForbiddenSchema, loadCase, CASES_DIR, type EvalCase } from './cases';

// Ewaluacja próbnej rozmowy: fikcyjni kandydaci z gotowymi odpowiedziami według rodzaju pytania (dobra z liczbami,
// ogólnikowa, z błędem merytorycznym, przechwałka bez pokrycia w profilu, zbyt długa). Rozmowa idzie przez ten sam kod
// co w aplikacji (server/mockInterview.ts); profil i zamrożone ogłoszenie biorą pary z evals/cases.

export const INTERVIEW_DIR = path.resolve(import.meta.dirname, '..', 'interview', 'cases');

export const AnswerTypes = ['good', 'vague', 'factual-error', 'brag', 'too-long'] as const;
export type AnswerType = (typeof AnswerTypes)[number];

const AnswerSchema = z.object({ type: z.enum(AnswerTypes), text: z.string().min(1), followUp: z.string().optional() });
type Kind = (typeof MockQuestionKinds)[number];

export const InterviewCaseSchema = z.object({
  /** para z evals/cases, z której biorą się profil i zamrożone ogłoszenie */
  base: z.string().min(1),
  title: z.string().min(1),
  /** odpowiedzi według rodzaju pytania z planu; "default" dla rodzajów bez własnej odpowiedzi */
  answers: z.record(z.string(), AnswerSchema).refine((a) => !!a.default, 'brak odpowiedzi "default"'),
  companyQuestions: z.string().min(1),
  /** fakty, których profil ani odpowiedzi nie mają: w mocniejszych wersjach być ich nie może */
  forbidden: z.array(ForbiddenSchema).default([]),
});
export type InterviewCaseMeta = z.infer<typeof InterviewCaseSchema>;

export interface InterviewCase {
  id: string;
  meta: InterviewCaseMeta;
  base: EvalCase;
}

export function loadInterviewCases(dir = INTERVIEW_DIR, only: string[] = []): InterviewCase[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), file: path.join(dir, f) }))
    .filter((c) => !only.length || only.some((o) => c.id === o || c.id.startsWith(`${o}-`)))
    .map((c) => {
      const meta = InterviewCaseSchema.parse(JSON.parse(fs.readFileSync(c.file, 'utf8')));
      return { id: c.id, meta, base: loadCase(path.join(CASES_DIR, meta.base)) };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** CV z samych faktów profilu (bez AI): rozmowa ocenia odpowiedzi, a nie CV, więc wystarczy wierna kopia profilu. */
export function profileCv(p: Profile, lang: 'pl' | 'en'): CvContent {
  const fact = (id: string, text: string, sourceIds: string[]): CvText => ({ id, text, status: 'fact', reason: '', fallbackText: '', sourceIds });
  return {
    language: lang,
    headline: p.headline,
    summary: fact('s', p.summary, []),
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills', 'languages'],
    experience: p.experience.map((e) => ({ sourceId: e.id, role: e.role, company: e.company, location: e.location, dates: '', bullets: e.achievements.map((a, i) => fact(`${e.id}b${i}`, a, [e.id])) })),
    projects: p.projects.map((x) => ({ sourceId: x.id, name: x.name, role: x.role, dates: '', technologies: x.technologies, link: x.link, bullets: x.achievements.map((a, i) => fact(`${x.id}b${i}`, a, [x.id])) })),
    education: p.education.map((e) => ({ sourceId: e.id, school: e.school, degree: e.degree, field: e.field, dates: '', details: e.details })),
    skills: p.skills.length ? [{ category: lang === 'pl' ? 'Umiejętności' : 'Skills', items: p.skills.map((s) => s.name) }] : [],
    certificates: p.certificates.map((c) => ({ name: c.name, issuer: c.issuer, date: c.date })),
    languages: p.languages.map((l) => ({ name: l.name, level: l.level })),
    interests: [],
    notes: '',
  };
}

export interface AnswerResult {
  questionId: string;
  kind: string;
  type: AnswerType;
  /** wynik pierwszej odpowiedzi na pytanie (przed dopytaniem) */
  score: number | null;
  lengthScore: number | null;
  followUp: boolean;
  factualErrors: number;
  /** wymyślone fakty w mocniejszych wersjach tego pytania: zakazane nazwy i liczby spoza profilu, CV i odpowiedzi */
  fabricated: string[];
  /** mocniejsze wersje tego pytania (do wglądu; starsze wyniki ich nie mają) */
  stronger?: string[];
  /** oceny tego pytania bez mocniejszej wersji (kontrola faktów odrzuciła ją 3 razy) */
  strongerFailed?: number;
}

export interface InterviewCaseResult {
  id: string;
  title: string;
  language: 'pl' | 'en' | null;
  ok: boolean;
  error: string;
  questions: number;
  answers: AnswerResult[];
  average: number | null;
  costUsd: number;
  seconds: number;
  /** odrzucone odpowiedzi modelu (mocniejsza wersja, plan, dopytanie) i ich powody */
  rejected: number;
}

export interface InterviewSummary {
  cases: number;
  completed: number;
  vagueFollowUp: { asked: number; total: number };
  /** dopytania po dobrej odpowiedzi: rekruter dopytuje tylko o ogólnikowe, więc powinno ich nie być */
  goodFollowUp: { asked: number; total: number };
  factualFlagged: { flagged: number; total: number };
  goodAboveVague: { yes: number; total: number };
  fabricated: number;
  /** oceny bez mocniejszej wersji (kontrola faktów odrzuciła ją 3 razy); brak w starszych wynikach */
  strongerFailed?: number;
  scoreByType: Partial<Record<AnswerType, number>>;
  rejected: number;
  costPerInterview: number | null;
  secondsPerInterview: number | null;
}

export interface InterviewEvalResult {
  kind: 'interview';
  date: string;
  model: string;
  label: string;
  mock: boolean;
  summary: InterviewSummary;
  cases: InterviewCaseResult[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const PLACEHOLDER = /\[[^\]\n]{1,100}\]/g;

/** Wymyślone fakty w mocniejszej wersji: zakazane nazwy (dopasowanie z odmianą) i liczby spoza źródeł. */
function fabricated(stronger: string, c: InterviewCase, m: MockInterview, profile: Profile): string[] {
  const clean = stronger.replace(PLACEHOLDER, ' ');
  const t = tokenize(clean);
  const names = c.meta.forbidden.filter((f) => [f.term, ...f.synonyms].some((v) => countPhrase(t, v) > 0)).map((f) => f.term);
  const find = numberFinder(knownNumbers([...profileTexts(profile), m.cvText, ...candidateAnswers(m)]), numberedNames(c.base.parsed!));
  return [...names, ...find(clean).map((h) => h.token)];
}

async function runCase(c: InterviewCase, observed: { schemaName: string; accepted: boolean }[]): Promise<InterviewCaseResult> {
  const base: InterviewCaseResult = { id: c.id, title: c.meta.title, language: null, ok: false, error: '', questions: 0, answers: [], average: null, costUsd: 0, seconds: 0, rejected: 0 };
  if (!c.base.parsed) return { ...base, error: `Para ${c.meta.base} nie ma zamrożonego ogłoszenia (posting.parsed.json).` };
  const profile = await store.saveProfile(structuredClone(c.base.profile));
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: c.base.postingText, fetchMethod: 'wklejony tekst',
    posting: c.base.parsed, gap: null, status: 'przygotowane', notes: '', currentVersion: 0, pdfFile: '', hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  const lang = c.base.parsed.language === 'en' ? 'en' : 'pl';
  const v = await store.addVersion(profile.id, app.id, (version) => ({
    version, createdAt: t, updatedAt: t, origin: 'generated', template: 'modern', photo: false, photoReason: '', decisions: {},
    rodo: { include: false, text: '', reason: '' }, content: profileCv(profile, lang),
  }));
  await store.updateApplication(profile.id, app.id, (a) => void (a.currentVersion = v.version));

  const started = Date.now();
  const before = observed.length;
  let view;
  try {
    view = await mock.startMock(profile.id, app.id);
    for (let step = 0; step < 30 && view.current?.status === 'active'; step++) {
      const m: MockInterview = view.current;
      const last = m.turns.at(-1)!;
      const kind = m.plan.questions.find((q) => q.id === last.questionId)?.kind as Kind | undefined;
      const answer = (kind && c.meta.answers[kind]) || c.meta.answers.default;
      const text =
        last.kind === 'closing'
          ? c.meta.companyQuestions
          : last.kind === 'followup'
            ? (answer.followUp ?? (m.language === 'en' ? 'I do not have more details to add.' : 'Nie mam więcej szczegółów do dodania.'))
            : answer.text;
      view = await mock.answerMock(profile.id, app.id, text);
    }
    if (view.current?.status === 'active') view = await mock.finishMock(profile.id, app.id);
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
    view = await mock.getMock(profile.id, app.id).catch(() => null);
  }
  base.seconds = (Date.now() - started) / 1000;
  base.rejected = observed.slice(before).filter((o) => !o.accepted).length;
  const m = view?.current;
  if (!m) return base;

  const answers: AnswerResult[] = [];
  for (const q of m.plan.questions) {
    const first = m.turns.find((x) => x.role === 'candidate' && x.kind === 'answer' && x.questionId === q.id);
    if (!first) continue;
    const answer = c.meta.answers[q.kind] ?? c.meta.answers.default;
    const grade = m.grades.find((g) => g.answerId === first.id);
    answers.push({
      questionId: q.id,
      kind: q.kind,
      type: answer.type,
      score: grade?.score ?? null,
      lengthScore: grade?.criteria.length ?? null,
      followUp: m.turns.some((x) => x.kind === 'followup' && x.questionId === q.id),
      factualErrors: grade?.factualErrors.length ?? 0,
      fabricated: m.grades.filter((g) => g.questionId === q.id).flatMap((g) => fabricated(g.stronger, c, m, profile)),
      stronger: m.grades.filter((g) => g.questionId === q.id).map((g) => g.stronger),
      strongerFailed: m.grades.filter((g) => g.questionId === q.id && g.strongerFailed).length,
    });
  }
  return {
    ...base,
    ok: !base.error && m.status === 'finished',
    language: m.language,
    questions: m.plan.questions.length,
    answers,
    average: m.summary?.average ?? null,
    costUsd: m.summary?.costUsd ?? view!.costUsd,
  };
}

export function summarizeInterviews(cases: InterviewCaseResult[]): InterviewSummary {
  const all = cases.flatMap((c) => c.answers);
  const of = (type: AnswerType) => all.filter((a) => a.type === type);
  const scoreByType: Partial<Record<AnswerType, number>> = {};
  for (const type of AnswerTypes) {
    const avg = mean(of(type).flatMap((a) => (a.score === null ? [] : [a.score])));
    if (avg !== null) scoreByType[type] = Math.round(avg * 10) / 10;
  }
  const pairs = cases
    .map((c) => ({ good: mean(c.answers.filter((a) => a.type === 'good' && a.score !== null).map((a) => a.score!)), vague: mean(c.answers.filter((a) => a.type === 'vague' && a.score !== null).map((a) => a.score!)) }))
    .filter((p) => p.good !== null && p.vague !== null);
  const done = cases.filter((c) => c.ok);
  return {
    cases: cases.length,
    completed: done.length,
    vagueFollowUp: { asked: of('vague').filter((a) => a.followUp).length, total: of('vague').length },
    goodFollowUp: { asked: of('good').filter((a) => a.followUp).length, total: of('good').length },
    factualFlagged: { flagged: of('factual-error').filter((a) => a.factualErrors > 0).length, total: of('factual-error').length },
    goodAboveVague: { yes: pairs.filter((p) => p.good! > p.vague!).length, total: pairs.length },
    fabricated: all.reduce((s, a) => s + a.fabricated.length, 0),
    strongerFailed: all.reduce((s, a) => s + (a.strongerFailed ?? 0), 0),
    scoreByType,
    rejected: cases.reduce((s, c) => s + c.rejected, 0),
    costPerInterview: mean(done.map((c) => c.costUsd)),
    secondsPerInterview: mean(done.map((c) => c.seconds)),
  };
}

const TYPE_LABEL: Record<AnswerType, string> = { good: 'dobra z liczbami', vague: 'ogólnikowa', 'factual-error': 'z błędem merytorycznym', brag: 'przechwałka', 'too-long': 'zbyt długa' };
const usd = (x: number | null) => (x === null ? '-' : `$${x.toFixed(4)}`);
const sec = (x: number | null) => (x === null ? '-' : `${x.toFixed(1)} s`);
const frac = (a: number, b: number) => `${a} z ${b}`;

export function interviewMarkdown(r: InterviewEvalResult): string {
  const s = r.summary;
  return [
    `# Ewaluacja próbnej rozmowy: ${r.model}${r.label ? ` (${r.label})` : ''}${r.mock ? ' (atrapa modelu)' : ''}`,
    '',
    `Data: ${r.date}. Model: \`${r.model}\`. Rozmów: ${s.cases}, zakończonych: ${s.completed}.`,
    '',
    '| Miara | Wynik |',
    '|---|---|',
    `| Ogólnikowa odpowiedź dostała dopytanie | ${frac(s.vagueFollowUp.asked, s.vagueFollowUp.total)} |`,
    `| Dobra odpowiedź dostała dopytanie (powinno być 0) | ${frac(s.goodFollowUp.asked, s.goodFollowUp.total)} |`,
    `| Błąd merytoryczny wskazany | ${frac(s.factualFlagged.flagged, s.factualFlagged.total)} |`,
    `| Dobra odpowiedź oceniona wyżej niż ogólnikowa | ${frac(s.goodAboveVague.yes, s.goodAboveVague.total)} rozmów |`,
    `| Wymyślone fakty w mocniejszych wersjach | ${s.fabricated} |`,
    `| Oceny bez mocniejszej wersji (kontrola faktów odrzuciła ją 3 razy) | ${s.strongerFailed ?? '-'} |`,
    `| Średni wynik według rodzaju odpowiedzi | ${AnswerTypes.filter((t) => s.scoreByType[t] !== undefined).map((t) => `${TYPE_LABEL[t]} ${s.scoreByType[t]}`).join(', ')} |`,
    `| Odpowiedzi modelu odrzucone przez kontrole | ${s.rejected} |`,
    `| Koszt jednej rozmowy | ${usd(s.costPerInterview)} |`,
    `| Czas jednej rozmowy | ${sec(s.secondsPerInterview)} |`,
    '',
    '| Rozmowa | Język | Pytania | Średnia | Odpowiedzi (rodzaj: wynik, dopytanie, błąd wskazany) | Wymyślone fakty | Odrzucone | Koszt | Czas |',
    '|---|---|---|---|---|---|---|---|---|',
    ...r.cases.map((c) => {
      const answers = c.answers.map((a) => `${a.kind}/${TYPE_LABEL[a.type]}: ${a.score ?? '-'}${a.followUp ? ', dopytanie' : ''}${a.factualErrors ? ', błąd wskazany' : ''}`).join('; ');
      const fake = c.answers.flatMap((a) => a.fabricated).join(', ');
      return `| ${c.id}${c.ok ? '' : ` (nie: ${c.error.slice(0, 60)})`} | ${c.language ?? '-'} | ${c.questions} | ${c.average ?? '-'} | ${answers} | ${fake || 'brak'} | ${c.rejected} | ${usd(c.costUsd)} | ${sec(c.seconds)} |`;
    }),
    '',
  ].join('\n');
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, '_');

export interface InterviewEvalOptions {
  model: string;
  cases: InterviewCase[];
  outDir: string;
  mock?: boolean;
  label?: string;
  log?: (line: string) => void;
}

/** Wszystkie rozmowy po kolei (jedna rozmowa to kilkanaście wywołań w turach). Model pisania ustawiamy w settings. */
export async function runInterviewEval(opts: InterviewEvalOptions): Promise<{ result: InterviewEvalResult; files: string[] }> {
  // Klucz: zmienna OPENROUTER_API_KEY (ma pierwszeństwo przed ustawieniami); atrapa dostaje klucz na niby.
  await store.saveSettings({ mainModel: opts.model, fastModel: opts.model, maskPii: false, jobSearch: false, ...(opts.mock ? { apiKey: 'sk-mock' } : {}) });
  const observed: { schemaName: string; accepted: boolean }[] = [];
  observeCalls((a) => observed.push({ schemaName: a.schemaName, accepted: a.accepted }));
  const cases: InterviewCaseResult[] = [];
  try {
    for (const c of opts.cases) {
      const r = await runCase(c, observed);
      opts.log?.(`${c.id}: ${r.ok ? `średnio ${r.average ?? '-'}, ${usd(r.costUsd)}, ${sec(r.seconds)}` : `błąd: ${r.error}`}`);
      cases.push(r);
    }
  } finally {
    observeCalls(null);
  }
  const date = new Date().toISOString().slice(0, 10);
  const result: InterviewEvalResult = { kind: 'interview', date, model: opts.model, label: opts.label ?? '', mock: !!opts.mock, summary: summarizeInterviews(cases), cases };
  fs.mkdirSync(opts.outDir, { recursive: true });
  const name = `${date}_${slug(opts.model)}_interview${opts.label ? `_${slug(opts.label)}` : ''}`;
  const files = [path.join(opts.outDir, `${name}.json`), path.join(opts.outDir, `${name}.md`)];
  fs.writeFileSync(files[0], `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(files[1], interviewMarkdown(result));
  return { result, files };
}
