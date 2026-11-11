import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Application, CvVersion, Profile, Settings, UsageEntry, AtsReport, InterviewPrep, CoverLetter, CourseAdvice, Career, MockInterviewFile } from '../../shared/schemas';
import { tr } from '../i18n';
import { errorMessage } from '../../shared/errors';

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

// ---------- Pliki JSON: blokada, zapis atomowy ----------

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Windows: antywirus, indeksowanie albo OneDrive potrafią na chwilę zablokować plik - próbujemy jeszcze kilka razy. */
async function retryBusy<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 5 || !RETRY_CODES.has((e as NodeJS.ErrnoException)?.code ?? '')) throw e;
      await sleep(25 * 2 ** attempt);
    }
  }
}

const locks = new Map<string, Promise<void>>();
const lockKey = (file: string) => {
  const abs = path.resolve(file);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
};

/**
 * Operacje na tym samym pliku idą po kolei (kolejka obietnic na ścieżkę). Każdy zapis przechodzi przez tę blokadę.
 * Blokada nie jest wielokrotna: wewnątrz fn nie wolno czekać na blokadę tego samego pliku.
 */
export function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(file);
  const run = (locks.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

async function readJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await retryBusy(() => fs.readFile(file, 'utf8'));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw e;
  }
  try {
    // BOM dopisuje np. starszy Notatnik przy ręcznej edycji.
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
  } catch (e) {
    throw new Error(tr('Plik {file} jest uszkodzony i nie da się go odczytać ({error}).', { file, error: errorMessage(e) }), { cause: e });
  }
}

/** Do list: uszkodzony plik pomijamy z ostrzeżeniem w konsoli, zamiast blokować cały widok. */
async function readListed<T>(file: string): Promise<T | null> {
  try {
    const v = await readJson<T>(file);
    if (v === null || typeof v === 'object') return v;
    throw new Error('to nie jest obiekt JSON');
  } catch (e) {
    console.warn(`[dane] Pomijam plik, którego nie da się odczytać: ${file} (${errorMessage(e)})`);
    return null;
  }
}

/** Zapis bez blokady - tylko dla kodu, który już ją trzyma. */
async function writeJsonNow(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unikalna nazwa: dwa zapisy naraz nie mogą pisać do jednego pliku tymczasowego.
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await retryBusy(() => fs.rename(tmp, file));
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

const writeJson = (file: string, data: unknown): Promise<void> => withFileLock(file, () => writeJsonNow(file, data));

/**
 * Odczyt, zmiana i zapis pod jedną blokadą - równoległe zapytania nie nadpisują sobie zmian.
 * fn zmienia obiekt w miejscu albo zwraca nowy; gdy nic się nie zmieniło, plik nie jest zapisywany.
 * `toDisk`: co z obiektu trafia do pliku (np. profil bez klucza API).
 */
function updateJson<T>(file: string, read: () => Promise<T>, fn: Updater<T>, stamp: (next: T) => T = (x) => x, toDisk: (x: T) => unknown = (x) => x): Promise<T> {
  return withFileLock(file, async () => {
    const cur = await read();
    const before = JSON.stringify(cur);
    const res = await fn(cur);
    const next = res === undefined ? cur : (res as T);
    if (JSON.stringify(next) === before) return next;
    const out = stamp(next);
    await writeJsonNow(file, toDisk(out));
    return out;
  });
}

export type Updater<T> = (cur: T) => void | T | Promise<void | T>;

// ---------- Ustawienia ----------

const settingsFile = () => path.join(DATA_DIR, 'settings.json');

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  profileKeys: {},
  mainModel: 'anthropic/claude-sonnet-5.5',
  fastModel: 'anthropic/claude-haiku-5.5',
  jobSearch: false,
  maskPii: false,
  maskPiiNer: false,
  pythonPath: '',
};

export async function getSettings(): Promise<Settings> {
  const saved = (await readJson<Partial<Settings>>(settingsFile())) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, profileKeys: { ...saved.profileKeys } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return updateSettings((s) => ({ ...s, ...patch }));
}

/** Zmiana ustawień na świeżo odczytanych danych, pod blokadą pliku. */
export async function updateSettings(fn: (s: Settings) => Settings | void): Promise<Settings> {
  return withFileLock(settingsFile(), async () => {
    const cur = await getSettings();
    const next = fn(cur) ?? cur;
    await writeJsonNow(settingsFile(), next);
    return next;
  });
}

// ---------- Klucze OpenRouter ----------
// Jedno miejsce na klucze: settings.json (klucz z Ustawień w `apiKey`, własne klucze profili w `profileKeys`).
// profile.json ich nie przechowuje; Profile.apiKey to tylko widok klucza tego profilu z settings.json.
// Klucz ze zmiennej środowiskowej OPENROUTER_API_KEY ma pierwszeństwo i nigdy nie jest zapisywany na dysku.

export const envApiKey = (): string => process.env.OPENROUTER_API_KEY?.trim() ?? '';

async function setProfileKey(id: string, key: string): Promise<void> {
  if (((await getSettings()).profileKeys[id] ?? '') === key) return;
  await updateSettings((s) => {
    if (key) s.profileKeys[id] = key;
    else delete s.profileKeys[id];
  });
}

/** Profil do zapisu w profile.json: bez klucza. */
const withoutKey = (p: Profile): Profile => ({ ...p, apiKey: '' });

/**
 * Jednorazowo przy starcie: klucze, które starsze wersje zapisywały w profile.json, przechodzą do settings.json,
 * a profile.json zostaje bez klucza. Zwraca, ile kluczy przeniesiono.
 */
export async function migrateProfileKeys(): Promise<number> {
  const root = path.join(DATA_DIR, 'profiles');
  let moved = 0;
  for (const d of await fs.readdir(root).catch(() => [] as string[])) {
    const file = path.join(root, d, 'profile.json');
    await withFileLock(file, async () => {
      const raw = await readListed<Profile>(file);
      if (!raw?.apiKey || !raw.id) return;
      if (!(await getSettings()).profileKeys[raw.id]) await setProfileKey(raw.id, raw.apiKey);
      await writeJsonNow(file, withoutKey(raw));
      moved++;
    });
  }
  return moved;
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

/** Klucz profilu z settings.json; starszy profile.json (przed migracją) mógł mieć go u siebie. */
const keyOf = (p: Profile, keys: Settings['profileKeys']) => keys[p.id] || p.apiKey || '';

export async function listProfiles(): Promise<Profile[]> {
  const root = path.join(DATA_DIR, 'profiles');
  const dirs = await fs.readdir(root).catch(() => [] as string[]);
  const { profileKeys } = await getSettings();
  const out: Profile[] = [];
  for (const d of dirs) {
    const p = await readListed<Profile>(path.join(root, d, 'profile.json'));
    if (p) out.push({ ...p, apiKey: keyOf(p, profileKeys) });
  }
  return out.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

export async function getProfile(id: string): Promise<Profile> {
  const p = await readJson<Profile>(profileFile(id));
  if (!p) throw new HttpError(404, tr('Nie znaleziono profilu'));
  return { ...emptyProfile(p.displayName), ...p, apiKey: keyOf(p, (await getSettings()).profileKeys) };
}

export async function saveProfile(p: Profile): Promise<Profile> {
  const next = { ...p, updatedAt: nowIso() };
  await setProfileKey(p.id, p.apiKey ?? '');
  await writeJson(profileFile(p.id), withoutKey(next));
  return next;
}

/** Zmiana profilu na świeżo odczytanych danych, np. po długim wywołaniu AI. Klucz trafia do settings.json, nie do profilu. */
export async function updateProfile(id: string, fn: Updater<Profile>): Promise<Profile> {
  const out = await updateJson(profileFile(id), () => getProfile(id), fn, (p) => ({ ...p, updatedAt: nowIso() }), withoutKey);
  await setProfileKey(id, out.apiKey ?? '');
  return out;
}

export async function deleteProfile(id: string): Promise<void> {
  await withFileLock(profileFile(id), () => fs.rm(profileDir(id), { recursive: true, force: true, maxRetries: 5 }));
  await setProfileKey(id, '');
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
    const a = await readListed<Application>(path.join(root, d, 'application.json'));
    if (a) out.push(a);
  }
  return out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
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

/** Zmienia tylko to, co ustawi fn, na aktualnej wersji z dysku - np. notatka zapisana w trakcie generowania CV zostaje. */
export async function updateApplication(profileId: string, appId: string, fn: Updater<Application>): Promise<Application> {
  return updateJson(appFile(profileId, appId), () => getApplication(profileId, appId), fn, (a) => ({ ...a, updatedAt: nowIso() }));
}

export async function deleteApplication(profileId: string, appId: string): Promise<void> {
  await withFileLock(appFile(profileId, appId), () => fs.rm(appDir(profileId, appId), { recursive: true, force: true, maxRetries: 5 }));
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

/** Numery wersji z nazw plików - liczą się też pliki, których nie da się odczytać, żeby nowa wersja ich nie nadpisała. */
async function versionNumbers(pid: string, aid: string): Promise<number[]> {
  const files = await fs.readdir(appDir(pid, aid)).catch(() => [] as string[]);
  return files.map((f) => /^cv\.v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

export async function listVersions(pid: string, aid: string): Promise<CvVersion[]> {
  const nums = await versionNumbers(pid, aid);
  const list = await Promise.all(nums.map((n) => readListed<CvVersion>(versionFile(pid, aid, n))));
  return list.filter((cv): cv is CvVersion => !!cv);
}

/** Nowa wersja z kolejnym numerem po najwyższej istniejącej; dwa równoległe zapisy nie dostaną tego samego numeru. */
export async function addVersion(pid: string, aid: string, build: (version: number) => CvVersion): Promise<CvVersion> {
  return withFileLock(path.join(appDir(pid, aid), 'cv.next-version'), async () => {
    const version = (await versionNumbers(pid, aid)).reduce((m, v) => Math.max(m, v), 0) + 1;
    const cv = { ...build(version), version };
    await writeJson(versionFile(pid, aid, version), cv);
    return cv;
  });
}

export const getReport = (pid: string, aid: string, v: number) => readJson<AtsReport>(reportFile(pid, aid, v));
export const saveReport = (pid: string, aid: string, r: AtsReport) => writeJson(reportFile(pid, aid, r.version), r);

export const getInterviewPrep = (pid: string, aid: string) => readJson<InterviewPrep>(path.join(appDir(pid, aid), 'interview.json'));

const mockFile = (pid: string, aid: string) => path.join(appDir(pid, aid), 'mock-interview.json');
export async function getMockInterview(pid: string, aid: string): Promise<MockInterviewFile> {
  return (await readJson<MockInterviewFile>(mockFile(pid, aid))) ?? { current: null, history: [] };
}
export const updateMockInterview = (pid: string, aid: string, fn: Updater<MockInterviewFile>) => updateJson(mockFile(pid, aid), () => getMockInterview(pid, aid), fn);
export const saveInterviewPrep = (pid: string, aid: string, d: InterviewPrep) => writeJson(path.join(appDir(pid, aid), 'interview.json'), d);
export const getCoverLetter = (pid: string, aid: string) => readJson<CoverLetter>(path.join(appDir(pid, aid), 'letter.json'));
export const saveCoverLetter = (pid: string, aid: string, d: CoverLetter) => writeJson(path.join(appDir(pid, aid), 'letter.json'), d);
export const getCourses = (pid: string, aid: string) => readJson<CourseAdvice>(path.join(appDir(pid, aid), 'courses.json'));
export const saveCourses = (pid: string, aid: string, d: CourseAdvice) => writeJson(path.join(appDir(pid, aid), 'courses.json'), d);

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

/** Zmiana danych doradcy na świeżo odczytanych danych - równoległe wyszukiwania i rozmowa nie nadpisują sobie wyników. */
export async function updateCareer(pid: string, fn: Updater<Career>): Promise<Career> {
  return updateJson(careerFile(pid), () => getCareer(pid), fn);
}

// ---------- Koszty ----------

const usageFile = () => path.join(DATA_DIR, 'usage.jsonl');

export async function appendUsage(e: UsageEntry): Promise<void> {
  await withFileLock(usageFile(), async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await retryBusy(() => fs.appendFile(usageFile(), JSON.stringify(e) + '\n', 'utf8'));
  });
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
