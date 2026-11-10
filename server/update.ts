import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version';
import { latestVersionFrom } from './jobs/http';
import { isNewer } from './privacy/polanon';
import { tr } from './i18n';
import { commandLine, requireConfirmed, runCommand } from './commands';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const RELEASES_URL = 'https://github.com/boromat/polcv/releases';

/** Najnowsze wydanie PolCV na GitHubie (numer bez "v"). */
const latestRelease = latestVersionFrom(
  'https://api.github.com/repos/boromat/polcv/releases/latest',
  (j) => {
    const tag = (j as { tag_name?: unknown }).tag_name;
    return typeof tag === 'string' ? tag.replace(/^v/, '') : null;
  },
  { Accept: 'application/vnd.github+json' },
);

/** Komenda w folderze programu; wynik razem (stdout i stderr) do pokazania w Ustawieniach. */
async function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  const r = await runCommand([cmd], args, { cwd: ROOT, timeoutMs, shell: process.platform === 'win32' && cmd === 'npm' });
  return { code: r.code, out: r.stdout + r.stderr };
}

/** Aktualizacja przyciskiem ma sens tylko w kopii z `git clone` tego repozytorium; z ZIP-a pobiera się nową wersję ręcznie. */
async function isGitInstall(): Promise<boolean> {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return false;
  const r = await run('git', ['config', '--get', 'remote.origin.url'], 10_000);
  return r.code === 0 && /boromat\/polcv/i.test(r.out);
}

/** Kroki aktualizacji z czasem na każdy; dokładnie te komendy Ustawienia pokazują przed uruchomieniem. */
const UPDATE_STEPS: [string, string[], number][] = [
  ['git', ['pull', '--ff-only'], 120_000],
  ['npm', ['install', '--no-audit', '--no-fund'], 600_000],
  ['npm', ['run', 'build'], 300_000],
];

export const updateCommands = () => UPDATE_STEPS.map(([cmd, args]) => commandLine([cmd, ...args]));

export async function polcvUpdateStatus() {
  const [latest, git] = await Promise.all([latestRelease(), isGitInstall()]);
  return { current: VERSION, latest, updateAvailable: !!latest && isNewer(latest, VERSION), canSelfUpdate: git, releasesUrl: RELEASES_URL, commands: updateCommands() };
}

/**
 * `git pull`, `npm install` i budowa interfejsu, tylko po potwierdzeniu dokładnie tych komend (`confirmed`).
 * Nowy kod serwera zadziała dopiero po ponownym uruchomieniu PolCV.
 */
export async function updatePolcv(confirmed: unknown): Promise<{ ok: boolean; output: string; version: string }> {
  requireConfirmed(updateCommands(), confirmed);
  if (!(await isGitInstall())) {
    return { ok: false, output: tr('Ta kopia PolCV nie pochodzi z git clone, więc nie zaktualizuje się sama. Pobierz nową wersję ze strony {url}.', { url: RELEASES_URL }), version: VERSION };
  }
  let output = '';
  for (const [cmd, args, timeout] of UPDATE_STEPS) {
    const r = await run(cmd, args, timeout);
    output += `> ${cmd} ${args.join(' ')}\n${r.out}\n`;
    if (r.code !== 0) return { ok: false, output: output.trim().slice(-2000), version: VERSION };
  }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return { ok: true, output: output.trim().slice(-2000), version };
}
