import type { CvVersion, ExtraFact, Profile } from '../../shared/schemas';
import { normalize } from '../ats/keywords';

/** Identyfikatory elementów profilu. Wersja CV zapamiętuje je przy powstaniu, żeby potem wiedzieć, co doszło. */
export const profileIdsOf = (p: Profile): string[] =>
  [...p.experience, ...p.projects, ...p.education, ...p.certificates, ...p.languages, ...p.skills, ...p.extraFacts].map((x) => x.id);

/** To, co doszło do profilu od powstania wersji CV, a czego w tym CV nie ma. */
export interface ProfileNews {
  experience: Profile['experience'];
  projects: Profile['projects'];
  education: Profile['education'];
  certificates: Profile['certificates'];
  languages: Profile['languages'];
  skills: string[];
  facts: ExtraFact[];
}

export function profileNews(profile: Profile, cv: CvVersion): ProfileNews {
  const known = cv.profileIds ? new Set(cv.profileIds) : null;
  const c = cv.content;
  const empty: ProfileNews = { experience: [], projects: [], education: [], certificates: [], languages: [], skills: [], facts: [] };
  // Starsza wersja nie ma listy: gdy profil od tamtej pory się nie zmienił, nic nie doszło.
  if (!known && profile.updatedAt <= cv.createdAt) return empty;
  const isNew = (id: string) => !known || !known.has(id);
  const used = new Set([
    ...[...c.experience, ...c.projects, ...c.education].map((e) => e.sourceId),
    ...[c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)].flatMap((t) => t.sourceIds),
  ]);
  const inCv = (names: string[]) => {
    const set = new Set(names.map(normalize));
    return (name: string) => set.has(normalize(name));
  };
  const hasSkill = inCv([...c.skills.flatMap((g) => g.items), ...c.projects.flatMap((p) => p.technologies)]);
  const hasCert = inCv(c.certificates.map((x) => x.name));
  const hasLang = inCv(c.languages.map((x) => x.name));
  const since = cv.createdAt.slice(0, 10);
  return {
    experience: profile.experience.filter((e) => isNew(e.id) && !used.has(e.id)),
    projects: profile.projects.filter((p) => isNew(p.id) && !used.has(p.id)),
    education: profile.education.filter((e) => isNew(e.id) && !used.has(e.id)),
    certificates: profile.certificates.filter((x) => isNew(x.id) && !hasCert(x.name)),
    languages: profile.languages.filter((x) => isNew(x.id) && !hasLang(x.name)),
    // Bez listy z wersji nie wiadomo, które umiejętności AI pominęło celowo, więc ich nie proponujemy.
    skills: known ? profile.skills.filter((s) => !known.has(s.id) && !hasSkill(s.name)).map((s) => s.name) : [],
    facts: profile.extraFacts.filter((f) => f.has && !used.has(f.id) && (known ? !known.has(f.id) : f.date >= since)),
  };
}

export const newsCount = (n: ProfileNews) =>
  n.experience.length + n.projects.length + n.education.length + n.certificates.length + n.languages.length + n.skills.length + n.facts.length;
