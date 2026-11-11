import path from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { ApplicationStatuses, CoverLetterSchema, CvVersionSchema, GapAnswerSchema, TemplateIds, type ApplicationSummary } from '../../shared/schemas';
import * as store from '../storage/store';
import { HttpError } from '../storage/store';
import * as svc from '../services';
import * as mock from '../mockInterview';
import { honestReport } from '../ats/score';
import { tr } from '../i18n';

export const applicationsRouter = Router();

const base = '/profiles/:pid/applications';

const sendPdf = (res: Response, pdf: Buffer, name: string, download: boolean) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(pdf);
};

const num = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, tr('Nieprawidłowy numer wersji'));
  return n;
};

applicationsRouter.get(base, async (req, res) => {
  const { pid } = req.params;
  const [apps, usage, profile] = await Promise.all([store.listApplications(pid), store.readUsage(), store.getProfile(pid)]);
  const out: ApplicationSummary[] = [];
  for (const a of apps) {
    const report = honestReport(a.currentVersion ? await store.getReport(pid, a.id, a.currentVersion) : null);
    const costUsd = usage.filter((u) => u.applicationId === a.id).reduce((s, u) => s + u.cost, 0);
    const profileNews = await svc.profileNewsCount(profile, a);
    const { rawText, ...rest } = a;
    out.push({ ...rest, rawText: '', costUsd, score: report?.total ?? null, scoreIncomplete: !!report && report.total === null, profileNews });
  }
  res.json(out);
});

applicationsRouter.post(base, async (req, res) => {
  const app = await svc.createApplication(req.params.pid, String(req.body?.url ?? ''), String(req.body?.text ?? ''));
  res.status(201).json(app);
});

applicationsRouter.get(`${base}/:aid`, async (req, res) => {
  const { pid, aid } = req.params;
  const app = await store.getApplication(pid, aid);
  const [versions, usage, profile] = await Promise.all([store.listVersions(pid, aid), store.readUsage(), store.getProfile(pid)]);
  const reports = (await Promise.all(versions.map((v) => store.getReport(pid, aid, v.version)))).map(honestReport);
  res.json({
    application: app,
    versions: versions.map((v, i) => ({
      version: v.version,
      createdAt: v.createdAt,
      origin: v.origin,
      score: reports[i]?.total ?? null,
      scoreIncomplete: !!reports[i] && reports[i]?.total === null,
    })),
    costUsd: usage.filter((u) => u.applicationId === aid).reduce((s, u) => s + u.cost, 0),
    hasPhoto: !!profile.photo,
    // Tematy, które kandydat przy tej aplikacji potwierdził w profilu (pytania o braki, "mam to" w raporcie).
    factTopics: profile.extraFacts.filter((f) => f.has && f.id === svc.answerFactId(aid, f.topic)).map((f) => f.topic),
    profileNews: await svc.profileNewsCount(profile, app),
  });
});

applicationsRouter.post(`${base}/:aid/sync-profile`, async (req, res) => {
  res.json(await svc.syncWithProfile(req.params.pid, req.params.aid));
});

applicationsRouter.patch(`${base}/:aid`, async (req, res) => {
  const { pid, aid } = req.params;
  const { status, notes, currentVersion } = req.body ?? {};
  // Zmiana na aktualnej wersji z dysku: zapis z trwającego generowania CV nie cofnie notatki ani statusu (i odwrotnie).
  const app = await store.updateApplication(pid, aid, async (app) => {
    if (status !== undefined) {
      if (!ApplicationStatuses.includes(status)) throw new HttpError(400, tr('Nieznany status'));
      app.status = status;
    }
    if (typeof notes === 'string') app.notes = notes;
    if (currentVersion !== undefined) {
      const v = num(String(currentVersion));
      await store.getVersion(pid, aid, v);
      app.currentVersion = v;
    }
  });
  res.json(app);
});

applicationsRouter.delete(`${base}/:aid`, async (req, res) => {
  await store.getApplication(req.params.pid, req.params.aid);
  await store.deleteApplication(req.params.pid, req.params.aid);
  res.json({ ok: true });
});

applicationsRouter.post(`${base}/:aid/gap`, async (req, res) => {
  res.json(await svc.runGapAnalysis(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/answers`, async (req, res) => {
  const parsed = GapAnswerSchema.array().safeParse(req.body?.answers ?? []);
  if (!parsed.success) throw new HttpError(400, tr('Niepoprawne odpowiedzi'));
  res.json(await svc.saveAnswers(req.params.pid, req.params.aid, parsed.data));
});

// "Mam to" przy brakującym słowie kluczowym i dane do poprawki rekrutera, wpisane w raporcie.
const FactsSchema = z.array(z.object({ topic: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) })).min(1).max(20);
applicationsRouter.post(`${base}/:aid/facts`, async (req, res) => {
  const parsed = FactsSchema.safeParse(req.body?.facts);
  if (!parsed.success) throw new HttpError(400, tr('Napisz krótko, gdzie i jak tego używasz.'));
  res.json({ saved: await svc.addFacts(req.params.pid, req.params.aid, parsed.data) });
});

applicationsRouter.post(`${base}/:aid/generate`, async (req, res) => {
  const lang = req.body?.language;
  const template = req.body?.template;
  res.json(
    await svc.generate(
      req.params.pid,
      req.params.aid,
      lang === 'pl' || lang === 'en' ? lang : undefined,
      TemplateIds.includes(template) ? template : undefined,
    ),
  );
});

applicationsRouter.post(`${base}/:aid/improve/options`, async (req, res) => {
  res.json(await svc.improveChoices(req.params.pid, req.params.aid));
});

// Id pozycji, które kandydat zaznaczył w raporcie (z /improve/options).
const ImproveItemsSchema = z.array(z.string().min(1).max(200)).max(100);
applicationsRouter.post(`${base}/:aid/improve`, async (req, res) => {
  const parsed = ImproveItemsSchema.safeParse(req.body?.items ?? []);
  if (!parsed.success) throw new HttpError(400, tr('Zaznacz, co AI ma poprawić.'));
  res.json(await svc.improve(req.params.pid, req.params.aid, parsed.data));
});

applicationsRouter.get(`${base}/:aid/versions/:v`, async (req, res) => {
  const { pid, aid } = req.params;
  const v = num(req.params.v);
  const [cv, report, profile, app] = await Promise.all([store.getVersion(pid, aid, v), store.getReport(pid, aid, v), store.getProfile(pid), store.getApplication(pid, aid)]);
  res.json({
    cv,
    report: honestReport(report),
    reportStale: !!report && report.createdAt < cv.updatedAt,
    pending: svc.pendingSuggestions(cv),
    unverifiedSkills: svc.unverifiedSkills(cv, profile, app.posting),
  });
});

applicationsRouter.put(`${base}/:aid/versions/:v`, async (req, res) => {
  const parsed = CvVersionSchema.pick({ content: true, decisions: true, template: true, photo: true, rodo: true }).partial().safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, tr('Niepoprawne dane CV: {field}', { field: parsed.error.issues[0]?.path.join('.') ?? '' }));
  const { cv, profileUpdates } = await svc.updateVersion(req.params.pid, req.params.aid, num(req.params.v), parsed.data);
  res.json({ cv, pending: svc.pendingSuggestions(cv), profileUpdates });
});

applicationsRouter.post(`${base}/:aid/versions/:v/instruct`, async (req, res) => {
  res.json(await svc.instructVersion(req.params.pid, req.params.aid, num(req.params.v), String(req.body?.instruction ?? '')));
});

applicationsRouter.post(`${base}/:aid/versions/:v/shorten`, async (req, res) => {
  res.json({ cv: await svc.shortenVersion(req.params.pid, req.params.aid, num(req.params.v)) });
});

applicationsRouter.post(`${base}/:aid/versions/:v/evaluate`, async (req, res) => {
  res.json(await svc.evaluate(req.params.pid, req.params.aid, num(req.params.v)));
});

applicationsRouter.get(`${base}/:aid/versions/:v/preview`, async (req, res) => {
  res.type('html').send(await svc.previewHtml(req.params.pid, req.params.aid, num(req.params.v)));
});

applicationsRouter.get(`${base}/:aid/versions/:v/pdf`, async (req, res) => {
  const { pdf } = await svc.versionPdf(req.params.pid, req.params.aid, num(req.params.v));
  sendPdf(res, pdf, `CV_podglad_v${req.params.v}.pdf`, false);
});

applicationsRouter.post(`${base}/:aid/export`, async (req, res) => {
  res.json(await svc.exportPdf(req.params.pid, req.params.aid));
});

applicationsRouter.get(`${base}/:aid/download`, async (req, res) => {
  const { pid, aid } = req.params;
  const app = await store.getApplication(pid, aid);
  if (!app.pdfFile) throw new HttpError(404, tr('Ten PDF nie został jeszcze zapisany.'));
  res.download(path.join(store.appDir(pid, aid), app.pdfFile), app.pdfFile);
});

applicationsRouter.get(`${base}/:aid/interview`, async (req, res) => {
  res.json(await store.getInterviewPrep(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/interview`, async (req, res) => {
  res.json(await svc.makeInterviewPrep(req.params.pid, req.params.aid));
});

// Próbna rozmowa: pytania po jednym, ocena każdej odpowiedzi, podsumowanie (server/mockInterview.ts).
applicationsRouter.get(`${base}/:aid/mock`, async (req, res) => {
  res.json(await mock.getMock(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/mock/start`, async (req, res) => {
  res.json(await mock.startMock(req.params.pid, req.params.aid, req.body?.restart === true));
});

applicationsRouter.post(`${base}/:aid/mock/answer`, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  res.json(await mock.answerMock(req.params.pid, req.params.aid, text));
});

applicationsRouter.post(`${base}/:aid/mock/skip`, async (req, res) => {
  res.json(await mock.skipMock(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/mock/finish`, async (req, res) => {
  res.json(await mock.finishMock(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/mock/facts`, async (req, res) => {
  const parsed = z.object({ answerId: z.string(), index: z.number().int().min(0) }).safeParse(req.body ?? {});
  if (!parsed.success) throw new HttpError(400, tr('Niepoprawne dane faktu'));
  res.json(await mock.addMockFact(req.params.pid, req.params.aid, parsed.data.answerId, parsed.data.index));
});

applicationsRouter.delete(`${base}/:aid/mock`, async (req, res) => {
  res.json(await mock.clearMock(req.params.pid, req.params.aid));
});

applicationsRouter.get(`${base}/:aid/courses`, async (req, res) => {
  res.json(await store.getCourses(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/courses`, async (req, res) => {
  res.json(await svc.makeCourses(req.params.pid, req.params.aid));
});

applicationsRouter.get(`${base}/:aid/letter`, async (req, res) => {
  res.json(await store.getCoverLetter(req.params.pid, req.params.aid));
});

applicationsRouter.post(`${base}/:aid/letter`, async (req, res) => {
  res.json(await svc.makeCoverLetter(req.params.pid, req.params.aid));
});

applicationsRouter.put(`${base}/:aid/letter`, async (req, res) => {
  const parsed = CoverLetterSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, tr('Niepoprawny list'));
  await store.saveCoverLetter(req.params.pid, req.params.aid, parsed.data);
  res.json(parsed.data);
});

applicationsRouter.get(`${base}/:aid/letter/preview`, async (req, res) => {
  res.type('html').send(await svc.letterPreview(req.params.pid, req.params.aid));
});

applicationsRouter.get(`${base}/:aid/letter/pdf`, async (req, res) => {
  const { pdf, name } = await svc.letterPdf(req.params.pid, req.params.aid);
  sendPdf(res, pdf, name, req.query.download === '1');
});
