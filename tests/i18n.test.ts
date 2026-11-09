import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN as CLIENT_EN, EN_PARTS } from '../client/src/i18n/en';
import { EN as SERVER_EN } from '../server/i18n/en';
import { tr, withLang } from '../server/i18n';

const ROOT = path.resolve(__dirname, '..');

function files(dir: string, skip: string[] = []): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (skip.some((s) => rel.replaceAll('\\', '/').startsWith(s))) return [];
    if (e.isDirectory()) return files(rel, skip);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

/** Teksty przekazane wprost (literałem) do funkcji tłumaczącej, np. t('Nowe CV'). */
function keys(fileList: string[], fn: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  const re = new RegExp(`(?<![\\w.])(?:${fn.source})\\(\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, 'g');
  for (const f of fileList) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(re)) {
      if (m[1] === '`' && m[2].includes('${')) continue; // tekst składany w locie - zakazany, wyłapie go przegląd
      const key = m[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
      if (!found.has(key)) found.set(key, f);
    }
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('tłumaczenia interfejsu', () => {
  const used = keys(files('client/src', ['client/src/i18n']), /t|translate/);

  it('każdy tekst z t(…) ma angielską wersję', () => {
    const missing = [...used].filter(([k]) => !(k in CLIENT_EN)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });

  it('wstawki {…} są takie same po polsku i po angielsku', () => {
    const wrong = Object.entries(CLIENT_EN).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
    expect(wrong).toEqual([]);
  });

  it('ten sam tekst nie ma dwóch różnych tłumaczeń', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const part of Object.values(EN_PARTS)) {
      for (const [k, v] of Object.entries(part)) {
        if (seen.has(k) && seen.get(k) !== v) clashes.push(`${k}: "${seen.get(k)}" / "${v}"`);
        seen.set(k, v);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('tłumaczenia serwera', () => {
  const used = keys(files('server'), /tr/);

  it('każdy tekst z tr(…) ma angielską wersję', () => {
    const missing = [...used].filter(([k]) => !(k in SERVER_EN)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('wstawki {…} są takie same po polsku i po angielsku', () => {
    const wrong = Object.entries(SERVER_EN).filter(([k, v]) => placeholders(k).join() !== placeholders(v).join());
    expect(wrong).toEqual([]);
  });

  it('tr() wybiera język zapytania i wstawia wartości', () => {
    expect(withLang('pl', () => tr('Nie ma takiego adresu API'))).toBe('Nie ma takiego adresu API');
    expect(withLang('en', () => tr('Nie ma takiego adresu API'))).toBe(SERVER_EN['Nie ma takiego adresu API']);
    expect(withLang('en', () => tr('Błąd programu: {error}', { error: 'X' }))).toContain('X');
  });
});

it('teksty bez długiej pauzy i półpauzy (po polsku i po angielsku)', () => {
  const all = [...Object.entries(CLIENT_EN), ...Object.entries(SERVER_EN)].flat();
  expect(all.filter((v) => /[—–]/.test(v))).toEqual([]);
});
