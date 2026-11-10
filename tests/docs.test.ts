import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Dokumentacja i skrypty mówią to samo co kod: wymagana wersja Node.js i to, jak program przedstawia się stronom.

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const readmes = ['README.md', 'README.en.md'].map(read);

/** Sprawdzenie wersji ze start.bat uruchomione z podaną wersją Node.js; true = start.bat idzie dalej. */
function startBatAccepts(version: string): boolean {
  const code = /node -e "(.*)"\r?$/m.exec(read('start.bat'))?.[1];
  if (!code) throw new Error('start.bat nie sprawdza wersji Node.js');
  let exitCode: number | null = null;
  const fakeProcess = {
    versions: { node: version },
    version: `v${version}`,
    exit: (c: number) => {
      exitCode = c;
      throw new Error('exit');
    },
  };
  try {
    new Function('process', 'console', code)(fakeProcess, { log: () => {} });
  } catch {
    /* process.exit */
  }
  return exitCode === 0;
}

describe('wersja Node.js', () => {
  it('package.json i package-lock.json wymagają tego samego: Node 24 albo 26+ (unpdf potrzebuje 24, nanoid i vitest pomijają 25)', () => {
    expect(pkg.engines.node).toBe('^24 || >=26');
    expect(lock.packages[''].engines.node).toBe(pkg.engines.node);
  });

  it('start.bat sprawdza to samo', () => {
    expect(['24.0.0', '24.14.1', '26.1.0', '28.0.0'].filter(startBatAccepts)).toEqual(['24.0.0', '24.14.1', '26.1.0', '28.0.0']);
    expect(['22.12.0', '23.5.0', '25.2.0'].filter(startBatAccepts)).toEqual([]);
  });

  it('oba README podają Node.js 24 LTS', () => {
    for (const r of readmes) expect(r).toMatch(/Node\.js(\]\(https:\/\/nodejs\.org\))?\*{0,2} 24 LTS/);
  });
});

describe('jak program przedstawia się stronom', () => {
  it('README nie podaje starej, stałej wersji', () => {
    for (const r of readmes) {
      expect(r).not.toContain('PolCV/1.0');
      expect(r).toContain('PolCV/<');
    }
  });
});
