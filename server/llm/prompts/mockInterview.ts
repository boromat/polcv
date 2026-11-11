import {
  MockGradeSchema,
  MockPlanSchema,
  MockSummaryAiSchema,
  type InterviewPrep,
  type JobPosting,
  type MockInterview,
  type MockProbe,
  type MockQuestionKind,
  type Profile,
} from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { forUser, genderForms, json, postingForPrompt, profileForPrompt, today } from './common';
import { profileTexts } from './cvChecks';
import { addressIssue, factualErrorIssues, interviewLang, needsEnglishQuestion, planIssues, requiredKinds, strongerIssues } from './mockChecks';

// Próbna rozmowa kwalifikacyjna: plan pytań, ocena każdej odpowiedzi i podsumowanie. Cała historia rozmowy idzie
// w polu "user", więc przy włączonym maskowaniu przechodzi przez polanon jak każde inne wywołanie.

/** Nazwa zadania w zapisie zużycia: koszt rozmowy to suma wywołań z tą nazwą dla aplikacji od początku rozmowy. */
export const MOCK_TASK = 'próbna rozmowa';

type Lang = 'pl' | 'en';

const KIND_HELP: Record<MockQuestionKind, string> = {
  intro: 'przedstawienie się i motywacja do tej roli',
  experience: 'projekt albo doświadczenie z profilu najbliższe roli',
  situational: 'zadanie sytuacyjne z obowiązków z ogłoszenia ("co zrobisz, gdy…")',
  knowledge: 'wiedza z wymagań obowiązkowych',
  tools: 'narzędzia z wymagań mile widzianych (albo obowiązkowych, gdy mile widzianych nie ma)',
  gap: 'trudne pytanie o brak: wymaganie, którego profil nie potwierdza',
  probe: 'dopytanie o coś z listy DO DOPYTANIA',
};

/** Jak rekruter zwraca się do kandydata: według zaimków z profilu, a bez nich bez form zależnych od płci. */
function addressRule(profile: Profile): string {
  const forms = genderForms(profile.pronouns);
  return forms
    ? `Kandydat określa się jako "${forms.label}": zwracając się do niego po polsku, używaj form ${forms.you}${profile.pronouns === 'on' ? ', formalnie "Pan"' : profile.pronouns === 'ona' ? ', formalnie "Pani"' : ', bez "Pan" i "Pani"'}.`
    : 'Kandydat nie podał, jak się określa: po polsku buduj zdania bez form zależnych od płci ("Jak wyglądała praca…?", "Proszę opowiedzieć…"), bez "Pan" i "Pani". Nie zgaduj płci z imienia.';
}

const COMPANY_RULE = `O firmie wiesz tylko to, co jest w ogłoszeniu. Niczego o niej nie zgaduj (wielkość, klienci, kultura, produkty, technologie spoza ogłoszenia). Co kandydat powinien o firmie wiedzieć, a ogłoszenie tego nie mówi, wpisz w "companyChecks" jako rzeczy do sprawdzenia przed rozmową.`;

const prepForPrompt = (prep: InterviewPrep | null) =>
  prep ? { questions: prep.questions.map((q) => ({ category: q.category, question: q.question })), weakSpots: prep.weakSpots.map((w) => w.issue), topicsToReview: prep.topicsToReview.map((t) => t.topic) } : null;

// ---------- Plan ----------

const PLAN_SYSTEM = (posting: JobPosting, profile: Profile) => {
  const lang = interviewLang(posting);
  const english = needsEnglishQuestion(posting);
  const kinds = requiredKinds(posting);
  return `Jesteś rekruterem i prowadzisz próbną rozmowę kwalifikacyjną z kandydatem (student/junior) na konkretne stanowisko. Układasz plan rozmowy: pytania padną po jednym.
Język pytań: ${lang === 'pl' ? 'polski' : 'angielski'}${english ? ', poza dokładnie jednym pytaniem po angielsku ("lang": "en"), bo ogłoszenie wymaga angielskiego' : ''}. Pole "why" i "companyChecks" ${forUser()}.
Zasady:
- 6-8 pytań, krótkich (1-2 zdania), naturalnych, bez numeracji. Rodzaje ("kind"): ${Object.entries(KIND_HELP).map(([k, v]) => `${k} (${v})`).join('; ')}.
- Co najmniej jedno pytanie każdego z rodzajów: ${kinds.join(', ')}. Pozostałe pytania to najważniejsze rzeczy z listy DO DOPYTANIA ("probe").
- DO DOPYTANIA to rzeczy z CV i profilu policzone przez program (umiejętność bez dowodu, punkt bez liczby, daty, które się nie zgadzają). Pytaj o nie wprost, ale bez oskarżania.
- PRZYGOTOWANIE (gdy jest) to pytania i słabe punkty przygotowane wcześniej: możesz z nich korzystać, ale ułóż własną, krótszą rozmowę.
- ${COMPANY_RULE} 2-4 pozycje.
- ${addressRule(profile)}
Dzisiejsza data: ${today()}.`;
};

export interface PlanInput {
  profile: Profile;
  posting: JobPosting;
  cvText: string;
  probes: MockProbe[];
  prep: InterviewPrep | null;
  ctx: LlmContext;
}

export async function mockPlan({ profile, posting, cvText, probes, prep, ctx }: PlanInput) {
  return callJson({
    schema: MockPlanSchema.superRefine((p, c) => {
      for (const message of planIssues(p.questions, posting, profile.pronouns)) c.addIssue({ code: 'custom', path: ['questions'], message });
    }),
    schemaName: 'mock_interview_plan',
    tier: 'main',
    temperature: 0.5,
    maxTokens: 4000,
    system: PLAN_SYSTEM(posting, profile),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nWYSŁANE CV:\n"""\n${cvText}\n"""\n\nDO DOPYTANIA:\n${json(probes.map((p) => p.detail))}\n\nPRZYGOTOWANIE:\n${json(prepForPrompt(prep))}\n\nUłóż plan próbnej rozmowy.`,
    ctx,
  });
}

// ---------- Ocena odpowiedzi ----------

const GRADE_SYSTEM = (profile: Profile, questionLang: Lang, followUpAllowed: boolean) => {
  const forms = genderForms(profile.pronouns);
  return `Jesteś rekruterem i coachem na próbnej rozmowie kwalifikacyjnej kandydata (student/junior). Oceniasz OSTATNIĄ ODPOWIEDŹ kandydata na PYTANIE.
Język: "good", "missing", "factualErrors", "companyChecks" i "newFacts" ${forUser()}; "stronger" i "followUp" po ${questionLang === 'pl' ? 'polsku' : 'angielsku'}, jak pytanie.
KRYTERIA (każde 1-5, zawsze te same):
- concrete: konkret i liczby (przykład, skala, efekt),
- fit: dopasowanie do wymagań i obowiązków z ogłoszenia,
- structure: struktura (przy pytaniach o doświadczenie: sytuacja, zadanie, działanie, rezultat),
- correctness: poprawność merytoryczna,
- length: długość (ok. 1-2 minuty mówienia, czyli 80-200 słów; za krótka i za długa obniża wynik).
Zasady:
- "good": 1-3 rzeczy, które były dobre. "missing": 1-3 rzeczy, których zabrakło.
- "stronger": mocniejsza wersja tej odpowiedzi do przećwiczenia, w 1. osobie, 80-180 słów. Wolno w niej użyć WYŁĄCZNIE faktów z PROFILU, WYSŁANEGO CV i odpowiedzi kandydata w tej ROZMOWIE. Nie wymyślaj liczb, nazw, narzędzi, firm, ról ani efektów. Każda brakująca dana to miejsce do uzupełnienia w nawiasach kwadratowych, np. "[ile dokumentów tygodniowo]", "[jaki był efekt]". Program sprawdza każdą liczbę i nazwę.
- Po polsku: ${forms ? `kandydat określa się jako "${forms.label}", więc w "stronger" używaj form ${forms.me}.` : 'kandydat nie podał, jak się określa: w "stronger" pisz bez form zależnych od płci (czas teraźniejszy, "udało mi się", "moim zadaniem było").'}
- "factualErrors": tylko błędy merytoryczne, których jesteś pewny (np. pomylony przepis, zła definicja wskaźnika): "claim" (co kandydat powiedział), "correction" (poprawka słowami), "whereToCheck" (rodzaj źródła, np. "oficjalny tekst rozporządzenia", "dokumentacja narzędzia"). Bez numerów artykułów, ustaw i dat, bez linków i bez wymyślonych źródeł. Gdy nie masz pewności, nie wpisuj błędu.
- ${COMPANY_RULE} Wiedzy kandydata o firmie spoza ogłoszenia nie oceniaj jako błędu.
- "newFacts": nowe, konkretne fakty o kandydacie z tej odpowiedzi, których nie ma w profilu (np. "skrypt do raportów oszczędza godzinę dziennie"); "topic" krótki, "answer" słowami kandydata. Kandydat sam zdecyduje, czy dopisać je do profilu. Pusta lista, gdy nic nowego.
- ${followUpAllowed ? '"followUp": jedno krótkie dopytanie TYLKO wtedy, gdy odpowiedź jest ogólnikowa albo nie ma przykładu lub efektu (np. o konkretny przykład i jego efekt w liczbach); pusty, gdy odpowiedź jest konkretna.' : '"followUp": zawsze pusty (to pytanie miało już dopytanie).'} ${addressRule(profile)}
Dzisiejsza data: ${today()}.`;
};

export interface GradeInput {
  profile: Profile;
  posting: JobPosting;
  cvText: string;
  interview: MockInterview;
  questionId: string;
  /** odpowiedzi kandydata na to pytanie (pierwsza i, po dopytaniu, druga) */
  answers: string[];
  followUpAllowed: boolean;
  ctx: LlmContext;
}

/** Odpowiedzi kandydata z całej rozmowy: źródło faktów dla mocniejszej wersji. */
export const candidateAnswers = (m: MockInterview) => m.turns.filter((t) => t.role === 'candidate' && t.kind === 'answer').map((t) => t.content);

const transcript = (m: MockInterview) => m.turns.map((t) => ({ who: t.role === 'interviewer' ? 'rekruter' : 'kandydat', kind: t.kind, text: t.content }));

export async function mockGrade({ profile, posting, cvText, interview, questionId, answers, followUpAllowed, ctx }: GradeInput) {
  const question = interview.plan.questions.find((q) => q.id === questionId)!;
  const sources = { texts: [...profileTexts(profile), cvText, ...candidateAnswers(interview)], posting };
  const answer = answers.join('\n');
  return callJson({
    schema: MockGradeSchema.superRefine((g, c) => {
      for (const message of strongerIssues(g.stronger, question.kind, sources, profile.pronouns, question.lang)) c.addIssue({ code: 'custom', path: ['stronger'], message });
      for (const message of factualErrorIssues(g.factualErrors, answer)) c.addIssue({ code: 'custom', path: ['factualErrors'], message });
      const address = followUpAllowed && g.followUp.trim() && question.lang === 'pl' ? addressIssue(g.followUp, profile.pronouns) : null;
      if (address) c.addIssue({ code: 'custom', path: ['followUp'], message: address });
    }),
    schemaName: 'mock_interview_grade',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 4000,
    system: GRADE_SYSTEM(profile, question.lang, followUpAllowed),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nWYSŁANE CV:\n"""\n${cvText}\n"""\n\nDO DOPYTANIA:\n${json(interview.probes.map((p) => p.detail))}\n\nROZMOWA:\n${json(transcript(interview))}\n\nPYTANIE:\n${json({ kind: question.kind, text: question.text, why: question.why })}\n\nOSTATNIA ODPOWIEDŹ${answers.length > 1 ? ' (po dopytaniu: oceń całą odpowiedź na pytanie, razem z pierwszą częścią)' : ''}:\n"""\n${answer}\n"""\n\nOceń odpowiedź.`,
    ctx,
  });
}

// ---------- Podsumowanie ----------

const SUMMARY_SYSTEM = () => `Jesteś rekruterem i coachem. Podsumowujesz próbną rozmowę kwalifikacyjną kandydata (student/junior). Wszystko ${forUser()}.
Zasady:
- "strengths": 3 mocne strony z tej rozmowy (mniej, gdy kandydat odpowiedział na mniej niż 2 pytania), każda z odniesieniem do konkretnej odpowiedzi.
- "improvements": 3 najważniejsze rzeczy do poprawy przed prawdziwą rozmową, konkretnie (co i jak przećwiczyć).
- "topicsToReview": 1-5 tematów do powtórki z wymagań ogłoszenia, przy których odpowiedzi były słabe albo z błędem.
- "candidateQuestions": ocena pytań kandydata do firmy (ostatnia odpowiedź w rozmowie, po "closing"): czy pokazują zainteresowanie rolą i co dodać. Gdy kandydat nie zadał pytań, napisz 2-3 pytania, które warto zadać, oparte na ogłoszeniu.
- ${COMPANY_RULE}
- Opieraj się na ROZMOWIE i OCENACH. Nie wymyślaj niczego o kandydacie.`;

export async function mockSummary(posting: JobPosting, interview: MockInterview, ctx: LlmContext) {
  const answered = interview.grades.length;
  const grades = interview.grades.map((g) => ({ question: interview.plan.questions.find((q) => q.id === g.questionId)?.text ?? '', score: g.score, good: g.good, missing: g.missing, errors: g.factualErrors.map((e) => e.claim) }));
  return callJson({
    schema: MockSummaryAiSchema.superRefine((s, c) => {
      const want = answered >= 2 ? 3 : null;
      if (want && s.strengths.length !== want) c.addIssue({ code: 'custom', path: ['strengths'], message: `Wpisz dokładnie ${want} mocne strony.` });
      if (s.improvements.length !== 3) c.addIssue({ code: 'custom', path: ['improvements'], message: 'Wpisz dokładnie 3 rzeczy do poprawy.' });
    }),
    schemaName: 'mock_interview_summary',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 3000,
    system: SUMMARY_SYSTEM(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nROZMOWA:\n${json(transcript(interview))}\n\nOCENY:\n${json(grades)}\n\nPodsumuj rozmowę.`,
    ctx,
  });
}
