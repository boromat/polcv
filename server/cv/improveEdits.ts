import { z } from 'zod';
import type { CvContent, CvText, Keyword, Profile } from '../../shared/schemas';
import { normalize } from '../ats/keywords';
import { tr, type Lang } from '../i18n';
import { currentTexts, cvDateRange, cvSkillItems, lostKeywordIssues, skillIssues, styleIssues } from '../llm/prompts/cvChecks';
import { parseCvDates } from './profileSync';

// "Popraw automatycznie" nie przepisuje całego CV: AI zwraca listę zmian w konkretnych miejscach, każdą przypisaną do
// pozycji planu, którą kandydat zaznaczył. Program wprowadza tylko te zmiany, a reszta CV zostaje słowo w słowo.

export const ImproveEditsSchema = z.object({
  edits: z.array(
    z.object({
      item: z.string().describe('"id" pozycji z PLANU POPRAWEK, którą realizuje ta zmiana'),
      action: z.enum(['replace', 'add', 'remove']),
      target: z
        .string()
        .describe('replace: "id" punktu, "summary", "headline" albo "education:<sourceId>" (szczegóły szkoły); add: "sourceId" pozycji doświadczenia lub projektu; remove: "id" punktu'),
      text: z.string().describe('nowy tekst; przy remove pusty'),
      sourceIds: z.array(z.string()).describe('add: id z profilu (pozycja albo extraFacts), na których opiera się nowy punkt; inaczej pusta lista'),
    }),
  ),
  skills: z.array(z.object({ item: z.string(), category: z.string().describe('nazwa grupy umiejętności z CV (albo nowej)'), name: z.string() })),
  notes: z.string(),
});
export type ImproveEdits = z.infer<typeof ImproveEditsSchema>;

export interface AppliedEdits {
  content: CvContent;
  /** id tekstów zmienionych albo dopisanych (tylko je sprawdzamy pod kątem liczb spoza profilu) */
  touched: Set<string>;
  /** co zmieniono, dla kandydata */
  changes: string[];
  /** błędy w odpowiedzi modelu (wracają do poprawki) */
  problems: string[];
}

const same = (a: string, b: string) => normalize(a) === normalize(b);
const short = (s: string) => (s.length > 60 ? `${s.slice(0, 59).trimEnd()}…` : s);
const asFact = (t: CvText, text: string): CvText => ({ ...t, text, status: 'fact', reason: '', fallbackText: '' });

/** Zmiany z AI na kopii CV. Zmiana spoza `allowed` (pozycji, których kandydat nie zaznaczył) nie wchodzi. */
export function applyEdits(base: CvContent, e: ImproveEdits, allowed: Set<string>, freshId: () => string): AppliedEdits {
  const c = structuredClone(base);
  const touched = new Set<string>();
  const changes: string[] = [];
  const problems: string[] = [];
  const findBullet = (id: string) => {
    for (const list of [...c.experience.map((x) => x.bullets), ...c.projects.map((x) => x.bullets)]) {
      const i = list.findIndex((b) => b.id === id);
      if (i >= 0) return { list, i };
    }
    return null;
  };

  for (const ed of e.edits) {
    if (!allowed.has(ed.item)) {
      problems.push(`Zmiana dla "${ed.target}" ma "item" "${ed.item}", którego nie ma w PLANIE POPRAWEK. Wpisz "id" pozycji planu albo usuń tę zmianę.`);
      continue;
    }
    const text = ed.text.trim();
    if (ed.action !== 'remove' && !text) {
      problems.push(`Zmiana "${ed.action}" dla "${ed.target}" ma pusty "text".`);
      continue;
    }
    if (ed.action === 'replace' && ed.target === 'summary') {
      if (text === c.summary.text) continue;
      c.summary = asFact(c.summary, text);
      touched.add(c.summary.id);
      changes.push(tr('podsumowanie'));
    } else if (ed.action === 'replace' && ed.target === 'headline') {
      if (text === c.headline) continue;
      c.headline = text;
      changes.push(tr('tytuł'));
    } else if (ed.action === 'replace' && ed.target.startsWith('education:')) {
      const school = c.education.find((x) => x.sourceId === ed.target.slice('education:'.length));
      if (!school) {
        problems.push(`Nie ma w CV szkoły "${ed.target}". Użyj "education:<sourceId>" szkoły z OBECNEGO CV.`);
        continue;
      }
      if (text === school.details) continue;
      school.details = text;
      changes.push(tr('szkoła „{name}”', { name: school.school || school.field }));
    } else if (ed.action === 'add') {
      const entry = c.experience.find((x) => x.sourceId === ed.target) ?? c.projects.find((x) => x.sourceId === ed.target);
      if (!entry) {
        problems.push(`Nie ma w CV pozycji o "sourceId" "${ed.target}". Nowy punkt dopisz do pozycji doświadczenia albo projektu z OBECNEGO CV; umiejętności dopisuj w "skills", nie w "edits".`);
        continue;
      }
      const id = freshId();
      entry.bullets.push({ id, text, status: 'fact', reason: '', fallbackText: '', sourceIds: ed.sourceIds.length ? ed.sourceIds : [ed.target] });
      touched.add(id);
      changes.push(tr('nowy punkt „{text}”', { text: short(text) }));
    } else {
      const hit = findBullet(ed.target);
      if (!hit) {
        problems.push(`Nie ma w CV punktu o "id" "${ed.target}". Użyj "id" punktu z OBECNEGO CV.`);
        continue;
      }
      if (ed.action === 'remove') {
        const [gone] = hit.list.splice(hit.i, 1);
        changes.push(tr('usunięty punkt „{text}”', { text: short(gone.text) }));
      } else {
        if (text === hit.list[hit.i].text) continue;
        hit.list[hit.i] = asFact(hit.list[hit.i], text);
        touched.add(ed.target);
        changes.push(tr('punkt „{text}”', { text: short(text) }));
      }
    }
  }

  for (const s of e.skills) {
    if (!allowed.has(s.item)) {
      problems.push(`Umiejętność "${s.name}" ma "item" "${s.item}", którego nie ma w PLANIE POPRAWEK.`);
      continue;
    }
    const name = s.name.trim();
    if (!name || c.skills.some((g) => g.items.some((i) => same(i, name)))) continue;
    const group = c.skills.find((g) => same(g.category, s.category)) ?? c.skills.at(-1);
    if (group) group.items.push(name);
    else c.skills.push({ category: s.category.trim() || tr('Umiejętności'), items: [name] });
    changes.push(tr('umiejętność „{name}”', { name }));
  }
  return { content: c, touched, changes, problems };
}

/** Id z profilu, na których może się opierać nowy punkt. */
const profileIds = (p: Profile) => new Set([...p.experience, ...p.projects, ...p.education, ...p.certificates, ...p.extraFacts.filter((f) => f.has)].map((x) => x.id));

/**
 * Schemat odpowiedzi modelu: zmiany muszą trafiać w istniejące miejsca i pozycje planu, nowe teksty trzymać styl CV,
 * a CV nie może zgubić słowa kluczowego. Teksty, których AI nie zmienia (np. napisane przez kandydata), nie są sprawdzane.
 */
export function checkedEditsSchema(base: CvContent, profile: Profile, lang: Lang, keywords: Keyword[], allowed: Set<string>) {
  const keep = currentTexts(base);
  const ids = profileIds(profile);
  return ImproveEditsSchema.superRefine((e, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: 'custom', path: [], message });
    const r = applyEdits(base, e, allowed, () => 'nowy');
    r.problems.forEach(add);
    for (const ed of e.edits) {
      const unknown = ed.action === 'add' ? ed.sourceIds.filter((id) => !ids.has(id)) : [];
      if (unknown.length) add(`Nowy punkt „${short(ed.text)}” ma w "sourceIds" id spoza profilu (${unknown.join(', ')}). Wpisz id z PROFILU KANDYDATA.`);
    }
    for (const i of styleIssues(r.content, lang, keep, profile.pronouns)) add(`${i.path.join('.')}: ${i.message}`);
    // Umiejętność dopisana przez AI musi wynikać z profilu; te, które CV już miało, zostają.
    for (const i of skillIssues(r.content, profile, keywords, cvSkillItems(base))) add(i.message);
    for (const i of lostKeywordIssues(r.content, base, keywords)) add(i.message);
  });
}

/** Teksty spoza zmian zostają takie, jak w wersji kandydata; ze sprawdzonej wersji bierzemy tylko zmienione. */
export function keepUntouched(applied: CvContent, checked: CvContent, touched: Set<string>): CvContent {
  const byId = new Map<string, CvText>();
  for (const t of [checked.summary, ...checked.experience.flatMap((x) => x.bullets), ...checked.projects.flatMap((x) => x.bullets)]) byId.set(t.id, t);
  const pick = (t: CvText) => (touched.has(t.id) ? (byId.get(t.id) ?? t) : t);
  return {
    ...applied,
    // Tytuł po kontroli: zmieniony przez AI i niepotwierdzony wraca jako sugestia, niezmieniony zostaje jak był.
    headline: checked.headline,
    headlineSuggestion: checked.headlineSuggestion,
    summary: pick(applied.summary),
    experience: applied.experience.map((x) => ({ ...x, bullets: x.bullets.map(pick) })),
    projects: applied.projects.map((x) => ({ ...x, bullets: x.bullets.map(pick) })),
  };
}

/** Jeden format dat w całym CV, bez AI: daty z profilu, a bez pozycji w profilu ten sam zakres w formacie CV. */
export function unifyDates(c: CvContent, profile: Profile): CvContent {
  const lang = c.language;
  const fromText = (dates: string) => {
    const d = parseCvDates(dates);
    return d ? cvDateRange(d.start, d.end, d.current, lang) : null;
  };
  const exp = new Map(profile.experience.map((e) => [e.id, e]));
  const proj = new Map(profile.projects.map((p) => [p.id, p]));
  const edu = new Map(profile.education.map((e) => [e.id, e]));
  return {
    ...c,
    experience: c.experience.map((e) => {
      const s = exp.get(e.sourceId);
      return { ...e, dates: (s ? cvDateRange(s.start, s.end, s.current, lang) : fromText(e.dates)) ?? e.dates };
    }),
    projects: c.projects.map((p) => {
      const s = proj.get(p.sourceId);
      return { ...p, dates: (s ? cvDateRange(s.start, s.end, false, lang) : fromText(p.dates)) ?? p.dates };
    }),
    education: c.education.map((e) => {
      const s = edu.get(e.sourceId);
      return { ...e, dates: (s ? cvDateRange(s.start, s.end, s.current, lang) : fromText(e.dates)) ?? e.dates };
    }),
  };
}
