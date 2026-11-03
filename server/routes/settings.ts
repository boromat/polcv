import { Router } from 'express';
import * as store from '../storage/store';
import { checkKey, listModels } from '../llm/openrouter';
import { activeSearchers, localPortalNames } from '../jobs/search';
import { installPolanon, polanonStatus } from '../privacy/polanon';
import type { Settings } from '../../shared/schemas';
import { tr } from '../i18n';

export const maskKey = (k: string) => (k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '');

export const settingsRouter = Router();

const view = async ({ apiKey, ...rest }: Settings) => ({
  apiKeyMasked: maskKey(apiKey),
  hasKey: !!apiKey,
  ...rest,
  searchPortals: Object.values(await activeSearchers()).map((s) => s.name),
  localPortals: await localPortalNames(),
});

settingsRouter.get('/settings', async (_req, res) => {
  res.json(await view(await store.getSettings()));
});

settingsRouter.put('/settings', async (req, res) => {
  const { apiKey, mainModel, fastModel, jobSearch, maskPii, maskPiiNer, pythonPath } = req.body ?? {};
  const patch: Partial<Settings> = {};
  if (typeof apiKey === 'string') patch.apiKey = apiKey.trim();
  if (typeof mainModel === 'string' && mainModel) patch.mainModel = mainModel;
  if (typeof fastModel === 'string' && fastModel) patch.fastModel = fastModel;
  if (typeof jobSearch === 'boolean') patch.jobSearch = jobSearch;
  if (typeof maskPii === 'boolean') patch.maskPii = maskPii;
  if (typeof maskPiiNer === 'boolean') patch.maskPiiNer = maskPiiNer;
  if (typeof pythonPath === 'string') patch.pythonPath = pythonPath.trim();
  res.json(await view(await store.saveSettings(patch)));
});

settingsRouter.get('/settings/polanon', async (_req, res) => {
  res.json(await polanonStatus(await store.getSettings()));
});

settingsRouter.post('/settings/polanon/install', async (_req, res) => {
  res.json(await installPolanon(await store.getSettings()));
});

settingsRouter.post('/settings/check-key', async (req, res) => {
  const key = String(req.body?.apiKey || '').trim() || (await store.getSettings()).apiKey;
  if (!key) return res.json({ ok: false, message: tr('Brak klucza.') });
  res.json(await checkKey(key));
});

settingsRouter.get('/models', async (_req, res) => {
  res.json(await listModels());
});

settingsRouter.get('/usage', async (_req, res) => {
  const [usage, profiles] = await Promise.all([store.readUsage(), store.listProfiles()]);
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.displayName]));
  const byProfile: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  let total = 0;
  for (const u of usage) {
    total += u.cost;
    const n = names[u.profileId] ?? tr('usunięty profil');
    byProfile[n] = (byProfile[n] ?? 0) + u.cost;
    byTask[u.task] = (byTask[u.task] ?? 0) + u.cost;
  }
  res.json({ total, byProfile, byTask, calls: usage.length, recent: usage.slice(-30).reverse() });
});
