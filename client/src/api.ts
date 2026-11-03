import type {
  Career,
  CareerPrefs,
  Application,
  ApplicationSummary,
  AtsReport,
  CoverLetter,
  CvVersion,
  GapAnswer,
  GithubImportResult,
  ImproveResult,
  InterviewPrep,
  Profile,
  ProfileExtract,
  TemplateId,
  UsageEntry,
} from '../../shared/schemas';
import { getLang, translate } from './i18n';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'X-PolCV-Lang': getLang(), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* nie-JSON */
  }
  if (!res.ok) throw new Error(data?.error || translate('Błąd {status}', { status: res.status }));
  return data as T;
}

export interface SettingsView {
  apiKeyMasked: string;
  hasKey: boolean;
  mainModel: string;
  fastModel: string;
  jobSearch: boolean;
  maskPii: boolean;
  maskPiiNer: boolean;
  pythonPath: string;
  /** Portale, które program przeszukuje sam, gdy wyszukiwanie jest włączone. */
  searchPortals: string[];
}

export type SettingsPatch = Partial<Omit<SettingsView, 'apiKeyMasked' | 'hasKey' | 'searchPortals'> & { apiKey: string }>;

export interface PolanonStatus {
  python: string | null;
  command: string | null;
  polanon: string | null;
  spacy: boolean;
  model: boolean;
  error: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  contextLength: number;
}

export interface UsageView {
  total: number;
  byProfile: Record<string, number>;
  byTask: Record<string, number>;
  calls: number;
  recent: UsageEntry[];
}

export interface AppDetail {
  application: Application;
  /** scoreIncomplete: raport jest, ale bez części AI (brak wyniku łącznego) */
  versions: { version: number; createdAt: string; origin: 'generated' | 'improved'; score: number | null; scoreIncomplete: boolean }[];
  costUsd: number;
  hasPhoto: boolean;
}

export interface VersionDetail {
  cv: CvVersion;
  report: AtsReport | null;
  reportStale: boolean;
  pending: number;
  unverifiedSkills: string[];
}

const P = (pid: string) => `/profiles/${pid}`;
const A = (pid: string, aid: string) => `/profiles/${pid}/applications/${aid}`;

export const api = {
  settings: () => req<SettingsView>('GET', '/settings'),
  saveSettings: (s: SettingsPatch) => req<SettingsView>('PUT', '/settings', s),
  checkKey: (apiKey?: string) => req<{ ok: boolean; message: string }>('POST', '/settings/check-key', { apiKey }),
  polanonStatus: () => req<PolanonStatus>('GET', '/settings/polanon'),
  installPolanon: () => req<{ ok: boolean; output: string; status: PolanonStatus }>('POST', '/settings/polanon/install'),
  models: () => req<ModelInfo[]>('GET', '/models'),
  usage: () => req<UsageView>('GET', '/usage'),

  profiles: () => req<Profile[]>('GET', '/profiles'),
  createProfile: (displayName: string) => req<Profile>('POST', '/profiles', { displayName }),
  profile: (pid: string) => req<Profile>('GET', P(pid)),
  saveProfile: (pid: string, p: Profile) => req<Profile>('PUT', P(pid), p),
  deleteProfile: (pid: string) => req<{ ok: true }>('DELETE', P(pid)),
  importCv: (pid: string, file: File) => {
    const fd = new FormData();
    fd.append('cv', file);
    return req<{ mode: 'new' | 'merge'; proposal: ProfileExtract; newIds: string[] }>('POST', `${P(pid)}/import`, fd);
  },
  importGithub: (pid: string, username: string) => req<GithubImportResult>('POST', `${P(pid)}/github`, { username }),
  uploadPhoto: (pid: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return req<Profile>('POST', `${P(pid)}/photo`, fd);
  },
  deletePhoto: (pid: string) => req<Profile>('DELETE', `${P(pid)}/photo`),
  photoUrl: (pid: string, bust = '') => `/api${P(pid)}/photo?${bust}`,

  applications: (pid: string) => req<ApplicationSummary[]>('GET', `${P(pid)}/applications`),
  createApplication: (pid: string, url: string, text: string) => req<Application>('POST', `${P(pid)}/applications`, { url, text }),
  application: (pid: string, aid: string) => req<AppDetail>('GET', A(pid, aid)),
  patchApplication: (pid: string, aid: string, patch: Partial<{ status: string; notes: string; currentVersion: number }>) =>
    req<Application>('PATCH', A(pid, aid), patch),
  deleteApplication: (pid: string, aid: string) => req<{ ok: true }>('DELETE', A(pid, aid)),
  gap: (pid: string, aid: string) => req<Application>('POST', `${A(pid, aid)}/gap`),
  answers: (pid: string, aid: string, answers: GapAnswer[]) => req<Application>('POST', `${A(pid, aid)}/answers`, { answers }),
  generate: (pid: string, aid: string, opts: { language?: 'pl' | 'en'; template?: TemplateId } = {}) =>
    req<CvVersion>('POST', `${A(pid, aid)}/generate`, opts),
  improve: (pid: string, aid: string) => req<ImproveResult>('POST', `${A(pid, aid)}/improve`),
  version: (pid: string, aid: string, v: number) => req<VersionDetail>('GET', `${A(pid, aid)}/versions/${v}`),
  saveVersion: (pid: string, aid: string, v: number, patch: Partial<Pick<CvVersion, 'content' | 'decisions' | 'template' | 'photo' | 'rodo'>>) =>
    req<{ cv: CvVersion; pending: number }>('PUT', `${A(pid, aid)}/versions/${v}`, patch),
  evaluate: (pid: string, aid: string, v: number) => req<AtsReport>('POST', `${A(pid, aid)}/versions/${v}/evaluate`),
  previewUrl: (pid: string, aid: string, v: number, bust: string) => `/api${A(pid, aid)}/versions/${v}/preview?lang=${getLang()}&${bust}`,
  pdfUrl: (pid: string, aid: string, v: number) => `/api${A(pid, aid)}/versions/${v}/pdf?lang=${getLang()}&${Date.now()}`,
  exportPdf: (pid: string, aid: string) => req<Application>('POST', `${A(pid, aid)}/export`),
  downloadUrl: (pid: string, aid: string) => `/api${A(pid, aid)}/download`,

  career: (pid: string) => req<Career>('GET', `${P(pid)}/career`),
  careerChat: (pid: string, message: string) => req<Career>('POST', `${P(pid)}/career/chat`, { message }),
  careerReset: (pid: string) => req<Career>('POST', `${P(pid)}/career/reset`),
  careerPrefs: (pid: string, prefs: CareerPrefs) => req<Career>('PUT', `${P(pid)}/career/prefs`, prefs),
  careerProposals: (pid: string) => req<Career>('POST', `${P(pid)}/career/proposals`),
  careerOffers: (pid: string, roleId: string) => req<Career>('POST', `${P(pid)}/career/roles/${roleId}/offers`),

  interview: (pid: string, aid: string) => req<InterviewPrep | null>('GET', `${A(pid, aid)}/interview`),
  makeInterview: (pid: string, aid: string) => req<InterviewPrep>('POST', `${A(pid, aid)}/interview`),
  letter: (pid: string, aid: string) => req<CoverLetter | null>('GET', `${A(pid, aid)}/letter`),
  makeLetter: (pid: string, aid: string) => req<CoverLetter>('POST', `${A(pid, aid)}/letter`),
  saveLetter: (pid: string, aid: string, l: CoverLetter) => req<CoverLetter>('PUT', `${A(pid, aid)}/letter`, l),
  letterPreviewUrl: (pid: string, aid: string, bust: string) => `/api${A(pid, aid)}/letter/preview?lang=${getLang()}&${bust}`,
  letterPdfUrl: (pid: string, aid: string, download = false) => `/api${A(pid, aid)}/letter/pdf?lang=${getLang()}&${download ? 'download=1&' : ''}${Date.now()}`,
};
