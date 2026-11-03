import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Application, CvContent, CvVersion, GapAnswer, Profile, TemplateId } from '../shared/schemas';
import * as store from './storage/store';
import { HttpError, newId, nowIso } from './storage/store';
import { fetchPosting } from './jobs/fetchPosting';
import { parsePosting } from './llm/prompts/parsePosting';
import { gapQuestions } from './llm/prompts/gapQuestions';
import { generateCv, improveCv } from './llm/prompts/generateCv';
import { evaluateCv } from './llm/prompts/evaluateCv';
import { coverLetter, interviewPrep } from './llm/prompts/extras';
import { applyDecisions } from './llm/prompts/common';
import { decideLanguage, decidePhoto, decideRodo } from './cv/rodo';
import { photoDataUri, renderCvHtml, renderLetterHtml, type RenderMode } from './cv/render';
import { htmlToPdf } from './cv/pdf';
import { buildReport } from './ats/score';
import { countPhrase, tokenize } from './ats/keywords';

const ctxOf = (app: Application, task: string) => ({ profileId: app.profileId, applicationId: app.id, task });

// ---------- Ogłoszenie ----------

export async function createApplication(profileId: string, url: string, pastedText: string): Promise<Application> {
  await store.getProfile(profileId);
  let rawText = pastedText.trim();
  let fetchMethod = 'wklejony tekst';
  if (!rawText) {
    if (!url.trim()) throw new HttpError(400, 'Podaj link do ogłoszenia albo wklej jego treść.');
    const fetched = await fetchPosting(url);
    rawText = fetched.text;
    fetchMethod = fetched.method;
  }
  if (rawText.length < 200) throw new HttpError(400, 'Treść ogłoszenia jest za krótka — wklej całe ogłoszenie.');

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
  };
  app.posting = await parsePosting(rawText, app.url, ctxOf(app, 'analiza ogłoszenia'));
  return store.saveApplication(app);
}

// ---------- Pytania o braki ----------

export async function runGapAnalysis(profileId: string, appId: string): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, 'Najpierw trzeba przeanalizować ogłoszenie.');
  const profile = await store.getProfile(profileId);
  const gap = await gapQuestions(profile, app.posting, ctxOf(app, 'pytania o braki'));
  app.gap = { questions: gap.questions, covered: gap.covered, answers: [] };
  return store.saveApplication(app);
}

/** Odpowiedzi trafiają do profilu (extraFacts), żeby kolejne CV już ich nie pytały. */
export async function saveAnswers(profileId: string, appId: string, answers: GapAnswer[]): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  const profile = await store.getProfile(profileId);
  const source = `Odpowiedź przy aplikacji: ${app.posting?.title ?? ''} – ${app.posting?.company ?? ''}`.trim();
  for (const a of answers) {
    if (!a.has && !a.answer.trim()) continue;
    profile.extraFacts.push({
      id: newId(),
      topic: a.requirement,
      has: a.has,
      answer: a.has ? a.answer.trim() : a.answer.trim() || 'Nie znam / nie mam doświadczenia.',
      source,
      date: nowIso().slice(0, 10),
    });
  }
  await store.saveProfile(profile);
  app.gap = { ...(app.gap ?? { questions: [], covered: [] }), answers };
  return store.saveApplication(app);
}

// ---------- CV ----------

/** Kolejny numer wersji po najwyższej istniejącej (użytkownik mógł wrócić do starszej). */
async function nextVersion(profileId: string, appId: string): Promise<number> {
  const versions = await store.listVersions(profileId, appId);
  return versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
}

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
  if (!app.posting) throw new HttpError(409, 'Brak przeanalizowanego ogłoszenia.');
  const profile = await store.getProfile(profileId);
  const lang = language ?? decideLanguage(app.posting);
  const content = withFreshIds(await generateCv(profile, app.posting, lang, ctxOf(app, 'pisanie CV')));
  content.language = lang;

  const prev = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion).catch(() => null) : null;
  const photo = decidePhoto(app.posting, lang, !!profile.photo);
  const rodo = decideRodo(app.posting, lang);
  const t = nowIso();
  const cv: CvVersion = {
    version: await nextVersion(profileId, appId),
    createdAt: t,
    updatedAt: t,
    origin: 'generated',
    content,
    decisions: {},
    template: template ?? prev?.template ?? 'modern',
    photo: photo.include,
    photoReason: photo.reason,
    rodo,
  };
  await store.saveVersion(profileId, appId, cv);
  app.currentVersion = cv.version;
  if (app.status === 'szkic') app.status = 'przygotowane';
  await store.saveApplication(app);
  return cv;
}

export async function updateVersion(profileId: string, appId: string, v: number, patch: Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>): Promise<CvVersion> {
  const cv = await store.getVersion(profileId, appId, v);
  // Zapis bez faktycznej zmiany nie może unieważniać oceny.
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(cv[k]));
  if (!changed) return cv;
  const next: CvVersion = { ...cv, ...patch, version: cv.version, updatedAt: nowIso() };
  await store.saveVersion(profileId, appId, next);
  return next;
}

export async function setCurrentVersion(profileId: string, appId: string, v: number): Promise<Application> {
  await store.getVersion(profileId, appId, v);
  const app = await store.getApplication(profileId, appId);
  app.currentVersion = v;
  return store.saveApplication(app);
}

async function renderCv(profile: Profile, cv: CvVersion, mode: RenderMode): Promise<string> {
  const photo = photoDataUri(store.profileDir(profile.id), profile.photo);
  return renderCvHtml(cv, profile, photo, mode);
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
  if (!app.posting) throw new HttpError(409, 'Brak przeanalizowanego ogłoszenia.');
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, v)]);
  const { text, pages } = await htmlToPdf(await renderCv(profile, cv, 'pdf'));

  let review = null;
  let aiError = '';
  try {
    review = await evaluateCv(text, app.posting, ctxOf(app, 'ocena AI-rekrutera'));
  } catch (e: any) {
    // Brak klucza / zły klucz / brak środków / niedziałające maskowanie — przerywamy, żeby nie pokazać zawyżonego, niepełnego wyniku.
    if (e instanceof HttpError && [400, 401, 402, 503].includes(e.status)) throw e;
    aiError = e.message || 'Nie udało się uzyskać oceny AI.';
  }
  const report = buildReport({ version: v, pdfText: text, pages, cv: applyDecisions(cv), profile, posting: app.posting, review, aiError });
  await store.saveReport(profileId, appId, report);
  return report;
}

export async function improve(profileId: string, appId: string): Promise<CvVersion> {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, 'Najpierw wygeneruj CV.');
  const current = await store.getVersion(profileId, appId, app.currentVersion);
  let report = await store.getReport(profileId, appId, current.version);
  if (!report || report.createdAt < current.updatedAt) report = await evaluate(profileId, appId, current.version);
  const profile = await store.getProfile(profileId);
  const content = withFreshIds(await improveCv(profile, app.posting, applyDecisions(current), report, ctxOf(app, 'poprawa CV')));
  content.language = current.content.language;
  const t = nowIso();
  const version = await nextVersion(profileId, appId);
  const cv: CvVersion = { ...current, version, createdAt: t, updatedAt: t, origin: 'improved', content, decisions: {} };
  await store.saveVersion(profileId, appId, cv);
  app.currentVersion = cv.version;
  await store.saveApplication(app);
  return cv;
}

/** Umiejętności z CV, których nie da się znaleźć w profilu — ostrzeżenie dla kandydata. */
export function unverifiedSkills(cv: CvVersion, profile: Profile): string[] {
  const facts = profile.extraFacts.filter((f) => f.has).map((f) => `${f.topic} ${f.answer}`);
  const source = [
    ...profile.skills.map((s) => s.name),
    ...profile.experience.flatMap((e) => [e.role, e.description, ...e.achievements]),
    ...profile.projects.flatMap((p) => [p.name, p.description, ...p.technologies, ...p.achievements]),
    ...profile.education.flatMap((e) => [e.field, e.details]),
    ...profile.certificates.map((c) => `${c.name} ${c.issuer}`),
    ...profile.languages.map((l) => l.name),
    profile.summary,
    ...facts,
  ].join(' \n ');
  const tokens = tokenize(source);
  // CV po angielsku z polskiego profilu: zwykłe słowa ("Teamwork") są tłumaczeniami, więc
  // sprawdzamy tylko nazwy techniczne (wielkie litery w środku, cyfry, znaki typu C++/CI/CD).
  const profileIsPolish = /[ąćęłńóśźż]/i.test(source);
  const technical = (s: string) => /\d|[+#/.]|\S[A-Z]|\s[A-Z]/.test(s);
  return cv.content.skills
    .flatMap((g) => g.items)
    .filter((item) => {
      const base = item.replace(/\s*\(.*?\)\s*/g, ' ').trim(); // "Power BI (raporty)" → "Power BI"
      if (!base) return false;
      if (cv.content.language === 'en' && profileIsPolish && !technical(base)) return false;
      return countPhrase(tokens, base) === 0;
    });
}

export function pendingSuggestions(cv: CvVersion): number {
  const all = [cv.content.summary, ...cv.content.experience.flatMap((e) => e.bullets), ...cv.content.projects.flatMap((p) => p.bullets)];
  return all.filter((t) => t.status === 'suggested' && !cv.decisions[t.id]).length;
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

/** "CLOUDFIDE Spółka z ograniczoną odpowiedzialnością" → "CLOUDFIDE" (krótsza nazwa pliku). */
export const shortCompany = (s: string) =>
  s
    .replace(/(?:,\s*|\s+)(sp[óo]łka\s+z\s+ograniczon\S+\s+odpowiedzialno\S+|sp\.?\s*z\s*o\.?\s*o\.?|sp[óo]łka\s+akcyjna|s\.?\s*a\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|gmbh|ltd\.?|inc\.?|llc)\s*$/i, '')
    .trim();

export async function exportPdf(profileId: string, appId: string): Promise<Application> {
  const app = await store.getApplication(profileId, appId);
  if (!app.currentVersion) throw new HttpError(409, 'Najpierw wygeneruj CV.');
  const [profile, cv] = await Promise.all([store.getProfile(profileId), store.getVersion(profileId, appId, app.currentVersion)]);
  const pending = pendingSuggestions(cv);
  if (pending) throw new HttpError(409, `Zatwierdź albo odrzuć ${pending} sugestie (żółte fragmenty), zanim pobierzesz PDF.`);
  const { pdf } = await htmlToPdf(await renderCv(profile, cv, 'pdf'));
  const name = [profile.contact.fullName || profile.displayName, 'CV', shortCompany(app.posting?.company ?? ''), app.posting?.title].filter(Boolean).map((x) => fileSafe(String(x))).filter(Boolean).join('_');
  const file = `${name || 'CV'}.pdf`;
  if (app.pdfFile && app.pdfFile !== file) await fs.rm(path.join(store.appDir(profileId, appId), app.pdfFile), { force: true });
  await fs.writeFile(path.join(store.appDir(profileId, appId), file), pdf);
  app.pdfFile = file;
  if (app.status === 'szkic' || app.status === 'przygotowane') app.status = 'wysłane';
  return store.saveApplication(app);
}

// ---------- Dodatki ----------

export async function makeInterviewPrep(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting || !app.currentVersion) throw new HttpError(409, 'Najpierw wygeneruj CV.');
  const profile = await store.getProfile(profileId);
  const { text } = await versionPdf(profileId, appId, app.currentVersion);
  const prep = await interviewPrep(profile, app.posting, text, ctxOf(app, 'przygotowanie do rozmowy'));
  await store.saveInterviewPrep(profileId, appId, prep);
  app.hasInterviewPrep = true;
  await store.saveApplication(app);
  return prep;
}

export async function makeCoverLetter(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  if (!app.posting) throw new HttpError(409, 'Brak przeanalizowanego ogłoszenia.');
  const profile = await store.getProfile(profileId);
  const cv = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion) : null;
  const lang = cv?.content.language ?? decideLanguage(app.posting);
  const letter = await coverLetter(profile, app.posting, lang, ctxOf(app, 'list motywacyjny'));
  await store.saveCoverLetter(profileId, appId, letter);
  app.hasCoverLetter = true;
  await store.saveApplication(app);
  return letter;
}

export async function letterPdf(profileId: string, appId: string) {
  const app = await store.getApplication(profileId, appId);
  const letter = await store.getCoverLetter(profileId, appId);
  if (!letter || !app.posting) throw new HttpError(404, 'Brak listu motywacyjnego.');
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
  if (!letter || !app.posting) throw new HttpError(404, 'Brak listu motywacyjnego.');
  const profile = await store.getProfile(profileId);
  const cv = app.currentVersion ? await store.getVersion(profileId, appId, app.currentVersion) : null;
  return renderLetterHtml(letter, profile, cv?.template ?? 'modern', app.posting, 'preview');
}
