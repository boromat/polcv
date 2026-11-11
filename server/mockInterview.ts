import type { MockInterview, MockInterviewFile, MockInterviewView, MockSavedGrade, MockTurn } from '../shared/schemas';
import * as store from './storage/store';
import { HttpError, newId, nowIso } from './storage/store';
import { applyDecisions } from './llm/prompts/common';
import { withoutPending } from './cv/render';
import { versionPdf } from './services';
import { normalize } from './ats/keywords';
import { interviewLang, interviewProbes, lengthScore, placeholders } from './llm/prompts/mockChecks';
import { MOCK_TASK, mockGrade, mockPlan, mockSummary } from './llm/prompts/mockInterview';
import { tr } from './i18n';

// Próbna rozmowa kwalifikacyjna przy aplikacji: rekruter zadaje pytania z planu po jednym, każda odpowiedź dostaje
// ocenę i mocniejszą wersję, a na koniec podsumowanie. Wzór rozmowy w turach jak u doradcy kariery (career.ts):
// odpowiedź kandydata zapisujemy przed wywołaniem AI, a ocenę rozmowy wyczyszczonej w międzyczasie pomijamy.

const CLOSING = { pl: 'Na koniec: czy są jakieś pytania do nas?', en: 'Finally, do you have any questions for us?' };
const MAX_ANSWER = 6000;

const ctxOf = (pid: string, aid: string) => ({ profileId: pid, applicationId: aid, task: MOCK_TASK });
const turn = (role: MockTurn['role'], kind: MockTurn['kind'], questionId: string, content: string): MockTurn => ({ id: newId(), role, kind, questionId, content, at: nowIso() });

/** Koszt rozmowy z istniejącego zapisu zużycia: wywołania "próbna rozmowa" tej aplikacji od początku rozmowy. */
async function costSince(aid: string, since: string): Promise<number> {
  return (await store.readUsage()).filter((u) => u.applicationId === aid && u.task === MOCK_TASK && u.at >= since).reduce((s, u) => s + u.cost, 0);
}

export async function getMock(pid: string, aid: string): Promise<MockInterviewView> {
  const file = await store.getMockInterview(pid, aid);
  return { ...file, costUsd: file.current ? await costSince(aid, file.current.startedAt) : 0 };
}

async function basics(pid: string, aid: string) {
  const app = await store.getApplication(pid, aid);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  return { app, posting: app.posting, profile: await store.getProfile(pid) };
}

/** Następne pytanie z planu, a po ostatnim: pytanie rekrutera o pytania kandydata do firmy. */
function askNext(m: MockInterview, after: string) {
  const i = m.plan.questions.findIndex((q) => q.id === after);
  const next = m.plan.questions[i + 1];
  m.turns.push(next ? turn('interviewer', 'question', next.id, next.text) : turn('interviewer', 'closing', 'closing', CLOSING[m.language]));
}

/** Nowa rozmowa (albo wznowienie trwającej, gdy `restart` nie jest ustawione). Podsumowania wcześniejszych podejść zostają. */
export async function startMock(pid: string, aid: string, restart = false): Promise<MockInterviewView> {
  const file = await store.getMockInterview(pid, aid);
  if (file.current?.status === 'active' && !restart) return getMock(pid, aid);
  const { app, posting, profile } = await basics(pid, aid);
  const cv = await store.getVersion(pid, aid, app.currentVersion);
  const { text: cvText } = await versionPdf(pid, aid, app.currentVersion);
  const probes = interviewProbes(applyDecisions(withoutPending(cv)), profile, posting);
  const prep = app.hasInterviewPrep ? await store.getInterviewPrep(pid, aid) : null;
  // Czas sprzed planu: koszt planu też należy do tej rozmowy.
  const startedAt = nowIso();
  const plan = await mockPlan({ profile, posting, cvText, probes, prep, ctx: ctxOf(pid, aid) });
  const questions = plan.questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
  const interview: MockInterview = {
    id: newId(),
    startedAt,
    status: 'active',
    language: interviewLang(posting),
    cvText,
    probes,
    plan: { questions, companyChecks: plan.companyChecks },
    turns: [turn('interviewer', 'question', questions[0].id, questions[0].text)],
    grades: [],
    summary: null,
  };
  await store.updateMockInterview(pid, aid, (f) => {
    f.current = interview;
  });
  return getMock(pid, aid);
}

const activeOf = (f: MockInterviewFile): MockInterview => {
  if (!f.current || f.current.status !== 'active') throw new HttpError(409, tr('Nie ma trwającej próbnej rozmowy. Zacznij nową.'));
  return f.current;
};

/**
 * Odpowiedź kandydata na bieżące pytanie: zapis od razu, potem ocena AI i dopytanie (najwyżej jedno na pytanie, pilnuje
 * tego program) albo następne pytanie. Pusta odpowiedź ponawia ocenę ostatniej odpowiedzi, jeśli się nie udała.
 */
export async function answerMock(pid: string, aid: string, text: string): Promise<MockInterviewView> {
  const content = text.trim().slice(0, MAX_ANSWER);
  let basis!: MockTurn;
  const file = await store.updateMockInterview(pid, aid, (f) => {
    const m = activeOf(f);
    const last = m.turns.at(-1)!;
    if (last.role === 'candidate') {
      if (content) throw new HttpError(409, tr('Poprzednia odpowiedź czeka jeszcze na ocenę. Spróbuj ponownie.'));
      basis = last;
      return;
    }
    if (!content) throw new HttpError(400, tr('Odpowiedź jest pusta.'));
    basis = turn('candidate', last.kind === 'closing' ? 'closing' : 'answer', last.questionId, content);
    m.turns.push(basis);
  });
  const m = file.current!;
  // Pytania kandydata do firmy nie dostają oceny: od razu podsumowanie.
  if (basis.kind === 'closing') return finishMock(pid, aid);

  const { profile, posting } = await basics(pid, aid);
  const qid = basis.questionId;
  const answers = m.turns.filter((t) => t.role === 'candidate' && t.kind === 'answer' && t.questionId === qid).map((t) => t.content);
  const hadFollowUp = m.turns.some((t) => t.kind === 'followup' && t.questionId === qid);
  const { grade: g, strongerFailed } = await mockGrade({ profile, posting, cvText: m.cvText, interview: m, questionId: qid, answers, followUpAllowed: !hadFollowUp, ctx: ctxOf(pid, aid) });
  const { followUp, newFacts, ...rest } = g;
  // Długość liczy program z całej odpowiedzi na pytanie (po dopytaniu: z obu części).
  const c = { ...g.criteria, length: lengthScore(answers.join(' ')) };
  const saved: MockSavedGrade = {
    ...rest,
    criteria: c,
    questionId: qid,
    answerId: basis.id,
    score: Math.round((c.concrete + c.fit + c.structure + c.correctness + c.length) / 5),
    ...(strongerFailed ? { strongerFailed: true } : {}),
    placeholders: placeholders(g.stronger),
    facts: newFacts.filter((f) => f.topic.trim() && f.answer.trim()).map((f) => ({ topic: f.topic.trim(), answer: f.answer.trim(), added: false })),
  };
  await store.updateMockInterview(pid, aid, (f) => {
    const cur = f.current;
    // Rozmowa wyczyszczona albo zaczęta od nowa w trakcie oceny: ta ocena dotyczy starej rozmowy.
    if (!cur || cur.id !== m.id || cur.status !== 'active' || !cur.turns.some((t) => t.id === basis.id)) return;
    if (cur.grades.some((x) => x.answerId === basis.id)) return;
    cur.grades.push(saved);
    // Dopytanie tylko po ogólnikowej odpowiedzi (konkret 1-2 w ocenie modelu) i najwyżej jedno na pytanie.
    if (!hadFollowUp && g.criteria.concrete <= 2 && followUp.trim()) cur.turns.push(turn('interviewer', 'followup', qid, followUp.trim()));
    else askNext(cur, qid);
  });
  return getMock(pid, aid);
}

/** Pominięcie bieżącego pytania albo dopytania (bez wywołania AI); pominięte pytanie do firmy kończy rozmowę. */
export async function skipMock(pid: string, aid: string): Promise<MockInterviewView> {
  let closing = false;
  await store.updateMockInterview(pid, aid, (f) => {
    const m = activeOf(f);
    const last = m.turns.at(-1)!;
    if (last.role === 'candidate') throw new HttpError(409, tr('Poprzednia odpowiedź czeka jeszcze na ocenę. Spróbuj ponownie.'));
    m.turns.push(turn('candidate', 'skip', last.questionId, ''));
    closing = last.kind === 'closing';
    if (!closing) askNext(m, last.questionId);
  });
  return closing ? finishMock(pid, aid) : getMock(pid, aid);
}

/** Ostatnia ocena każdego pytania (po dopytaniu ocena całej odpowiedzi). */
export function finalGrades(m: MockInterview): MockSavedGrade[] {
  const last = new Map<string, MockSavedGrade>();
  for (const g of m.grades) last.set(g.questionId, g);
  return m.plan.questions.flatMap((q) => last.get(q.id) ?? []);
}

/** Koniec rozmowy (w każdej chwili): podsumowanie AI, a średnią, miejsca w nawiasach i koszt liczy program. */
export async function finishMock(pid: string, aid: string): Promise<MockInterviewView> {
  const file = await store.getMockInterview(pid, aid);
  const m = file.current;
  if (!m) throw new HttpError(409, tr('Nie ma trwającej próbnej rozmowy. Zacznij nową.'));
  if (m.status === 'finished') return getMock(pid, aid);
  const { posting } = await basics(pid, aid);
  const ai = await mockSummary(posting, m, ctxOf(pid, aid));
  const grades = finalGrades(m);
  const answeredIds = new Set(m.turns.filter((t) => t.kind === 'answer').map((t) => t.questionId));
  const text = (id: string) => m.plan.questions.find((q) => q.id === id)?.text ?? '';
  const summary = {
    ...ai,
    at: nowIso(),
    interviewId: m.id,
    average: grades.length ? Math.round((grades.reduce((s, g) => s + g.score, 0) / grades.length) * 10) / 10 : null,
    answered: answeredIds.size,
    skipped: m.plan.questions.filter((q) => !answeredIds.has(q.id) && m.turns.some((t) => t.kind === 'skip' && t.questionId === q.id)).length,
    placeholders: grades.filter((g) => g.placeholders.length).map((g) => ({ question: text(g.questionId), items: g.placeholders })),
    costUsd: await costSince(aid, m.startedAt),
  };
  await store.updateMockInterview(pid, aid, (f) => {
    const cur = f.current;
    if (!cur || cur.id !== m.id) return;
    cur.status = 'finished';
    cur.summary = summary;
    if (!f.history.some((h) => h.interviewId === m.id)) f.history.push(summary);
  });
  return getMock(pid, aid);
}

/** Fakt z odpowiedzi trafia do profilu (extraFacts) dopiero po kliknięciu kandydata: na próbnej rozmowie się improwizuje. */
export async function addMockFact(pid: string, aid: string, answerId: string, index: number): Promise<MockInterviewView> {
  const file = await store.getMockInterview(pid, aid);
  const fact = file.current?.grades.find((g) => g.answerId === answerId)?.facts[index];
  if (!fact) throw new HttpError(404, tr('Nie ma takiego faktu w tej rozmowie.'));
  if (!fact.added) {
    await store.updateProfile(pid, (p) => {
      const same = (x: { topic: string; answer: string }) => normalize(x.topic) === normalize(fact.topic) && normalize(x.answer) === normalize(fact.answer);
      if (!p.extraFacts.some(same)) {
        p.extraFacts.push({ id: newId(), topic: fact.topic, has: true, answer: fact.answer, source: tr('Próbna rozmowa'), date: nowIso().slice(0, 10) });
      }
    });
    await store.updateMockInterview(pid, aid, (f) => {
      const x = f.current?.grades.find((g) => g.answerId === answerId)?.facts[index];
      if (x) x.added = true;
    });
  }
  return getMock(pid, aid);
}

/** Wyczyszczenie bieżącej rozmowy; podsumowania wcześniejszych podejść zostają. */
export async function clearMock(pid: string, aid: string): Promise<MockInterviewView> {
  await store.updateMockInterview(pid, aid, (f) => {
    f.current = null;
  });
  return getMock(pid, aid);
}
