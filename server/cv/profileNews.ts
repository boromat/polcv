import { createHash } from 'node:crypto';
import type { CvContent, CvVersion, ExtraFact, Profile } from '../../shared/schemas';
import { normalize } from '../ats/keywords';

const itemsOf = (p: Profile) => [...p.experience, ...p.projects, ...p.education, ...p.certificates, ...p.languages, ...p.skills, ...p.extraFacts];
const itemHash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 10);

/**
 * Stan elementów profilu ("id#skrót treści"). Wersja CV zapamiętuje go przy powstaniu, żeby potem wiedzieć,
 * co doszło albo się zmieniło. Wersje z 9.11.2026 mają same identyfikatory, bez skrótu.
 */
export const profileIdsOf = (p: Profile): string[] => itemsOf(p).map((x) => `${x.id}#${itemHash(x)}`);

const parseSnapshot = (s: string[]) =>
  new Map(
    s.map((e): [string, string | null] => {
      const i = e.indexOf('#');
      return i < 0 ? [e, null] : [e.slice(0, i), e.slice(i + 1)];
    }),
  );

/** Id pozycji profilu, z których korzysta CV (wpisy i punkty). */
function usedIds(c: CvContent): Set<string> {
  return new Set([
    ...[...c.experience, ...c.projects, ...c.education].map((e) => e.sourceId),
    ...[c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)].flatMap((t) => t.sourceIds),
  ]);
}

export type ProfileEntries = NonNullable<CvVersion['profileEntries']>;

/** Kopia pozycji profilu (doświadczenie, projekty, szkoły) do zapamiętania w wersji CV. */
export const profileEntriesOf = (p: Profile): ProfileEntries =>
  structuredClone({ experience: p.experience, projects: p.projects, education: p.education });

/**
 * Po poprawce w edytorze CV (która przeszła do profilu) elementy profilu używane przez CV mają już stan z tego CV,
 * więc nie mogą wrócić przy synchronizacji jako "zmienione".
 */
export function refreshSnapshot(snapshot: string[] | undefined, profile: Profile, cv: CvContent): string[] | undefined {
  if (!snapshot) return undefined;
  const map = parseSnapshot(snapshot);
  const used = usedIds(cv);
  for (const x of itemsOf(profile)) if (used.has(x.id)) map.set(x.id, itemHash(x));
  return [...map].map(([id, h]) => (h ? `${id}#${h}` : id));
}

/** To samo dla kopii pozycji: pozycje używane przez CV dostają stan z profilu po poprawce. */
export function refreshEntries(entries: ProfileEntries | undefined, profile: Profile, cv: CvContent): ProfileEntries | undefined {
  if (!entries) return undefined;
  const used = usedIds(cv);
  const fresh = profileEntriesOf(profile);
  const merge = <T extends { id: string }>(old: T[], now: T[]): T[] => [
    ...old.map((x) => (used.has(x.id) ? (now.find((n) => n.id === x.id) ?? x) : x)),
    ...now.filter((n) => used.has(n.id) && !old.some((x) => x.id === n.id)),
  ];
  return {
    experience: merge(entries.experience, fresh.experience),
    projects: merge(entries.projects, fresh.projects),
    education: merge(entries.education, fresh.education),
  };
}

/** To, co doszło do profilu albo się w nim zmieniło od powstania wersji CV. */
export interface ProfileNews {
  experience: Profile['experience'];
  projects: Profile['projects'];
  education: Profile['education'];
  certificates: Profile['certificates'];
  languages: Profile['languages'];
  skills: string[];
  facts: ExtraFact[];
  /** id elementów, które już były, ale się zmieniły (ich wpis w CV trzeba poprawić, a nie dodać drugi raz) */
  changed: string[];
}

export function profileNews(profile: Profile, cv: CvVersion): ProfileNews {
  const snap = cv.profileIds ? parseSnapshot(cv.profileIds) : null;
  const c = cv.content;
  const empty: ProfileNews = { experience: [], projects: [], education: [], certificates: [], languages: [], skills: [], facts: [], changed: [] };
  // Starsza wersja bez listy: gdy profil od tamtej pory się nie zmienił, nic nie doszło.
  if (!snap && profile.updatedAt <= cv.createdAt) return empty;
  const used = usedIds(c);
  const changedSince = profile.updatedAt > cv.createdAt;
  const changed: string[] = [];
  /** 'new' = nie było go przy wersji, 'changed' = był, ale ma inną treść, null = bez zmian. */
  const status = (x: { id: string }): 'new' | 'changed' | null => {
    if (!snap || !snap.has(x.id)) return 'new';
    const h = snap.get(x.id);
    if (h) return h === itemHash(x) ? null : 'changed';
    // Lista bez skrótów: zmianę zakładamy dla pozycji z CV, gdy profil zmienił się po powstaniu wersji.
    return changedSince && used.has(x.id) ? 'changed' : null;
  };
  const pick = <T extends { id: string }>(list: T[], isNew: (x: T) => boolean) =>
    list.filter((x) => {
      const s = status(x);
      if (s === 'changed') changed.push(x.id);
      return s === 'changed' || (s === 'new' && isNew(x));
    });
  const inCv = (names: string[]) => {
    const set = new Set(names.map(normalize));
    return (name: string) => set.has(normalize(name));
  };
  const hasSkill = inCv([...c.skills.flatMap((g) => g.items), ...c.projects.flatMap((p) => p.technologies)]);
  const hasCert = inCv(c.certificates.map((x) => x.name));
  const hasLang = inCv(c.languages.map((x) => x.name));
  const since = cv.createdAt.slice(0, 10);
  return {
    experience: pick(profile.experience, (e) => !used.has(e.id)),
    projects: pick(profile.projects, (p) => !used.has(p.id)),
    education: pick(profile.education, (e) => !used.has(e.id)),
    certificates: pick(profile.certificates, (x) => !hasCert(x.name)),
    languages: pick(profile.languages, (x) => !hasLang(x.name)),
    // Bez listy z wersji nie wiadomo, które umiejętności AI pominęło celowo, więc ich nie proponujemy.
    skills: snap ? pick(profile.skills, (s) => !hasSkill(s.name)).map((s) => s.name) : [],
    facts: pick(
      profile.extraFacts.filter((f) => f.has),
      (f) => !used.has(f.id) && (snap ? true : f.date >= since),
    ),
    changed,
  };
}

export const newsCount = (n: ProfileNews) =>
  n.experience.length + n.projects.length + n.education.length + n.certificates.length + n.languages.length + n.skills.length + n.facts.length;
