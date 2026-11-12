import type { GithubImportResult } from '../../../shared/schemas';
import { plFew } from '../i18n';

type T = (text: string, params?: Record<string, string | number>) => string;

/** Komunikat po imporcie z GitHuba: co doszło do profilu i do ilu projektów dopisano nowości z repozytorium. */
export function githubImportInfo(res: Pick<GithubImportResult, 'added' | 'updated'>, t: T): string {
  const n = res.added.projects.length;
  const k = res.added.skills.length;
  const u = res.updated.length;
  const count = (x: number) => (x === 1 ? t('1 projekt') : plFew(x) ? t('{n} projekty', { n: x }) : t('{n} projektów', { n: x }));
  const projects = count(n);
  const skills = k === 1 ? t('1 umiejętność') : t('{n} umiejętności', { n: k });
  const parts = [
    n && k ? t('Dodano {projects} i {skills} z GitHuba.', { projects, skills }) : n ? t('Dodano {projects} z GitHuba.', { projects }) : k ? t('Dodano {skills} z GitHuba.', { skills }) : '',
    u ? t('Zaktualizowano {updated}: nowe punkty albo technologie z repozytorium.', { updated: count(u) }) : '',
  ].filter(Boolean);
  if (!parts.length) return t('Wszystkie projekty z GitHuba są już w profilu i nie ma w nich nic nowego.');
  return `${parts.join(' ')} ${t('Nowe pozycje są oznaczone na zielono - sprawdź je.')}`;
}
