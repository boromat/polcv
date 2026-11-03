import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { ProfileSchema, type Profile, type ProfileExtract } from '../../shared/schemas';
import * as store from '../storage/store';
import { HttpError, newId, nowIso } from '../storage/store';
import { cvFileToText } from '../cv/importCv';
import { extractProfile, mergeProfile } from '../llm/prompts/extractProfile';
import { maskKey } from './settings';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/** Klucz API profilu nie wraca do przeglądarki w całości. */
const publicProfile = (p: Profile) => ({ ...p, apiKey: maskKey(p.apiKey) });

export const profilesRouter = Router();

profilesRouter.get('/profiles', async (_req, res) => {
  res.json((await store.listProfiles()).map(publicProfile));
});

profilesRouter.post('/profiles', async (req, res) => {
  const name = String(req.body?.displayName ?? '').trim();
  if (!name) throw new HttpError(400, 'Podaj nazwę profilu.');
  const p = store.emptyProfile(name);
  await store.saveProfile(p);
  res.status(201).json(publicProfile(p));
});

profilesRouter.get('/profiles/:pid', async (req, res) => {
  res.json(publicProfile(await store.getProfile(req.params.pid)));
});

profilesRouter.put('/profiles/:pid', async (req, res) => {
  const existing = await store.getProfile(req.params.pid);
  const parsed = ProfileSchema.safeParse({ ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt });
  if (!parsed.success) throw new HttpError(400, `Niepoprawne dane profilu: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  const next = parsed.data;
  // Zamaskowany klucz z formularza = bez zmian.
  if (next.apiKey === maskKey(existing.apiKey)) next.apiKey = existing.apiKey;
  next.files = existing.files;
  next.photo = existing.photo;
  res.json(publicProfile(await store.saveProfile(next)));
});

profilesRouter.delete('/profiles/:pid', async (req, res) => {
  await store.getProfile(req.params.pid);
  await store.deleteProfile(req.params.pid);
  res.json({ ok: true });
});

/** Wgranie CV → propozycja profilu (zapis dopiero po zatwierdzeniu w formularzu). */
profilesRouter.post('/profiles/:pid/import', upload.single('cv'), async (req, res) => {
  const profile = await store.getProfile(String(req.params.pid));
  const file = req.file;
  if (!file) throw new HttpError(400, 'Nie wybrano pliku CV.');
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const text = await cvFileToText(file.buffer, original);

  const dir = store.profileFilesDir(profile.id);
  await fs.mkdir(dir, { recursive: true });
  const stored = `${Date.now()}_${original.replace(/[^\w.\-]+/g, '_')}`;
  await fs.writeFile(path.join(dir, stored), file.buffer);
  profile.files.push({ name: stored, original, uploadedAt: nowIso() });
  await store.saveProfile(profile);

  const isEmpty = !profile.experience.length && !profile.education.length && !profile.projects.length && !profile.skills.length;
  const proposal: ProfileExtract = isEmpty
    ? await extractProfile(text, { profileId: profile.id })
    : await mergeProfile(profile, text, { profileId: profile.id });

  // Nowe pozycje dostają prawdziwe id; zwracamy je, żeby formularz mógł je wyróżnić.
  const known = new Set([
    ...profile.experience, ...profile.education, ...profile.projects, ...profile.skills, ...profile.languages, ...profile.certificates,
  ].map((x) => x.id));
  const newIds: string[] = [];
  const seen = new Set<string>();
  const fix = <T extends { id: string }>(items: T[]): T[] =>
    items.map((it) => {
      if (!known.has(it.id) || seen.has(it.id)) {
        const id = newId();
        newIds.push(id);
        seen.add(id);
        return { ...it, id };
      }
      seen.add(it.id);
      return it;
    });
  const fixed: ProfileExtract = {
    ...proposal,
    experience: fix(proposal.experience),
    education: fix(proposal.education),
    projects: fix(proposal.projects),
    skills: fix(proposal.skills),
    languages: fix(proposal.languages),
    certificates: fix(proposal.certificates),
  };
  res.json({ mode: isEmpty ? 'new' : 'merge', proposal: fixed, newIds });
});

profilesRouter.post('/profiles/:pid/photo', upload.single('photo'), async (req, res) => {
  const profile = await store.getProfile(String(req.params.pid));
  const file = req.file;
  if (!file) throw new HttpError(400, 'Nie wybrano zdjęcia.');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
  if (!ext) throw new HttpError(400, 'Zdjęcie musi być w formacie JPG, PNG lub WEBP.');
  if (profile.photo) await fs.rm(path.join(store.profileDir(profile.id), profile.photo), { force: true });
  profile.photo = `photo${ext}`;
  await fs.writeFile(path.join(store.profileDir(profile.id), profile.photo), file.buffer);
  res.json(publicProfile(await store.saveProfile(profile)));
});

profilesRouter.delete('/profiles/:pid/photo', async (req, res) => {
  const profile = await store.getProfile(req.params.pid);
  if (profile.photo) await fs.rm(path.join(store.profileDir(profile.id), profile.photo), { force: true });
  profile.photo = '';
  res.json(publicProfile(await store.saveProfile(profile)));
});

profilesRouter.get('/profiles/:pid/photo', async (req, res) => {
  const profile = await store.getProfile(req.params.pid);
  if (!profile.photo) throw new HttpError(404, 'Brak zdjęcia');
  res.sendFile(path.join(store.profileDir(profile.id), profile.photo));
});
