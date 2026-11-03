import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Application, CvVersion, Profile, Settings, UsageEntry, AtsReport, InterviewPrep, CoverLetter, Career } from '../../shared/schemas';
import { tr } from '../i18n';

export const DATA_DIR = path.resolve(process.env.CV_DATA_DIR || path.join(process.cwd(), 'data'));

export const newId = () => nanoid(10);
export const nowIso = () => new Date().toISOString();

/** Identyfikatory trafiają do ścieżek plików - dopuszczamy tylko bezpieczne znaki. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, tr('Nieprawidłowy identyfikator'));
  return id;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// ---------- Ustawienia ----------

const settingsFile = () => path.join(DATA_DIR, 'settings.json');

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  mainModel: 'anthropic/claude-sonnet-5.5',
  fastModel: 'anthropic/claude-haiku-5.5',
  jobSearch: false,
  maskPii: false,
  maskPiiNer: false,
  pythonPath: '',
};

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await readJson<Partial<Settings>>(settingsFile())) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await writeJson(settingsFile(), next);
  return next;
}

// ---------- Profile ----------

export const profileDir = (id: string) => path.join(DATA_DIR, 'profiles', safeId(id));
const profileFile = (id: string) => path.join(profileDir(id), 'profile.json');

export function emptyProfile(displayName: string): Profile {
  const t = nowIso();
  return {
    id: newId(),
    displayName,
    createdAt: t,
    updatedAt: t,
    apiKey: '',
    photo: '',
    files: [],
    contact: { fullName: '', email: '', phone: '', location: '', links: [] },
    headline: '',
    summary: '',
    experience: [],
    education: [],
    projects: [],
    skills: [],
    languages: [],
    certificates: [],
    interests: [],
    extraFacts: [],
  };
}

export async function listProfiles(): Promise<Profile[]> {
  const root = path.join(DATA_DIR, 'profiles');
  const dirs = await fs.readdir(root).catch(() => [] as string[]);
  const out: Profile[] = [];
  for (const d of dirs) {
    const p = await readJson<Profile>(path.join(root, d, 'profile.json'));
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getProfile(id: string): Promise<Profile> {
  const p = await readJson<Profile>(profileFile(id));
  if (!p) throw new HttpError(404, tr('Nie znaleziono profilu'));
  return { ...emptyProfile(p.displayName), ...p };
}

export async function saveProfile(p: Profile): Promise<Profile> {
  const next = { ...p, updatedAt: nowIso() };
  await writeJson(profileFile(p.id), next);
  return next;
}

export async function deleteProfile(id: string): Promise<void> {
  await fs.rm(profileDir(id), { recursive: true, force: true });
}

export const profileFilesDir = (id: string) => path.join(profileDir(id), 'files');

// ---------- Aplikacje ----------

export const appDir = (profileId: string, appId: string) => path.join(profileDir(profileId), 'applications', safeId(appId));
const appFile = (profileId: string, appId: string) => path.join(appDir(profileId, appId), 'application.json');

export async function listApplications(profileId: string): Promise<Application[]> {
  const root = path.join(profileDir(profileId), 'applications');
  const dirs = await fs.readdir(root).catch(() => [] as string[]);
  const out: Application[] = [];
  for (const d of dirs) {
    const a = await readJson<Application>(path.join(root, d, 'application.json'));
    if (a) out.push(a);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getApplication(profileId: string, appId: string): Promise<Application> {
  const a = await readJson<Application>(appFile(profileId, appId));
  if (!a) throw new HttpError(404, tr('Nie znaleziono aplikacji'));
  return a;
}

export async function saveApplication(a: Application): Promise<Application> {
  const next = { ...a, updatedAt: nowIso() };
  await writeJson(appFile(a.profileId, a.id), next);
  return next;
}

export async function deleteApplication(profileId: string, appId: string): Promise<void> {
  await fs.rm(appDir(profileId, appId), { recursive: true, force: true });
}

// Wersje CV i raporty

const versionFile = (pid: string, aid: string, v: number) => path.join(appDir(pid, aid), `cv.v${v}.json`);
const reportFile = (pid: string, aid: string, v: number) => path.join(appDir(pid, aid), `report.v${v}.json`);

export async function getVersion(pid: string, aid: string, v: number): Promise<CvVersion> {
  const cv = await readJson<CvVersion>(versionFile(pid, aid, v));
  if (!cv) throw new HttpError(404, tr('Brak wersji CV nr {v}', { v }));
  return cv;
}

export async function saveVersion(pid: string, aid: string, cv: CvVersion): Promise<void> {
  await writeJson(versionFile(pid, aid, cv.version), cv);
}

export async function listVersions(pid: string, aid: string): Promise<CvVersion[]> {
  const files = await fs.readdir(appDir(pid, aid)).catch(() => [] as string[]);
  const nums = files.map((f) => /^cv\.v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  return Promise.all(nums.map((n) => getVersion(pid, aid, n)));
}

export const getReport = (pid: string, aid: string, v: number) => readJson<AtsReport>(reportFile(pid, aid, v));
export const saveReport = (pid: string, aid: string, r: AtsReport) => writeJson(reportFile(pid, aid, r.version), r);

export const getInterviewPrep = (pid: string, aid: string) => readJson<InterviewPrep>(path.join(appDir(pid, aid), 'interview.json'));
export const saveInterviewPrep = (pid: string, aid: string, d: InterviewPrep) => writeJson(path.join(appDir(pid, aid), 'interview.json'), d);
export const getCoverLetter = (pid: string, aid: string) => readJson<CoverLetter>(path.join(appDir(pid, aid), 'letter.json'));
export const saveCoverLetter = (pid: string, aid: string, d: CoverLetter) => writeJson(path.join(appDir(pid, aid), 'letter.json'), d);

// ---------- Doradca kariery ----------

const careerFile = (pid: string) => path.join(profileDir(pid), 'career.json');

export function emptyCareer(city = ''): Career {
  return {
    prefs: {
      targetRoles: [],
      city,
      radiusKm: 30,
      onsite: true,
      hybrid: true,
      remote: true,
      salaryMin: 0,
      contracts: [],
      workTime: 'dowolny',
      seniority: 'junior',
      notes: '',
    },
    chat: [],
    summary: '',
    done: false,
    proposals: null,
    offers: {},
  };
}

export async function getCareer(pid: string): Promise<Career> {
  const profile = await getProfile(pid);
  const base = emptyCareer(profile.contact.location.split(',')[0].trim());
  const saved = await readJson<Career>(careerFile(pid));
  return saved ? { ...base, ...saved, prefs: { ...base.prefs, ...saved.prefs } } : base;
}

export const saveCareer = (pid: string, c: Career) => writeJson(careerFile(pid), c);

// ---------- Koszty ----------

const usageFile = () => path.join(DATA_DIR, 'usage.jsonl');

export async function appendUsage(e: UsageEntry): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(usageFile(), JSON.stringify(e) + '\n', 'utf8');
}

export async function readUsage(): Promise<UsageEntry[]> {
  const raw = await fs.readFile(usageFile(), 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as UsageEntry];
      } catch {
        return [];
      }
    });
}
