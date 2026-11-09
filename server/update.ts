import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version';
import { APP_UA } from './jobs/http';
import { isNewer } from './privacy/polanon';
import { tr } from './i18n';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const RELEASES_URL = 'https://github.com/boromat/polcv/releases';
const LATEST_API = 'https://api.github.com/repos/boromat/polcv/releases/latest';

let latestCache: { at: number; version: string | null } | null = null;

/** Najnowsze wydanie PolCV na GitHubie (publiczne API, nic o użytkowniku nie wysyłamy): godzinę w pamięci, bez sieci 5 minut. */
async function latestRelease(): Promise<string | null> {
  if (latestCache && Date.now() - latestCache.at < (latestCache.version ? 3600_000 : 300_000)) return latestCache.version;
  const version = await fetch(LATEST_API, { headers: { 'User-Agent': APP_UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: any) => (typeof j?.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : null))
    .catch(() => null);
  latestCache = { at: Date.now(), version };
  return version;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    // npm na Windows to skrypt .cmd, który bez powłoki się nie uruchomi.
    const child = spawn(cmd, args, { cwd: ROOT, windowsHide: true, shell: process.platform === 'win32' && cmd === 'npm' });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Aktualizacja przyciskiem ma sens tylko w kopii z `git clone` tego repozytorium; z ZIP-a pobiera się nową wersję ręcznie. */
async function isGitInstall(): Promise<boolean> {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return false;
  const r = await run('git', ['config', '--get', 'remote.origin.url'], 10_000);
  return r.code === 0 && /boromat\/polcv/i.test(r.out);
}

export async function polcvUpdateStatus() {
  const [latest, git] = await Promise.all([latestRelease(), isGitInstall()]);
  return { current: VERSION, latest, updateAvailable: !!latest && isNewer(latest, VERSION), canSelfUpdate: git, releasesUrl: RELEASES_URL };
}

/** `git pull`, `npm install` i budowa interfejsu. Nowy kod serwera zadziała dopiero po ponownym uruchomieniu PolCV. */
export async function updatePolcv(): Promise<{ ok: boolean; output: string; version: string }> {
  if (!(await isGitInstall())) {
    return { ok: false, output: tr('Ta kopia PolCV nie pochodzi z git clone, więc nie zaktualizuje się sama. Pobierz nową wersję ze strony {url}.', { url: RELEASES_URL }), version: VERSION };
  }
  let output = '';
  const steps: [string, string[], number][] = [
    ['git', ['pull', '--ff-only'], 120_000],
    ['npm', ['install', '--no-audit', '--no-fund'], 600_000],
    ['npm', ['run', 'build'], 300_000],
  ];
  for (const [cmd, args, timeout] of steps) {
    const r = await run(cmd, args, timeout);
    output += `> ${cmd} ${args.join(' ')}\n${r.out}\n`;
    if (r.code !== 0) return { ok: false, output: output.trim().slice(-2000), version: VERSION };
  }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return { ok: true, output: output.trim().slice(-2000), version };
}
