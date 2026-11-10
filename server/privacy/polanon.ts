import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Profile, Settings } from '../../shared/schemas';
import { HttpError } from '../storage/store';
import { collectStrings, replaceStrings } from '../llm/strings';
import { APP_UA } from '../jobs/http';
import { tr } from '../i18n';
import { commandLine, requireConfirmed } from '../commands';

/**
 * Opcjonalne maskowanie danych osobowych przez polanon (pakiet Pythona, `pip install polanon`).
 * Bez Pythona i bez polanonu program działa normalnie - maskowanie po prostu jest niedostępne.
 * Gdy jest włączone, a nie działa, nic nie wychodzi do AI (lepiej błąd niż dane wysłane jawnie).
 */

const BRIDGE = fileURLToPath(new URL('./polanon_bridge.py', import.meta.url));
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const MIN_PYTHON = [3, 11];
const TOKEN = /<[A-Z_]+_\d+>/g;

/** Dokładne komendy, które Ustawienia pokazują przed instalacją i które serwer uruchamia po potwierdzeniu. */
export interface InstallCommands {
  polanon: string[];
  ner: string[];
}

export interface PolanonStatus {
  /** Wersja Pythona, którego program użyje (null = nie znaleziono). */
  python: string | null;
  /** Polecenie uruchamiające tego Pythona, np. "py -3". */
  command: string | null;
  polanon: string | null;
  spacy: boolean;
  model: boolean;
  error: string;
  /** null, gdy nie ma Pythona, którym dałoby się instalować */
  installCommands: InstallCommands | null;
}

type Found = Omit<PolanonStatus, 'installCommands'> & { cmd: string[] };

const POLANON_STEP = ['-m', 'pip', 'install', '--upgrade', 'polanon'];
const NER_STEPS = [
  ['-m', 'pip', 'install', '--upgrade', 'polanon[ner]'],
  ['-m', 'spacy', 'download', 'pl_core_news_md'],
];

export const installCommands = (cmd: string[]): InstallCommands => ({
  polanon: [commandLine([...cmd, ...POLANON_STEP])],
  ner: NER_STEPS.map((args) => commandLine([...cmd, ...args])),
});

// ---------- Ścieżka do Pythona z Ustawień ----------

const PYTHON_NAME = {
  win32: /^(python(3(\.\d+)?)?|py)\.exe$/i,
  other: /^python(3(\.\d+)?)?$/,
};

export type PythonPathCheck = { ok: true; path: string } | { ok: false; error: string };

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return false;
    // Aliasy Pythona ze Sklepu Microsoft (WindowsApps) istnieją, ale stat zwraca dla nich EACCES.
    try {
      const l = fs.lstatSync(p);
      return l.isFile() || l.isSymbolicLink();
    } catch {
      return false;
    }
  }
}

/**
 * Program uruchamia ten plik, więc dopuszczamy tylko pełną ścieżkę do istniejącego Pythona na tym komputerze
 * (bez ścieżek sieciowych \\serwer\udział i względnych). Puste = wykryj automatycznie.
 */
export function checkPythonPath(raw: string, platform: NodeJS.Platform = process.platform): PythonPathCheck {
  let p = raw.trim();
  // "Kopiuj jako ścieżkę" w Windows 11 dodaje cudzysłowy.
  if (/^(["']).*\1$/.test(p) && p.length >= 2) p = p.slice(1, -1).trim();
  if (!p) return { ok: true, path: '' };
  const win = platform === 'win32';
  const network = p.startsWith('\\\\') || p.startsWith('//') || (win && p.startsWith('/\\')) || (win && p.startsWith('\\/'));
  const absolute = win ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/');
  if (network || !absolute) {
    return { ok: false, error: tr('Podaj pełną ścieżkę do pliku Pythona na tym komputerze, np. C:\\Python312\\python.exe. Ścieżki względne i sieciowe nie są dozwolone, a puste pole oznacza wykrywanie automatyczne.') };
  }
  const name = (win ? path.win32 : path.posix).basename(p);
  if (!(win ? PYTHON_NAME.win32 : PYTHON_NAME.other).test(name)) {
    return { ok: false, error: tr('Wskazany plik ({name}) to nie Python. Podaj ścieżkę do python.exe, python3.exe albo py.exe (w Linuksie i macOS: python albo python3).', { name }) };
  }
  if (!fileExists(p)) return { ok: false, error: tr('Nie znaleziono pliku {path}.', { path: p }) };
  return { ok: true, path: p };
}

function candidates(pythonPath: string): string[][] {
  const list: string[][] = [];
  if (pythonPath) list.push([pythonPath]);
  if (process.env.CV_PYTHON) list.push([process.env.CV_PYTHON]);
  if (process.platform === 'win32') list.push(['py', '-3']);
  list.push(['python'], ['python3']);
  return list;
}

function run(cmd: string[], args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd[0], [...cmd.slice(1), ...args], { env: ENV, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const tooOld = (version: string) => {
  const [major, minor] = version.split('.').map(Number);
  return major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1]);
};

async function findPython(pythonPath: string): Promise<Found> {
  // Ponowne sprawdzenie przed uruchomieniem - settings.json mógł zostać zmieniony ręcznie.
  const checked = checkPythonPath(pythonPath);
  if (!checked.ok) return { python: null, command: null, cmd: [], polanon: null, spacy: false, model: false, error: checked.error };
  let old = '';
  for (const cmd of candidates(checked.path)) {
    const r = await run(cmd, [BRIDGE, '--status'], 15_000);
    if (r.code !== 0) continue;
    try {
      const info = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
      if (tooOld(info.python)) {
        old ||= tr('{command} to Python {version}', { command: cmd.join(' '), version: info.python });
        continue;
      }
      return { ...info, cmd, command: cmd.join(' '), error: info.polanon ? '' : tr('Pakiet polanon nie jest zainstalowany.') };
    } catch {
      /* to nie nasz skrypt odpowiedział - próbujemy dalej */
    }
  }
  const error = old ? tr('polanon wymaga Pythona 3.11 lub nowszego ({found}).', { found: old }) : tr('Nie znaleziono Pythona 3.11+.');
  return { python: null, command: null, cmd: [], polanon: null, spacy: false, model: false, error };
}

export async function polanonStatus(settings: Settings): Promise<PolanonStatus> {
  const { cmd, ...status } = await findPython(settings.pythonPath);
  return { ...status, installCommands: status.python ? installCommands(cmd) : null };
}

const PYPI = 'https://pypi.org/pypi/polanon/json';
let latestCache: { at: number; version: string | null } | null = null;

/** Najnowsza wersja polanonu na PyPI (publiczne API, nic o użytkowniku nie wysyłamy): godzinę w pamięci, bez sieci 5 minut. */
async function latestPolanon(): Promise<string | null> {
  if (latestCache && Date.now() - latestCache.at < (latestCache.version ? 3600_000 : 300_000)) return latestCache.version;
  const version = await fetch(PYPI, { headers: { 'User-Agent': APP_UA }, signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: any) => (typeof j?.info?.version === 'string' ? j.info.version : null))
    .catch(() => null);
  latestCache = { at: Date.now(), version };
  return version;
}

/** Czy `latest` jest nowsze niż `installed` ("0.2.1" > "0.1.1"); przy nieczytelnym numerze false. */
export function isNewer(latest: string, installed: string): boolean {
  const parse = (v: string) => /^\d+(?:\.\d+)*/.exec(v.trim())?.[0].split('.').map(Number) ?? null;
  const a = parse(latest);
  const b = parse(installed);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** Czy na PyPI jest nowszy polanon niż zainstalowany (aktualizacja to ten sam `pip install --upgrade`). */
export async function polanonUpdate(installed: string | null): Promise<{ latest: string | null; updateAvailable: boolean }> {
  const latest = await latestPolanon();
  return { latest, updateAvailable: !!(latest && installed && isNewer(latest, installed)) };
}

/**
 * Model spaCy dla polanonu (rozpoznawanie miejsc i rzadszych nazw): `pip install "polanon[ner]"` i polski model
 * `pl_core_news_md` w znalezionym Pythonie, tylko po potwierdzeniu dokładnie tych komend. Pobranie modelu trwa kilka minut.
 */
export async function installNer(settings: Settings, confirmed: unknown): Promise<{ ok: boolean; output: string; status: PolanonStatus }> {
  const found = await findPython(settings.pythonPath);
  if (!found.python) return { ok: false, output: found.error, status: await polanonStatus(settings) };
  const commands = installCommands(found.cmd).ner;
  requireConfirmed(commands, confirmed);
  let output = '';
  for (const [i, args] of NER_STEPS.entries()) {
    const r = await run(found.cmd, args, 900_000);
    output += `> ${commands[i]}\n${r.stdout}\n${r.stderr}\n`;
    if (r.code !== 0) break;
  }
  stopBridge();
  const status = await polanonStatus(settings);
  return { ok: status.spacy && status.model, output: output.trim().slice(-1500), status };
}

/**
 * `pip install --upgrade polanon` w znalezionym Pythonie (pip sam wybiera instalację dla użytkownika, gdy trzeba),
 * tylko po potwierdzeniu dokładnie tej komendy.
 */
export async function installPolanon(settings: Settings, confirmed: unknown): Promise<{ ok: boolean; output: string; status: PolanonStatus }> {
  const found = await findPython(settings.pythonPath);
  if (!found.python) return { ok: false, output: found.error, status: await polanonStatus(settings) };
  requireConfirmed(installCommands(found.cmd).polanon, confirmed);
  const r = await run(found.cmd, POLANON_STEP, 300_000);
  stopBridge();
  const output = `${r.stdout}\n${r.stderr}`.trim().slice(-1500);
  return { ok: r.code === 0, output, status: await polanonStatus(settings) };
}

// ---------- Mostek: jeden proces Pythona na czas działania serwera ----------

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class Bridge {
  readonly key: string;
  dead = false;
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private ready: Promise<void>;

  constructor(cmd: string[], ner: boolean, key: string) {
    this.key = key;
    this.child = spawn(cmd[0], [...cmd.slice(1), BRIDGE, ...(ner ? ['--ner'] : [])], { env: ENV, windowsHide: true });
    let stderr = '';
    this.child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    // Zapis do Pythona, który właśnie się zamknął (EPIPE), nie może wyłączyć serwera - błąd zgłosi 'exit'.
    this.child.stdin.on('error', () => {});
    this.ready = new Promise((resolve, reject) => {
      // Z modelem spaCy start trwa kilka-kilkanaście sekund, na wolnym dysku dłużej.
      const startSeconds = ner ? 120 : 60;
      const startTimer = setTimeout(() => {
        // Bez tego mostek "wisiałby" do restartu programu: kolejne wywołanie AI uruchomi go od nowa.
        this.dead = true;
        this.child.kill();
        reject(new Error(tr('polanon nie wystartował w ciągu {seconds} s', { seconds: startSeconds })));
      }, startSeconds * 1000);
      createInterface({ input: this.child.stdout }).on('line', (line) => {
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if ('ready' in msg) {
          clearTimeout(startTimer);
          if (!msg.ready) this.dead = true;
          return msg.ready ? resolve() : reject(new Error(msg.error));
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg);
      });
      const die = (e: Error) => {
        clearTimeout(startTimer);
        this.dead = true;
        reject(e);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
      };
      this.child.on('error', die);
      this.child.on('exit', (code) =>
        die(new Error(`${tr('proces polanon zakończył się (kod {code})', { code: String(code) })}${stderr.trim() ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`)),
      );
    });
    this.ready.catch(() => {}); // błąd startu zgłasza call(), a nie "unhandled rejection"
  }

  async call(req: Record<string, unknown>): Promise<any> {
    await this.ready;
    if (this.dead) throw new Error(tr('proces polanon nie działa'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(tr('polanon nie odpowiedział w ciągu 120 s')));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
    });
  }

  stop() {
    this.dead = true;
    this.child.kill();
  }
}

let bridge: Bridge | null = null;
let starting: Promise<Bridge> | null = null;
process.once('exit', () => bridge?.stop());

function stopBridge() {
  bridge?.stop();
  bridge = null;
}

function getBridge(settings: Settings): Promise<Bridge> {
  const key = `${settings.pythonPath}|${settings.maskPiiNer}`;
  if (bridge && bridge.key === key && !bridge.dead) return Promise.resolve(bridge);
  // Kilka wywołań AI naraz czeka na ten sam start, zamiast uruchamiać kilka procesów.
  starting ??= (async () => {
    stopBridge();
    const found = await findPython(settings.pythonPath);
    if (!found.polanon) throw new Error(found.error);
    return (bridge = new Bridge(found.cmd, settings.maskPiiNer, key));
  })().finally(() => (starting = null));
  return starting;
}

// ---------- Maskowanie zapytań do AI ----------

export const TOKENS_NOTE = `

Dane osobowe w treści są zastąpione tokenami w nawiasach ostrych, np. <OSOBA_1>, <EMAIL_1>, <TELEFON_1>, <LINK_1>, <FIRMA_1>. Traktuj token jak prawdziwą, podaną wartość (np. imię i nazwisko są w CV). Gdy jej potrzebujesz, przepisz token dokładnie tak, jak jest zapisany - bez odmiany, bez zmian liter i bez spacji w środku. Nie twórz nowych tokenów.`;

export interface Masked {
  text: string;
  /** Wstawia oryginalne wartości z powrotem do wszystkich tekstów w odpowiedzi AI. */
  restore<T>(value: T): Promise<T>;
}

const unavailable = (e: any) =>
  new HttpError(
    503,
    tr('Maskowanie danych osobowych (polanon) jest włączone, ale nie działa: {error}. Nic nie zostało wysłane do AI. Napraw to w Ustawieniach albo wyłącz maskowanie.', { error: String(e?.message ?? e) }),
  );

export interface ProfileTerm {
  type: 'PERSON' | 'EMAIL' | 'PHONE' | 'LINK' | 'ADDRESS';
  text: string;
}

/** Login w linku do profilu: github.com/login/..., login.github.io, linkedin.com/in/login. */
const HANDLE_IN_LINK = [/(?:github|gitlab)\.com\/([\w.-]+)/i, /\b([a-z0-9-]+)\.(?:github|gitlab)\.io\b/i, /linkedin\.com\/in\/([\w%-]+)/i];

/** Login z linku. Wraca też bez linku: w JSON-ie z GitHuba ("login"), w nazwach repozytoriów, po "@". */
export function linkHandle(url: string): string {
  for (const re of HANDLE_IN_LINK) {
    const handle = re.exec(url)?.[1].replace(/\.+$/, '');
    if (handle && handle.length >= 3) return handle;
  }
  return '';
}

/** Części pola z miejscowością, w których jest numer domu ("ul. Wrzosowa 12/4"). Miasto i kod z miastem zostają: AI dopasowuje po nich oferty. */
export function streetParts(location: string): string[] {
  return location
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => /\d/.test(part) && !/^\d{2}-\d{3}\b/.test(part));
}

/**
 * Dane kandydata, które polanon ma maskować zawsze - także w linkach, przy nazwiskach spoza listy polskich imion
 * i tam, gdzie reguły ich nie widzą: sam login z GitHuba, samo nazwisko małymi literami, ulica bez "ul." i bez kodu.
 */
export function profileTerms(profile: Profile | null): ProfileTerm[] {
  if (!profile) return [];
  const c = profile.contact;
  const links = [...c.links.map((l) => l.url), ...profile.projects.map((p) => p.link)];
  const terms: ProfileTerm[] = [
    { type: 'PERSON', text: c.fullName },
    // Każde słowo po imieniu osobno, także małymi literami: "pracowałem u ojca w żółtowski transport".
    ...c.fullName.trim().split(/\s+/).slice(1).map((text) => ({ type: 'PERSON' as const, text })),
    { type: 'EMAIL', text: c.email },
    { type: 'PHONE', text: c.phone },
    ...streetParts(c.location).map((text) => ({ type: 'ADDRESS' as const, text })),
    ...c.links.map((l) => ({ type: 'LINK' as const, text: l.url })),
    ...links.map((url) => ({ type: 'LINK' as const, text: linkHandle(url) })),
  ];
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = `${t.type}|${t.text.trim().toLowerCase()}`;
    if (!t.text.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function maskForAi(text: string, settings: Settings, terms: ProfileTerm[] = []): Promise<Masked> {
  let b: Bridge;
  let res: { text: string; mapping: Record<string, string> };
  try {
    b = await getBridge(settings);
    res = await b.call({ op: 'mask', text, terms });
  } catch (e) {
    throw unavailable(e);
  }
  const mapping = res.mapping;
  return {
    text: res.text,
    async restore<T>(value: T): Promise<T> {
      if (!Object.keys(mapping).length) return value;
      const texts: string[] = [];
      collectStrings(value, texts);
      let restored: string[];
      try {
        restored = (await b.call({ op: 'restore', texts, mapping })).texts;
      } catch (e) {
        throw unavailable(e);
      }
      const unknown = restored.reduce((n, t) => n + (t.match(TOKEN)?.length ?? 0), 0);
      if (unknown) console.warn(`[polanon] W odpowiedzi AI zostało ${unknown} tokenów, których nie ma w mapowaniu.`);
      return replaceStrings(value, restored[Symbol.iterator]());
    },
  };
}
