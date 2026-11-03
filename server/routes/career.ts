import { Router } from 'express';
import { CareerPrefsSchema } from '../../shared/schemas';
import * as store from '../storage/store';
import { HttpError } from '../storage/store';
import * as career from '../career';

export const careerRouter = Router();

const base = '/profiles/:pid/career';
// Długi opis doświadczenia to cenny materiał dla doradcy - limit chroni tylko przed przypadkowym wklejeniem całych dokumentów.
const MAX_MESSAGE = 15_000;

careerRouter.get(base, async (req, res) => {
  res.json(await store.getCareer(req.params.pid));
});

careerRouter.post(`${base}/chat`, async (req, res) => {
  const message = String(req.body?.message ?? '');
  if (message.length > MAX_MESSAGE) throw new HttpError(400, `Wiadomość jest za długa (maks. ${MAX_MESSAGE} znaków).`);
  res.json(await career.chat(req.params.pid, message));
});

careerRouter.post(`${base}/reset`, async (req, res) => {
  res.json(await career.resetChat(req.params.pid));
});

careerRouter.put(`${base}/prefs`, async (req, res) => {
  const parsed = CareerPrefsSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, `Niepoprawne preferencje: ${parsed.error.issues[0]?.path.join('.')}`);
  res.json(await career.savePrefs(req.params.pid, parsed.data));
});

careerRouter.post(`${base}/proposals`, async (req, res) => {
  res.json(await career.makeProposals(req.params.pid));
});

careerRouter.post(`${base}/roles/:roleId/offers`, async (req, res) => {
  res.json(await career.findOffers(req.params.pid, req.params.roleId));
});
