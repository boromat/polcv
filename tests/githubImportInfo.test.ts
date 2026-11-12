import { describe, expect, it } from 'vitest';
import { githubImportInfo } from '../client/src/pages/githubImport';

// Polski interfejs: tekst klucza z podstawionymi wstawkami.
const t = (text: string, params?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m));
const res = (projects: number, skills: number, updated: number) => ({
  added: { projects: Array.from({ length: projects }, (_, i) => `P${i}`), skills: Array.from({ length: skills }, (_, i) => `S${i}`) },
  updated: Array.from({ length: updated }, (_, i) => `U${i}`),
});
const GREEN = 'Nowe pozycje są oznaczone na zielono - sprawdź je.';

describe('komunikat po imporcie z GitHuba', () => {
  it.each<[string, ReturnType<typeof res>, string]>([
    ['nowe projekty i umiejętności', res(2, 1, 0), `Dodano 2 projekty i 1 umiejętność z GitHuba. ${GREEN}`],
    ['same nowe projekty', res(5, 0, 0), `Dodano 5 projektów z GitHuba. ${GREEN}`],
    ['nowości w projekcie z profilu', res(0, 0, 1), `Zaktualizowano 1 projekt: nowe punkty albo technologie z repozytorium. ${GREEN}`],
    [
      'nowości z nowymi umiejętnościami, bez nowych projektów',
      res(0, 2, 3),
      `Dodano 2 umiejętności z GitHuba. Zaktualizowano 3 projekty: nowe punkty albo technologie z repozytorium. ${GREEN}`,
    ],
    ['wszystko naraz', res(1, 1, 12), `Dodano 1 projekt i 1 umiejętność z GitHuba. Zaktualizowano 12 projektów: nowe punkty albo technologie z repozytorium. ${GREEN}`],
    ['nic nowego', res(0, 0, 0), 'Wszystkie projekty z GitHuba są już w profilu i nie ma w nich nic nowego.'],
  ])('%s', (_, r, text) => {
    expect(githubImportInfo(r, t)).toBe(text);
  });
});
