import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { ProfileSchema, Pronouns, type ExtraFact, type Profile, type ProfileExtract } from '../../shared/schemas';
import * as store from '../storage/store';
import { HttpError, newId, nowIso } from '../storage/store';
import { cvFileToText } from '../cv/importCv';
import { withPage } from '../cv/browser';
import { extractProfile, mergeProfile } from '../llm/prompts/extractProfile';
import { importGithub } from '../services';
import { maskKey } from './settings';
import { tr } from '../i18n';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/** Klucz API profilu nie wraca do przeglądarki w całości. */
const publicProfile = (p: Profile) => ({ ...p, apiKey: maskKey(p.apiKey) });

export const profilesRouter = Router();

profilesRouter.get('/profiles', async (_req, res) => {
  res.json((await store.listProfiles()).map(publicProfile));
});

profilesRouter.post('/profiles', async (req, res) => {
  const name = String(req.body?.displayName ?? '').trim();
  if (!name) throw new HttpError(400, tr('Podaj nazwę profilu.'));
  const p = store.emptyProfile(name);
  if ((Pronouns as readonly string[]).includes(req.body?.pronouns)) p.pronouns = req.body.pronouns;
  await store.saveProfile(p);
  res.status(201).json(publicProfile(p));
});

profilesRouter.get('/profiles/:pid', async (req, res) => {
  res.json(publicProfile(await store.getProfile(req.params.pid)));
});

/**
 * Formularz wysyła całą listę extraFacts i ids, które już widział (extraFactsBase). Fakt zapisany na serwerze,
 * którego formularz nie znał (np. dopisany przez doradcę kariery w innej karcie), zostaje; usunięty w formularzu znika.
 */
export function keepServerFacts(existing: ExtraFact[], sent: ExtraFact[], base: unknown): ExtraFact[] {
  if (!Array.isArray(base)) return sent; // starszy klient bez listy: jak dotąd
  const known = new Set([...base.filter((x): x is string => typeof x === 'string'), ...sent.map((f) => f.id)]);
  return [...sent, ...existing.filter((f) => !known.has(f.id))];
}

profilesRouter.put('/profiles/:pid', async (req, res) => {
  // Pod blokadą pliku: pliki i zdjęcie bierzemy z aktualnej wersji, nie sprzed chwili.
  const saved = await store.updateProfile(req.params.pid, (existing) => {
    const parsed = ProfileSchema.safeParse({ ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt });
    if (!parsed.success) throw new HttpError(400, tr('Niepoprawne dane profilu: {field} {problem}', { field: parsed.error.issues[0]?.path.join('.') ?? '', problem: parsed.error.issues[0]?.message ?? '' }));
    const next = parsed.data;
    // Zamaskowany klucz z formularza = bez zmian.
    if (next.apiKey === maskKey(existing.apiKey)) next.apiKey = existing.apiKey;
    next.files = existing.files;
    next.photo = existing.photo;
    if (req.body?.extraFacts) next.extraFacts = keepServerFacts(existing.extraFacts, next.extraFacts, req.body.extraFactsBase);
    return next;
  });
  res.json(publicProfile(saved));
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
  if (!file) throw new HttpError(400, tr('Nie wybrano pliku CV.'));
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const text = await cvFileToText(file.buffer, original);

  const dir = store.profileFilesDir(profile.id);
  await fs.mkdir(dir, { recursive: true });
  const stored = `${Date.now()}_${original.replace(/[^\w.\-]+/g, '_')}`;
  await fs.writeFile(path.join(dir, stored), file.buffer);
  // Odczyt pliku CV chwilę trwa - dopisujemy plik do aktualnego profilu, a nie do kopii sprzed odczytu.
  await store.updateProfile(profile.id, (p) => {
    p.files.push({ name: stored, original, uploadedAt: nowIso() });
  });

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

/** Projekty z publicznego GitHuba: zapis od razu (istniejące projekty zostają), formularz bierze zwrócony profil jako swój stan. */
profilesRouter.post('/profiles/:pid/github', async (req, res) => {
  const result = await importGithub(String(req.params.pid), String(req.body?.username ?? ''));
  res.json({ ...result, profile: publicProfile(result.profile) });
});

/** Zdjęcie trafia do PDF w całości, więc zdjęcie z telefonu (kilka MB) zmniejszamy do ok. 600×750 px. */
const PHOTO_BOX = { w: 600, h: 750, long: 1500 };
const PHOTO_KEEP = 300 * 1024; // mały JPG zostaje bez zmian
const PHOTO_MAX = 1024 * 1024;

/** Zmniejszenie i zapis jako JPG w Chromium (ten sam, który robi PDF), bo w projekcie nie ma biblioteki do obrazów. */
export async function shrinkPhoto(buf: Buffer, mime: string): Promise<Buffer> {
  const dataUrl = await withPage((page) =>
    page.evaluate(
      async ({ src, box }) => {
        const img = new Image();
        img.src = src;
        try {
          await img.decode();
        } catch {
          return null;
        }
        const { naturalWidth: w, naturalHeight: h } = img;
        // CV przycina zdjęcie do 4:5, więc krótszy bok wypełnia ramkę 600×750; dłuższy ma limit (panoramy).
        const scale = Math.min(1, Math.max(box.w / w, box.h / h), box.long / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff'; // przezroczystość z PNG/WEBP zamiast czarnego tła w JPG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
      },
      { src: `data:${mime};base64,${buf.toString('base64')}`, box: PHOTO_BOX },
    ),
  );
  if (!dataUrl) throw new HttpError(400, tr('Nie udało się odczytać zdjęcia. Zapisz je jako JPG lub PNG i spróbuj ponownie.'));
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

profilesRouter.post('/profiles/:pid/photo', upload.single('photo'), async (req, res) => {
  const profile = await store.getProfile(String(req.params.pid));
  const file = req.file;
  if (!file) throw new HttpError(400, tr('Nie wybrano zdjęcia.'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new HttpError(400, tr('Zdjęcie musi być w formacie JPG, PNG lub WEBP.'));
  // Zawsze JPG: mały JPG zostaje jak jest, resztę zmniejszamy.
  const data = file.mimetype === 'image/jpeg' && file.size <= PHOTO_KEEP ? file.buffer : await shrinkPhoto(file.buffer, file.mimetype);
  if (data.length > PHOTO_MAX) throw new HttpError(413, tr('Zdjęcie jest za duże nawet po zmniejszeniu (maks. 1 MB). Wybierz inne zdjęcie.'));
  const saved = await store.updateProfile(profile.id, async (p) => {
    if (p.photo) await fs.rm(path.join(store.profileDir(p.id), p.photo), { force: true });
    p.photo = 'photo.jpg';
    await fs.writeFile(path.join(store.profileDir(p.id), p.photo), data);
  });
  res.json(publicProfile(saved));
});

profilesRouter.delete('/profiles/:pid/photo', async (req, res) => {
  const saved = await store.updateProfile(req.params.pid, async (p) => {
    if (p.photo) await fs.rm(path.join(store.profileDir(p.id), p.photo), { force: true });
    p.photo = '';
  });
  res.json(publicProfile(saved));
});

profilesRouter.get('/profiles/:pid/photo', async (req, res) => {
  const profile = await store.getProfile(req.params.pid);
  if (!profile.photo) throw new HttpError(404, tr('Brak zdjęcia'));
  res.sendFile(path.join(store.profileDir(profile.id), profile.photo));
});
