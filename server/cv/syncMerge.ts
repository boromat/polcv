import type { CvContent, CvText, CvVersion, ExtraFact, Profile, SectionKey } from '../../shared/schemas';
import { normalize } from '../ats/keywords';
import { cvDateRange } from '../llm/prompts/cvChecks';
import type { ProfileNews } from './profileNews';

// "Synchronizuj z profilem" nie może zabierać kandydatowi ręcznych poprawek w CV. Zmienione nazwy, firmy i daty pozycji,
// które CV już ma, wpisujemy bez AI. AI dostaje tylko to, czego nie da się przepisać wprost (nowe pozycje, fakty, nowe
// osiągnięcia), a z jego odpowiedzi bierzemy wyłącznie te nowości. Reszta CV zostaje w wersji kandydata słowo w słowo.

const same = (a: string, b: string) => normalize(a) === normalize(b);
const words = (s: string) => ` ${normalize(s)} `;
const stems = (s: string) => new Set(normalize(s).split(' ').filter((w) => w.length >= 3).map((w) => w.slice(0, 5)));

/** Ile wspólnych rdzeni słów mają dwa teksty (0-1); "Przygotowywałam raporty" i "Przygotowywanie raportów" dają 1. */
function overlap(a: string, b: string): number {
  const A = stems(a);
  const B = stems(b);
  if (!A.size || !B.size) return same(a, b) ? 1 : 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size);
}

/** Ten sam punkt innymi słowami (AI przepisało istniejący punkt zamiast go zostawić). */
const similar = (a: string, b: string) => overlap(a, b) >= 0.7;

/** Pozycja, która już jest w CV, a kandydat zmienił ją w profilu. */
export interface EntryUpdate {
  id: string;
  /** zmieniły się stanowisko, firma, szkoła, kierunek, miejscowość, link albo daty */
  header: boolean;
  /** nowe osiągnięcia (albo nowy opis) z profilu: z nich AI pisze nowe punkty */
  points: string[];
  /** nowe technologie projektu */
  technologies: string[];
}

const key = (...xs: (string | boolean)[]) => xs.map((x) => (typeof x === 'string' ? normalize(x) : String(x))).join('|');
const added = (now: string[], before: string[]) => now.filter((a) => a.trim() && !before.some((b) => same(a, b))).map((a) => a.trim());
const newText = (now: string, before: string) => (now.trim() && !same(now, before) ? [now.trim()] : []);

/**
 * Co dokładnie zmieniło się w pozycjach z CV, według kopii pozycji z chwili powstania wersji. Wersja bez kopii
 * (sprzed tej zmiany) zna tylko sam fakt zmiany: wtedy poprawiamy nagłówek, a punktów nie ruszamy.
 */
export function entryUpdates(news: ProfileNews, cv: CvVersion): EntryUpdate[] {
  const changed = new Set(news.changed);
  const c = cv.content;
  const old = cv.profileEntries;
  const out: EntryUpdate[] = [];
  for (const e of news.experience) {
    if (!changed.has(e.id) || !c.experience.some((x) => x.sourceId === e.id)) continue;
    const o = old?.experience.find((x) => x.id === e.id);
    out.push({
      id: e.id,
      header: !o || key(o.role, o.company, o.location, o.start, o.end, o.current) !== key(e.role, e.company, e.location, e.start, e.end, e.current),
      points: o ? [...added(e.achievements, o.achievements), ...newText(e.description, o.description)] : [],
      technologies: [],
    });
  }
  for (const p of news.projects) {
    if (!changed.has(p.id) || !c.projects.some((x) => x.sourceId === p.id)) continue;
    const o = old?.projects.find((x) => x.id === p.id);
    out.push({
      id: p.id,
      header: !o || key(o.name, o.role, o.link, o.start, o.end) !== key(p.name, p.role, p.link, p.start, p.end),
      points: o ? [...added(p.achievements, o.achievements), ...newText(p.description, o.description)] : [],
      technologies: o ? added(p.technologies, o.technologies) : [],
    });
  }
  for (const e of news.education) {
    if (!changed.has(e.id) || !c.education.some((x) => x.sourceId === e.id)) continue;
    const o = old?.education.find((x) => x.id === e.id);
    out.push({
      id: e.id,
      header: !o || key(o.school, o.degree, o.field, o.start, o.end, o.current, o.details) !== key(e.school, e.degree, e.field, e.start, e.end, e.current, e.details),
      points: [],
      technologies: [],
    });
  }
  return out;
}

/**
 * Zmienione pola pozycji z CV przechodzą wprost z profilu, bez AI. CV w innym języku niż profil dostaje tak tylko to,
 * co od języka nie zależy (firma, miejscowość, link, daty, technologie); resztę nagłówka (`aiHeaders`) poprawi AI.
 */
export function applyProfileFields(
  c: CvContent,
  profile: Profile,
  news: ProfileNews,
  updates: EntryUpdate[],
  sameLang: boolean,
): { content: CvContent; touched: string[]; aiHeaders: string[] } {
  const touched: string[] = [];
  const aiHeaders: string[] = [];
  const lang = c.language;
  const upd = (id: string) => updates.find((u) => u.id === id);
  const track = <T>(before: T, after: T, label: string): T => {
    if (JSON.stringify(before) !== JSON.stringify(after) && label.trim()) touched.push(label.trim());
    return after;
  };

  const experience = c.experience.map((e) => {
    const src = profile.experience.find((x) => x.id === e.sourceId);
    if (!src || !upd(e.sourceId)?.header) return e;
    if (!sameLang) aiHeaders.push(e.sourceId);
    const next = {
      ...e,
      role: sameLang ? src.role.trim() || e.role : e.role,
      company: src.company.trim() || e.company,
      location: src.location.trim(),
      dates: cvDateRange(src.start, src.end, src.current, lang) ?? e.dates,
    };
    return track(e, next, next.role || next.company);
  });
  const projects = c.projects.map((p) => {
    const src = profile.projects.find((x) => x.id === p.sourceId);
    const u = upd(p.sourceId);
    if (!src || !u) return p;
    const technologies = [...p.technologies, ...u.technologies.filter((t) => !p.technologies.some((x) => same(x, t)))];
    if (!u.header) return track(p, { ...p, technologies }, p.name);
    if (!sameLang) aiHeaders.push(p.sourceId);
    const next = {
      ...p,
      name: src.name.trim() || p.name,
      role: sameLang ? src.role.trim() : p.role,
      link: src.link.trim(),
      dates: cvDateRange(src.start, src.end, false, lang) ?? p.dates,
      technologies,
    };
    return track(p, next, next.name);
  });
  const education = c.education.map((e) => {
    const src = profile.education.find((x) => x.id === e.sourceId);
    if (!src || !upd(e.sourceId)?.header) return e;
    if (!sameLang) aiHeaders.push(e.sourceId);
    const dates = cvDateRange(src.start, src.end, src.current, lang) ?? e.dates;
    const next = sameLang
      ? { ...e, school: src.school.trim() || e.school, degree: src.degree.trim(), field: src.field.trim(), details: src.details.trim(), dates }
      : { ...e, dates };
    return track(e, next, next.school || next.field);
  });

  const changed = new Set(news.changed);
  const certificates = c.certificates.map((x) => {
    const src = news.certificates.find((s) => changed.has(s.id) && same(s.name, x.name));
    if (!src) return x;
    return track(x, { ...x, issuer: src.issuer.trim() || x.issuer, date: cvDateRange(src.date, '', false, lang) ?? x.date }, x.name);
  });
  const languages = c.languages.map((l) => {
    const src = news.languages.find((s) => changed.has(s.id) && same(s.name, l.name));
    // Poziom "B2" pasuje do każdego CV, "ojczysty" tylko do polskiego.
    if (!src?.level.trim() || !(sameLang || /^[abc][12]\+?$/i.test(src.level.trim()))) return l;
    return track(l, { ...l, level: src.level.trim() }, l.name);
  });

  return { content: { ...c, experience, projects, education, certificates, languages }, touched, aiHeaders };
}

/** To, co z nowości w profilu musi napisać AI. */
export interface SyncRequest {
  /** nowe pozycje: jeszcze ich nie ma w CV */
  experience: Profile['experience'];
  projects: Profile['projects'];
  education: Profile['education'];
  certificates: Profile['certificates'];
  languages: Profile['languages'];
  skills: string[];
  facts: ExtraFact[];
  /** pozycje z CV do uzupełnienia: nowe punkty z `newPoints`, a przy `header` nagłówek w języku CV */
  updates: { id: string; header: boolean; newPoints: string[] }[];
}

export function syncRequest(news: ProfileNews, c: CvContent, updates: EntryUpdate[], aiHeaders: string[]): SyncRequest {
  const inCv = new Set([...c.experience, ...c.projects, ...c.education].map((e) => e.sourceId));
  // Fakt, z którego CV już ma punkt, nie wraca drugi raz.
  const usedFacts = new Set([c.summary, ...c.experience.flatMap((e) => e.bullets), ...c.projects.flatMap((p) => p.bullets)].flatMap((t) => t.sourceIds));
  const has = (names: string[]) => (name: string) => names.some((n) => same(n, name));
  const hasSkill = has([...c.skills.flatMap((g) => g.items), ...c.projects.flatMap((p) => p.technologies)]);
  const hasCert = has(c.certificates.map((x) => x.name));
  const hasLang = has(c.languages.map((x) => x.name));
  return {
    experience: news.experience.filter((e) => !inCv.has(e.id)),
    projects: news.projects.filter((p) => !inCv.has(p.id)),
    education: news.education.filter((e) => !inCv.has(e.id)),
    certificates: news.certificates.filter((x) => !hasCert(x.name)),
    languages: news.languages.filter((x) => !hasLang(x.name)),
    skills: news.skills.filter((s) => !hasSkill(s)),
    facts: news.facts.filter((f) => !usedFacts.has(f.id) && !inCv.has(f.id)),
    updates: updates
      .map((u) => ({ id: u.id, header: aiHeaders.includes(u.id), newPoints: u.points }))
      .filter((u) => u.header || u.newPoints.length > 0),
  };
}

export const needsAi = (r: SyncRequest) =>
  r.experience.length + r.projects.length + r.education.length + r.certificates.length + r.languages.length + r.skills.length + r.facts.length + r.updates.length > 0;

/**
 * Pozycje w kolejności z wersji kandydata. Nowa pozycja z AI staje za tą, za którą postawiło ją AI;
 * pozycji spoza nowości (wymyślonych albo przywróconych przez AI) nie bierzemy.
 */
function mergeEntries<T extends { sourceId: string }>(base: T[], ai: T[], isNew: (id: string) => boolean, keep: (b: T, a: T) => T, add: (a: T) => T): T[] {
  const out = base.map((b) => {
    const a = ai.find((x) => x.sourceId === b.sourceId);
    return a ? keep(b, a) : b;
  });
  let after = -1;
  for (const a of ai) {
    const i = out.findIndex((x) => x.sourceId === a.sourceId);
    if (i >= 0) {
      after = i;
      continue;
    }
    if (!isNew(a.sourceId)) continue;
    out.splice(after + 1, 0, add(a));
    after++;
  }
  return out;
}

/**
 * Wersja kandydata + odpowiedź AI. Z AI bierzemy tylko: nowe pozycje, nowe punkty (z nowego faktu albo z nowych osiągnięć
 * pozycji, najwyżej tyle, ile tych osiągnięć), nagłówki z `aiHeaders`, nowe umiejętności, certyfikaty i języki oraz notatkę.
 */
export function mergeSync(base: CvContent, ai: CvContent, req: SyncRequest, freshId: () => string): CvContent {
  const factIds = new Set(req.facts.map((f) => f.id));
  const newIds = new Set([...req.experience, ...req.projects, ...req.education, ...req.facts].map((x) => x.id));
  const updates = new Map(req.updates.map((u) => [u.id, u]));
  const fresh = (t: CvText): CvText => ({ ...t, id: freshId() });
  const withFresh = <T extends { bullets: CvText[] }>(a: T): T => ({ ...a, bullets: a.bullets.map(fresh) });

  const bullets = (id: string, mine: CvText[], theirs: CvText[]): CvText[] => {
    const ids = new Set(mine.map((b) => b.id));
    const candidates = theirs.filter((b) => b.text.trim() && !ids.has(b.id) && !mine.some((m) => similar(m.text, b.text)));
    const fromFacts = candidates.filter((b) => b.sourceIds.some((s) => factIds.has(s)));
    // Najpierw punkty najbliższe nowym osiągnięciom: punkt, który kandydat usunął, nie wejdzie zamiast nowego.
    const points = updates.get(id)?.newPoints ?? [];
    const fit = (b: CvText) => Math.max(0, ...points.map((p) => overlap(p, b.text)));
    const fromPoints = candidates
      .filter((b) => !fromFacts.includes(b))
      .sort((x, y) => fit(y) - fit(x))
      .slice(0, points.length);
    return [...mine, ...candidates.filter((b) => fromFacts.includes(b) || fromPoints.includes(b)).map(fresh)];
  };
  const header = (id: string) => updates.get(id)?.header === true;

  const experience = mergeEntries(
    base.experience,
    ai.experience,
    (id) => newIds.has(id),
    (b, a) => ({ ...b, ...(header(b.sourceId) && { role: a.role, company: a.company, location: a.location, dates: a.dates }), bullets: bullets(b.sourceId, b.bullets, a.bullets) }),
    withFresh,
  );
  const projects = mergeEntries(
    base.projects,
    ai.projects,
    (id) => newIds.has(id),
    (b, a) => ({ ...b, ...(header(b.sourceId) && { name: a.name, role: a.role, link: a.link, dates: a.dates }), bullets: bullets(b.sourceId, b.bullets, a.bullets) }),
    withFresh,
  );
  const education = mergeEntries(
    base.education,
    ai.education,
    (id) => newIds.has(id),
    (b, a) => (header(b.sourceId) ? { ...b, school: a.school, degree: a.degree, field: a.field, dates: a.dates, details: a.details } : b),
    (a) => a,
  );

  // Umiejętność z AI: z listy nowych albo z nowego faktu (temat "mam to" albo słowo z odpowiedzi kandydata).
  const allowed = (item: string) =>
    req.skills.some((s) => same(s, item)) || req.facts.some((f) => same(f.topic, item) || words(f.answer).includes(words(item)));
  const skills = base.skills.map((g) => ({ ...g, items: [...g.items] }));
  const inCv = (item: string) => skills.some((g) => g.items.some((i) => same(i, item))) || base.projects.some((p) => p.technologies.some((t) => same(t, item)));
  for (const g of ai.skills) {
    for (const item of g.items) {
      if (!item.trim() || inCv(item) || !allowed(item)) continue;
      const target = skills.find((x) => same(x.category, g.category));
      if (target) target.items.push(item);
      else skills.push({ category: g.category, items: [item] });
    }
  }
  const certificates = [
    ...base.certificates,
    ...ai.certificates.filter((x) => req.certificates.some((n) => same(n.name, x.name)) && !base.certificates.some((b) => same(b.name, x.name))),
  ];
  const languages = [
    ...base.languages,
    ...ai.languages.filter((x) => req.languages.some((n) => same(n.name, x.name)) && !base.languages.some((b) => same(b.name, x.name))),
  ];

  // Sekcja, której wersja kandydata nie miała (np. pierwsze doświadczenie), staje tam, gdzie postawiło ją AI.
  const filled: Record<SectionKey, boolean> = {
    summary: true, experience: experience.length > 0, projects: projects.length > 0, education: education.length > 0,
    skills: skills.length > 0, certificates: certificates.length > 0, languages: languages.length > 0, interests: base.interests.length > 0,
  };
  const order: SectionKey[] = [...base.sectionOrder];
  ai.sectionOrder.forEach((k, i) => {
    if (!order.includes(k) && filled[k]) order.splice(Math.min(i, order.length), 0, k);
  });

  return { ...base, sectionOrder: order, experience, projects, education, skills, certificates, languages, notes: ai.notes };
}
