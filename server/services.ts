import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Application, CvContent, CvVersion, ExtraFact, GapAnswer, GithubImportResult, ImproveOptions, ImproveResult, JobPosting, Profile, TemplateId } from '../shared/schemas';
import * as store from './storage/store';
import { HttpError, newId, nowIso } from './storage/store';
import { fetchPosting } from './jobs/fetchPosting';
import { parsePosting } from './llm/prompts/parsePosting';
import { gapQuestions } from './llm/prompts/gapQuestions';
import { generateCv, improveCv, instructCv, shortenCv, syncCv } from './llm/prompts/generateCv';
import { newsCount, profileEntriesOf, profileIdsOf, profileNews, refreshEntries, refreshSnapshot } from './cv/profileNews';
import { applyProfileFields, entryUpdates, mergeSync, needsAi, syncRequest } from './cv/syncMerge';
import { unifyDates } from './cv/improveEdits';
import { evaluateCv } from './llm/prompts/evaluateCv';
import { courseAdvice, coverLetter, interviewPrep } from './llm/prompts/extras';
import { applyDecisions } from './llm/prompts/common';
import { factTexts, unverifiedSkillItems } from './llm/prompts/cvChecks';
import { hasWork, improveOptions, improvePlan, selectPlan } from './llm/prompts/improvePlan';
import { decideLanguage, decidePhoto, decideRodo } from './cv/rodo';
import { photoDataUri, renderCvHtml, renderLetterHtml, withoutPending, type RenderMode } from './cv/render';
import { htmlToPdf } from './cv/pdf';
import { syncCvEdit } from './cv/profileSync';
import { buildReport, honestReport, notWorse } from './ats/score';
import { normalize } from './ats/keywords';
import { applyGithubUpdates, fetchGithub, githubProject, mergeGithubProjects, parseGithubUser, repoState, type GithubMerge, type GithubUpdateMerge } from './cv/github';
import { describeGithubRepos, describeGithubUpdates, profileLanguage } from './llm/prompts/githubProjects';
import { tr, withLang } from './i18n';

const ctxOf = (app: Application, task: string) => ({ profileId: app.profileId, applicationId: app.id, task });

// ---------- Ogłoszenie ----------

export async function createApplication(profileId: string, url: string, pastedText: string): Promise<Application> {
  await store.getProfile(profileId);
  let rawText = pastedText.trim();
  let fetchMethod = 'wklejony tekst'; // zapisana wartość - tłumaczy ją widok ogłoszenia
  if (!rawText) {
    if (!url.trim()) throw new HttpError(400, tr('Podaj link do ogłoszenia albo wklej jego treść.'));
    const fetched = await fetchPosting(url);
    rawText = fetched.text;
    fetchMethod = fetched.method;
  }
  if (rawText.length < 200) throw new HttpError(400, tr('Treść ogłoszenia jest za krótka - wklej całe ogłoszenie.'));

  const t = nowIso();
  const app: Application = {
    id: newId(),
    profileId,
    createdAt: t,
    updatedAt: t,
    url: url.trim(),
    rawText,
    fetchMethod,
    posting: null,
    gap: null,
    status: 'szkic',
    notes: '',
    currentVersion: 0,
    pdfFile: '',
    hasInterviewPrep: false,
    hasCoverLetter: false,
    hasCourses: false,
  };
  app.posting = await parsePosting(rawText, app.url, ctxOf(app, 'analiza ogłoszenia'));
  return store.saveApplication(app);
}

// ---------- Pytania o braki ----------

export async function runGapAnalysis(profileId: string, appId: string): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Najpierw trzeba przeanalizować ogłoszenie.'));
  const profile = await store.getProfile(profileId);
  const gap = await gapQuestions(profile, app.posting, ctxOf(app, 'pytania o braki'));
  return store.updateApplication(profileId, appId, (a) => {
    a.gap = { questions: gap.questions, covered: gap.covered, answers: [] };
  });
}

/** Stałe id faktu z odpowiedzi: ta sama aplikacja i to samo wymaganie to zawsze ten sam fakt w profilu. */
export const answerFactId = (appId: string, requirement: string) =>
  `gap-${appId}-${createHash('sha1').update(normalize(requirement)).digest('hex').slice(0, 10)}`;

/**
 * Odpowiedzi trafiają do profilu (extraFacts), żeby kolejne CV już ich nie pytały.
 * Ponowne wysłanie (np. kolejne "Napisz CV") podmienia wcześniejszy fakt zamiast dopisywać kopię.
 */
export async function saveAnswers(profileId: string, appId: string, answers: GapAnswer[]): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  await storeAnswerFacts(app, answers);

  // Odpowiedzi zostają też przy aplikacji (do ponownego wypełnienia formularza); nowsza odpowiedź na pytanie zastępuje starszą.
  return store.updateApplication(profileId, appId, (a) => {
    const posted = new Set(answers.map((x) => x.questionId));
    const prev = (a.gap?.answers ?? []).filter((x) => !posted.has(x.questionId));
    a.gap = { ...(a.gap ?? { questions: [], covered: [] }), answers: [...prev, ...answers] };
  });
}

/**
 * Kandydat potwierdza w raporcie brakujące wymaganie ("mam to") albo uzupełnia dane, o które prosi poprawka.
 * Zapis jak odpowiedź na pytanie o braki, więc ten sam temat przy tej aplikacji podmienia wcześniejszą odpowiedź.
 */
export async function addFacts(profileId: string, appId: string, facts: { topic: string; answer: string }[]): Promise<number> {
  const app = await store.getApplication(profileId, appId);
  const answers = facts.filter((f) => f.topic.trim() && f.answer.trim()).map((f) => ({ requirement: f.topic.trim(), has: true, answer: f.answer }));
  await storeAnswerFacts(app, answers);
  return answers.length;
}

async function storeAnswerFacts(app: Application, answers: Pick<GapAnswer, 'requirement' | 'has' | 'answer'>[]): Promise<void> {
  const appId = app.id;
  const params = { title: app.posting?.title ?? '', company: app.posting?.company ?? '' };
  const sourceText = () => tr('Odpowiedź przy aplikacji: {title} - {company}', params).trim();
  const source = sourceText();
  // Starsze wersje dawały faktom losowe id - rozpoznajemy je po źródle (w obu językach) i temacie.
  const legacySources = new Set([source, withLang('pl', sourceText), withLang('en', sourceText)]);

  const byId = new Map<string, ExtraFact | null>();
  const topicToId = new Map<string, string>();
  for (const a of answers) {
    const id = answerFactId(appId, a.requirement);
    topicToId.set(normalize(a.requirement), id);
    byId.set(
      id,
      !a.has && !a.answer.trim()
        ? null // "nie" bez opisu: nic nie zapisujemy, a wcześniejsza odpowiedź na to pytanie znika
        : {
            id,
            topic: a.requirement,
            has: a.has,
            answer: a.has ? a.answer.trim() : a.answer.trim() || tr('Nie znam / nie mam doświadczenia.'),
            source,
            date: nowIso().slice(0, 10),
          },
    );
  }

  if (byId.size) {
    await store.updateProfile(app.profileId, (profile) => {
      const legacy = (f: ExtraFact) => !f.id.startsWith('gap-') && legacySources.has(f.source);
      const keyOf = (f: ExtraFact) => (byId.has(f.id) ? f.id : legacy(f) ? topicToId.get(normalize(f.topic)) : undefined);
      const placed = new Set<string>();
      const kept: ExtraFact[] = [];
      for (const f of profile.extraFacts) {
        const key = keyOf(f);
        if (!key) {
          kept.push(f);
          continue;
        }
        // Nowa odpowiedź trafia w miejsce pierwszej starej, kolejne kopie znikają.
        const next = byId.get(key);
        if (next && !placed.has(key)) kept.push(next);
        placed.add(key);
      }
      for (const [key, next] of byId) if (next && !placed.has(key)) kept.push(next);
      profile.extraFacts = kept;
    });
  }
}

// ---------- CV ----------

/** Unikalne id dla tekstów (decyzje o sugestiach są przypięte do id). */
function withFreshIds(c: CvContent): CvContent {
  const fresh = <T extends { id: string }>(t: T): T => ({ ...t, id: `t${nanoid(8)}` });
  return {
    ...c,
    summary: fresh(c.summary),
    experience: c.experience.map((e) => ({ ...e, bullets: e.bullets.map(fresh) })),
    projects: c.projects.map((p) => ({ ...p, bullets: p.bullets.map(fresh) })),
  };
}

export async function generate(profileId: string, appId: string, language?: 'pl' | 'en', template?: TemplateId): Promise<CvVersion> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Brak przeanalizowanego ogłoszenia.'));
  const profile = await store.getProfile(profileId);
  const lang = language ?? decideLanguage(app.posting);
  // Liczby z potwierdzonych tekstów wcześniejszych wersji tej aplikacji (np. zaakceptowanych sugestii) nie wracają jako sugestie.
  const confirmed = (await store.listVersions(profileId, appId)).flatMap((v) => factTexts(applyDecisions(v)));
  const written = withFreshIds(await generateCv(profile, app.posting, lang, ctxOf(app, 'pisanie CV'), confirmed));
  written.language = lang;

  const prev = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion).catch(() => null) : null;
  const photo = decidePhoto(app.posting, lang, !!profile.photo);
  const rodo = decideRodo(app.posting, lang);
  const t = nowIso();
  const draft: CvVersion = {
    version: 0,
    createdAt: t,
    updatedAt: t,
    origin: 'generated',
    content: written,
    decisions: {},
    template: template ?? prev?.template ?? 'modern',
    photo: photo.include,
    photoReason: photo.reason,
    rodo,
    profileIds: profileIdsOf(profile),
    profileEntries: profileEntriesOf(profile),
  };
  const content = await fitToPage(profile, app, draft, confirmed);
  // Numer: kolejny po najwyższej istniejącej wersji (użytkownik mógł wrócić do starszej).
  const cv = await store.addVersion(profileId, appId, (version) => ({ ...draft, version, content }));
  // Aplikacja z dysku, a nie sprzed generowania - status czy notatka zmienione w międzyczasie zostają.
  await store.updateApplication(profileId, appId, (a) => {
    a.currentVersion = cv.version;
    if (a.status === 'szkic') a.status = 'przygotowane';
  });
  return cv;
}

/** `profileUpdates`: co z poprawek w CV trafiło też do profilu (puste, gdy nic). */
export async function updateVersion(
  profileId: string,
  appId: string,
  v: number,
  patch: Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>,
): Promise<{ cv: CvVersion; profileUpdates: string[] }> {
  const cv = await store.getVersion(profileId, appId, v);
  // Zapis bez faktycznej zmiany nie może unieważniać oceny.
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(cv[k]));
  if (!changed) return { cv, profileUpdates: [] };
  const next: CvVersion = { ...cv, ...patch, version: cv.version, updatedAt: nowIso() };
  await store.saveVersion(profileId, appId, next);
  let profileUpdates: string[] = [];
  if (patch.content) {
    const profile = await store.updateProfile(profileId, (p) => void (profileUpdates = syncCvEdit(p, cv.content, patch.content!)));
    // To, co przeszło z CV do profilu, CV już ma: nie może potem wrócić przy synchronizacji jako zmiana w profilu.
    if (profileUpdates.length && next.profileIds) {
      next.profileIds = refreshSnapshot(next.profileIds, profile, next.content);
      next.profileEntries = refreshEntries(next.profileEntries, profile, next.content);
      await store.saveVersion(profileId, appId, next);
    }
  }
  return { cv: next, profileUpdates };
}

async function renderCv(profile: Profile, cv: CvVersion, mode: RenderMode): Promise<string> {
  const photo = photoDataUri(store.profileDir(profile.id), profile.photo);
  return renderCvHtml(cv, profile, photo, mode);
}

/** Ile razy AI skraca CV, które dalej nie mieści się na stronie (każde skracanie to osobne zapytanie). */
const SHORTEN_PASSES = 2;

/**
 * CV, które nawet przy najmniejszej czcionce nie mieści się na stronie A4, AI skraca o tyle, ile wystaje. Gdy po
 * skróceniu dalej wystaje (w ewaluacji zdarzyło się to przy bardzo długim profilu), AI skraca jeszcze raz, od skróconej
 * wersji. Po drugim razie CV zostaje takie, jak jest: liczbę stron widać w edytorze, a "Skróć do 1 strony" działa dalej.
 * Zwraca treść do zapisania: bez zmian, gdy CV się mieści.
 */
async function fitToPage(profile: Profile, app: Application, draft: CvVersion, confirmed: string[]): Promise<CvContent> {
  let content = draft.content;
  let { pages, fill } = await htmlToPdf(await renderCv(profile, draft, 'pdf'));
  for (let pass = 0; pass < SHORTEN_PASSES && pages > 1; pass++) {
    const shorter = withFreshIds(await shortenCv(profile, app.posting!, content, fill ?? 1.2, ctxOf(app, 'skracanie CV'), confirmed));
    shorter.language = draft.content.language;
    content = shorter;
    ({ pages, fill } = await htmlToPdf(await renderCv(profile, { ...draft, content }, 'pdf')));
  }
  return content;
}

/** Ile rzeczy doszło do profilu od bieżącej wersji CV aplikacji (0 bez CV). */
export async function profileNewsCount(profile: Profile, app: Application): Promise<number> {
  if (!app.currentVersion) return 0;
  const cv = await store.getVersion(profile.id, app.id, app.currentVersion).catch(() => null);
  return cv ? newsCount(profileNews(profile, cv)) : 0;
}

/**
 * "Synchronizuj z profilem": to, co doszło do profilu od powstania bieżącej wersji (np. z rozmowy z doradcą), trafia do CV
 * bez ruszania ręcznych poprawek kandydata. Zmienione nazwy, firmy i daty pozycji z CV wpisujemy wprost z profilu,
 * AI pisze tylko nowe pozycje i punkty, a CV dłuższego niż strona nie skracamy samodzielnie. Wynik to nowa, bieżąca
 * wersja; poprzednia zostaje na liście. Gdy z nowości nic do CV nie pasuje, nowej wersji nie ma, a licznik się zeruje.
 */
export async function syncWithProfile(profileId: string, appId: string): Promise<{ version: number | null; message: string }> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  const [profile, current] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, app.currentVersion)]);
  const news = profileNews(profile, current);
  if (!newsCount(news)) return { version: null, message: tr('To CV ma już wszystko z profilu: od tej wersji nic nie doszło.') };
  const base = applyDecisions(current);
  const updates = entryUpdates(news, current);
  const fields = applyProfileFields(base, profile, news, updates, base.language === profileLanguage(profile));
  const request = syncRequest(news, fields.content, updates, fields.aiHeaders);
  let content = fields.content;
  let notes = '';
  if (needsAi(request)) {
    const ai = await syncCv(profile, app.posting, fields.content, request, ctxOf(app, 'aktualizacja z profilu'));
    content = mergeSync(fields.content, ai, request, () => `t${nanoid(8)}`);
    notes = ai.notes.trim();
  }
  const snapshot = { profileIds: profileIdsOf(profile), profileEntries: profileEntriesOf(profile) };
  const withoutNotes = (c: CvContent) => JSON.stringify({ ...c, notes: '' });
  if (withoutNotes(content) === withoutNotes(base)) {
    // Bez nowej wersji, ale te nowości już nie wrócą jako "do synchronizacji".
    await store.saveVersion(profileId, appId, { ...current, ...snapshot });
    return { version: null, message: notes || tr('Nowości z profilu nie pasują do tego ogłoszenia, więc CV zostaje bez zmian.') };
  }
  const { pages } = await htmlToPdf(await renderCv(profile, { ...current, content, decisions: {} }, 'pdf'));
  const t = nowIso();
  const cv = await store.addVersion(profileId, appId, (version) => ({
    ...current,
    version,
    createdAt: t,
    updatedAt: t,
    origin: 'synced',
    content,
    decisions: {},
    ...snapshot,
  }));
  await store.updateApplication(profileId, appId, (a) => {
    a.currentVersion = cv.version;
  });
  const message = [
    fields.touched.length ? tr('Poprawione według profilu: {items}.', { items: fields.touched.join(', ') }) : '',
    notes,
    tr('Reszta CV została bez zmian, z Twoimi poprawkami.'),
    pages > 1 ? tr('CV nie mieści się już na jednej stronie: usuń coś w edytorze albo kliknij „Skróć do 1 strony”.') : '',
  ];
  return { version: cv.version, message: message.filter(Boolean).join('\n') };
}

/**
 * Polecenie kandydata dla AI (pole na dole edytora): zmiana CV według jego słów, tylko z faktów profilu.
 * Wynik to nowa, bieżąca wersja dopasowana do jednej strony; poprzednia zostaje na liście.
 */
export async function instructVersion(profileId: string, appId: string, v: number, instruction: string): Promise<{ version: number; message: string }> {
  const text = instruction.trim();
  if (!text) throw new HttpError(400, tr('Napisz, co AI ma zmienić w CV.'));
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Brak przeanalizowanego ogłoszenia.'));
  const [profile, current] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  const base = applyDecisions(current);
  const changed = withFreshIds(await instructCv(profile, app.posting, base, text.slice(0, 1000), ctxOf(app, 'polecenie dla AI')));
  changed.language = base.language;
  const content = await fitToPage(profile, app, { ...current, content: changed, decisions: {} }, factTexts(base));
  const t = nowIso();
  const cv = await store.addVersion(profileId, appId, (version) => ({ ...current, version, createdAt: t, updatedAt: t, origin: 'improved', content, decisions: {} }));
  await store.updateApplication(profileId, appId, (a) => {
    a.currentVersion = cv.version;
  });
  return { version: cv.version, message: content.notes };
}

/**
 * "Skróć do 1 strony" przy istniejącej wersji: AI skraca ją raz, a skrócona zostaje nową, bieżącą wersją
 * (poprzednia zostaje na liście). null, gdy CV już mieści się na stronie.
 */
export async function shortenVersion(profileId: string, appId: string, v: number): Promise<CvVersion | null> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Brak przeanalizowanego ogłoszenia.'));
  const [profile, current] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  const base = applyDecisions(current);
  const content = await fitToPage(profile, app, { ...current, content: base, decisions: {} }, factTexts(base));
  if (content === base) return null;
  const t = nowIso();
  const cv = await store.addVersion(profileId, appId, (version) => ({ ...current, version, createdAt: t, updatedAt: t, origin: 'improved', content, decisions: {} }));
  await store.updateApplication(profileId, appId, (a) => {
    a.currentVersion = cv.version;
  });
  return cv;
}

export async function previewHtml(profileId: string, appId: string, v: number): Promise<string> {
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  return renderCv(profile, cv, 'preview');
}

export async function versionPdf(profileId: string, appId: string, v: number) {
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  return htmlToPdf(await renderCv(profile, cv, 'pdf'));
}

// ---------- Ocena ----------

export async function evaluate(profileId: string, appId: string, v: number) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Brak przeanalizowanego ogłoszenia.'));
  // Czas sprzed odczytu CV: poprawka zapisana w trakcie oceny oznaczy raport jako nieaktualny.
  const startedAt = nowIso();
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  // Oceniamy tylko to, co kandydat potwierdził: oczekujące sugestie w wersji bezpiecznej (tryb 'ats').
  const { text, pages } = await htmlToPdf(await renderCv(profile, cv, 'ats'));

  let review = null;
  let aiError = '';
  try {
    review = await evaluateCv(text, app.posting, ctxOf(app, 'ocena AI-rekrutera'));
  } catch (e: any) {
    // Brak klucza / zły klucz / brak środków / niedziałające maskowanie - przerywamy, żeby nie pokazać zawyżonego, niepełnego wyniku.
    if (e instanceof HttpError && [400, 401, 402, 503].includes(e.status)) throw e;
    aiError = e.message || tr('Nie udało się uzyskać oceny AI.');
  }
  const report = {
    ...buildReport({
      version: v,
      pdfText: text,
      pages,
      cv: applyDecisions(withoutPending(cv)),
      clause: cv.rodo.include ? cv.rodo.text : '',
      profile,
      posting: app.posting,
      review,
      aiError,
    }),
    createdAt: startedAt,
  };
  await store.saveReport(profileId, appId, report);
  return report;
}

/** Bieżąca wersja z aktualnym raportem i planem poprawek; bez aktualnej oceny 409 (kandydat ma najpierw ją zobaczyć). */
async function currentPlan(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  const current = await store.getVersion(profileId, appId, app.currentVersion);
  const report = await store.getReport(profileId, appId, current.version);
  if (!report || report.createdAt < current.updatedAt) throw new HttpError(409, tr('CV zmieniło się od ostatniej oceny: najpierw kliknij „Oceń ponownie”, żeby zobaczyć aktualne poprawki.'));
  const profile = await store.getProfile(profileId);
  const base = applyDecisions(current);
  return { app, posting: app.posting, current, report, profile, base, plan: improvePlan(report, profile, app.posting, base) };
}

/** Lista do wyboru przed "Popraw automatycznie": poprawki rekrutera, słowa kluczowe, kryteria, powtórzenia, format dat. */
export async function improveChoices(profileId: string, appId: string): Promise<ImproveOptions> {
  const { plan, report, current } = await currentPlan(profileId, appId);
  return { options: improveOptions(plan, current.content.language), needsInput: plan.needsInput, pages: report.format.pages };
}

/**
 * "Popraw automatycznie" z tym, co kandydat zaznaczył (`items` = id z improveChoices). AI zmienia tylko te miejsca,
 * format dat program poprawia sam, a reszta CV zostaje bez zmian; CV dłuższego niż strona nie skracamy samodzielnie.
 * Nowa wersja zostaje bieżącą tylko wtedy, gdy nie wypadła gorzej; gorsza jest zapisana na liście wersji.
 */
export async function improve(profileId: string, appId: string, items: string[]): Promise<ImproveResult> {
  if (!items.length) throw new HttpError(400, tr('Zaznacz, co AI ma poprawić.'));
  const { app, posting, current, report, profile, base, plan: full } = await currentPlan(profileId, appId);
  const plan = selectPlan(full, items);
  const dates = items.includes('dates') && full.format.some((f) => f.id === 'dates');
  const before = honestReport(report)?.total ?? null;
  if (!hasWork(plan) && !dates) throw new HttpError(409, tr('Zaznaczonych poprawek nie ma już w raporcie. Odśwież stronę albo oceń CV ponownie.'));

  let content = base;
  const changes: string[] = [];
  let notes = '';
  if (hasWork(plan)) {
    const r = await improveCv(profile, posting, base, plan, ctxOf(app, 'poprawa CV'), () => `t${nanoid(8)}`);
    content = r.content;
    changes.push(...r.changes);
    notes = r.notes;
  }
  if (dates) {
    const unified = unifyDates(content, profile);
    if (JSON.stringify(unified) !== JSON.stringify(content)) {
      content = unified;
      changes.push(tr('format dat'));
    }
  }
  if (!changes.length) {
    return { kept: 'none', version: null, before, after: null, needsInput: plan.needsInput, message: notes || tr('AI nie znalazło nic do zmiany w zaznaczonych miejscach, więc nowa wersja nie powstała.') };
  }
  content = { ...content, notes: notes || base.notes };
  const { pages } = await htmlToPdf(await renderCv(profile, { ...current, content, decisions: {} }, 'pdf'));
  const t = nowIso();
  const cv = await store.addVersion(profileId, appId, (version) => ({ ...current, version, createdAt: t, updatedAt: t, origin: 'improved', content, decisions: {} }));
  const next = await evaluate(profileId, appId, cv.version);
  const better = notWorse(next, report);
  if (better) {
    await store.updateApplication(profileId, appId, (a) => {
      a.currentVersion = cv.version;
    });
  }
  const message = [
    tr('Zmienione: {items}.', { items: changes.join(', ') }),
    notes,
    pages > 1 ? tr('CV nie mieści się już na jednej stronie: usuń coś w edytorze albo kliknij „Skróć do 1 strony”.') : '',
  ];
  return { kept: better ? 'new' : 'old', version: cv.version, before, after: honestReport(next)?.total ?? null, needsInput: plan.needsInput, message: message.filter(Boolean).join('\n') };
}

/**
 * Umiejętności z CV, których nie da się znaleźć w profilu - ostrzeżenie dla kandydata w edytorze (ta sama reguła,
 * co przy generowaniu: unverifiedSkillItems w cvChecks.ts).
 */
export function unverifiedSkills(cv: CvVersion, profile: Profile, posting: JobPosting | null = null): string[] {
  return unverifiedSkillItems(cv.content, profile, posting?.keywords ?? []);
}

export function pendingSuggestions(cv: CvVersion): number {
  const c = cv.content;
  const all = [...(c.headlineSuggestion ? [c.headlineSuggestion] : []), c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)];
  return all.filter((t) => t.status === 'suggested' && !cv.decisions[t.id]).length;
}

// ---------- Projekty z GitHuba ----------

/**
 * Publiczne repozytoria z GitHuba → projekty w profilu. Dopisuje nowe projekty, brakujące technologie jako umiejętności
 * i link do konta, a w projektach z linkiem do repozytorium, które zmieniło się od ostatniego razu, nowe punkty i technologie
 * (niczego nie usuwa ani nie przepisuje). Zapis od razu, na świeżo odczytanym profilu (bezpieczny przy autozapisie).
 */
export async function importGithub(profileId: string, input: string): Promise<GithubImportResult> {
  const login = parseGithubUser(input);
  if (!login) throw new HttpError(400, tr('Podaj nazwę użytkownika z GitHuba albo link do profilu, np. github.com/jan-kowalski.'));
  const profile = await store.getProfile(profileId);
  // Repozytoria z profilu bez zmian od ostatniego razu nie idą do AI (mniej zapytań do GitHuba i taniej).
  const data = await fetchGithub(login, repoState(profile));
  const lang = profileLanguage(profile);
  const ctx = { profileId, task: 'projekty z GitHuba' };
  const [texts, updates] = await Promise.all([describeGithubRepos(data, lang, ctx), describeGithubUpdates(data, profile, lang, ctx)]);
  const now = Date.now();
  const projects = data.repos.map((r, i) => githubProject(r, texts[i], lang, now));
  let merged!: GithubMerge;
  let changed!: GithubUpdateMerge;
  const saved = await store.updateProfile(profileId, (cur) => {
    merged = mergeGithubProjects(cur, projects, data.login);
    changed = applyGithubUpdates(merged.profile, updates);
    return { ...changed.profile, githubSync: { ...cur.githubSync, ...data.seen } };
  });
  return {
    profile: saved,
    added: { projects: merged.added.projects, skills: [...merged.added.skills, ...changed.skills] },
    updated: changed.updated,
    newIds: [...merged.newIds, ...changed.updatedIds, ...changed.skillIds],
    updatedIds: changed.updatedIds,
  };
}

// ---------- Eksport ----------

const fileSafe = (s: string) =>
  s
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/** "PRZYKŁADOWA FIRMA Spółka z ograniczoną odpowiedzialnością" → "PRZYKŁADOWA FIRMA" (krótsza nazwa pliku). */
export const shortCompany = (s: string) =>
  s
    .replace(/(?:,\s*|\s+)(sp[óo]łka\s+z\s+ograniczon\S+\s+odpowiedzialno\S+|sp\.?\s*z\s*o\.?\s*o\.?|sp[óo]łka\s+akcyjna|s\.?\s*a\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|gmbh|ltd\.?|inc\.?|llc)\s*$/i, '')
    .trim();

export async function exportPdf(profileId: string, appId: string): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  if (!app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, app.currentVersion)]);
  const pending = pendingSuggestions(cv);
  if (pending) throw new HttpError(409, tr('Zatwierdź albo odrzuć {n} sugestie (żółte fragmenty), zanim pobierzesz PDF.', { n: pending }));
  const { pdf } = await htmlToPdf(await renderCv(profile, cv, 'pdf'));
  const name = [profile.contact.fullName || profile.displayName, 'CV', shortCompany(app.posting?.company ?? ''), app.posting?.title].filter(Boolean).map((x) => fileSafe(String(x))).filter(Boolean).join('_');
  const file = `${name || 'CV'}.pdf`;
  return store.updateApplication(profileId, appId, async (a) => {
    if (a.pdfFile && a.pdfFile !== file) await fs.rm(path.join(store.appDir(profileId, appId), a.pdfFile), { force: true });
    await fs.writeFile(path.join(store.appDir(profileId, appId), file), pdf);
    a.pdfFile = file;
    if (a.status === 'szkic' || a.status === 'przygotowane') a.status = 'wysłane';
  });
}

// ---------- Dodatki ----------

export async function makeInterviewPrep(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  const profile = await store.getProfile(profileId);
  const { text } = await versionPdf(profileId, appId, app.currentVersion);
  const prep = await interviewPrep(profile, app.posting, text, ctxOf(app, 'przygotowanie do rozmowy'));
  await store.saveInterviewPrep(profileId, appId, prep);
  await store.updateApplication(profileId, appId, (a) => {
    a.hasInterviewPrep = true;
  });
  return prep;
}

/** Kursy i certyfikaty pod to ogłoszenie: na kliknięcie, gdy CV już jest (braki z ostatniej oceny pomagają wybrać). */
export async function makeCourses(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, tr('Najpierw wygeneruj CV.'));
  const [profile, report] = await Promise.all([store.getProfile(profileId), store.getReport(profileId, appId, app.currentVersion)]);
  const missing = (report?.keywords.missing ?? []).map((k) => k.term);
  const advice = await courseAdvice(profile, app.posting, missing, ctxOf(app, 'kursy i certyfikaty'));
  await store.saveCourses(profileId, appId, advice);
  await store.updateApplication(profileId, appId, (a) => {
    a.hasCourses = true;
  });
  return advice;
}

export async function makeCoverLetter(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, tr('Brak przeanalizowanego ogłoszenia.'));
  const profile = await store.getProfile(profileId);
  const cv = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion) : null;
  const lang = cv?.content.language ?? decideLanguage(app.posting);
  const letter = await coverLetter(profile, app.posting, lang, ctxOf(app, 'list motywacyjny'));
  await store.saveCoverLetter(profileId, appId, letter);
  await store.updateApplication(profileId, appId, (a) => {
    a.hasCoverLetter = true;
  });
  return letter;
}

export async function letterPdf(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  const letter = await store.getCoverLetter(profileId, appId);
  if (!letter || !app.posting) throw new HttpError(404, tr('Brak listu motywacyjnego.'));
  const profile = await store.getProfile(profileId);
  const cv = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion) : null;
  const html = renderLetterHtml(letter, profile, cv?.template ?? 'modern', app.posting, 'pdf');
  const { pdf } = await htmlToPdf(html);
  const name = `${fileSafe(profile.contact.fullName || 'List')}_List_motywacyjny_${fileSafe(shortCompany(app.posting.company))}.pdf`;
  return { pdf, name };
}

export async function letterPreview(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  const letter = await store.getCoverLetter(profileId, appId);
  if (!letter || !app.posting) throw new HttpError(404, tr('Brak listu motywacyjnego.'));
  const profile = await store.getProfile(profileId);
  const cv = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion) : null;
  return renderLetterHtml(letter, profile, cv?.template ?? 'modern', app.posting, 'preview');
}
