import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  CertificateSchema,
  ContactSchema,
  EducationSchema,
  ExperienceSchema,
  JobPostingSchema,
  Pronouns,
  ProfileSchema,
  SkillSchema,
  type JobPosting,
  type Profile,
} from '../../shared/schemas';

// Przypadek ewaluacji to folder w evals/cases/<id>/:
//   case.json            opis (poziom, branża, pułapka) i opcjonalna lista faktów, których w CV być nie może
//   profile.json         profil kandydata w zwięzłym zapisie (bez identyfikatorów, domyślne pola można pominąć)
//   posting.md           treść ogłoszenia, tak jak kandydat wkleiłby ją w "Nowe CV"
//   posting.parsed.json  ogłoszenie przeanalizowane raz przez parsePosting i zamrożone, żeby modele dostały to samo

export const CASES_DIR = path.resolve(import.meta.dirname, '..', 'cases');

/** Fakt, którego w CV być nie może (profil go nie potwierdza), z odpowiednikami i powodem. */
export const ForbiddenSchema = z.object({ term: z.string().min(1), synonyms: z.array(z.string()).default([]), why: z.string().min(1) });

export const CaseMetaSchema = z.object({
  title: z.string().min(1),
  level: z.enum(['student', 'junior', 'zmiana branży', 'praca fizyczna']),
  industry: z.string().min(1),
  /** czego dotyczy przypadek-pułapka (pusty = zwykły przypadek) */
  trap: z.string().default(''),
  forbidden: z.array(ForbiddenSchema).default([]),
});
export type CaseMeta = z.infer<typeof CaseMetaSchema>;

const str = z.string().default('');
const CompactProfileSchema = z.object({
  pronouns: z.enum(Pronouns).optional(),
  contact: ContactSchema.extend({ links: ContactSchema.shape.links.default([]) }),
  headline: str,
  summary: str,
  experience: z
    .array(
      ExperienceSchema.omit({ id: true }).extend({
        kind: ExperienceSchema.shape.kind.default('praca'),
        company: str,
        location: str,
        start: str,
        end: str,
        current: z.boolean().default(false),
        description: str,
        achievements: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(EducationSchema.omit({ id: true }).extend({ degree: str, field: str, start: str, end: str, current: z.boolean().default(false), details: str }))
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: str,
        start: str,
        end: str,
        description: str,
        technologies: z.array(z.string()).default([]),
        link: str,
        achievements: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** umiejętności pogrupowane jak w profilu: kategoria → nazwy */
  skills: z.partialRecord(SkillSchema.shape.category, z.array(z.string())).default({}),
  languages: z.array(z.object({ name: z.string(), level: str })).default([]),
  certificates: z.array(CertificateSchema.omit({ id: true }).extend({ issuer: str, date: str })).default([]),
  interests: z.array(z.string()).default([]),
});

/** Zwięzły profil z pliku → pełny Profile aplikacji (identyfikatory po kolei: exp1, edu1, prj1, s1, l1, c1). */
export function expandProfile(id: string, raw: unknown): Profile {
  const p = CompactProfileSchema.parse(raw);
  const t = '2026-01-01T00:00:00.000Z';
  return ProfileSchema.parse({
    id,
    displayName: p.contact.fullName,
    pronouns: p.pronouns,
    createdAt: t,
    updatedAt: t,
    apiKey: '',
    photo: '',
    files: [],
    extraFacts: [],
    contact: p.contact,
    headline: p.headline,
    summary: p.summary,
    experience: p.experience.map((e, i) => ({ id: `exp${i + 1}`, ...e })),
    education: p.education.map((e, i) => ({ id: `edu${i + 1}`, ...e })),
    projects: p.projects.map((x, i) => ({ id: `prj${i + 1}`, ...x })),
    skills: Object.entries(p.skills).flatMap(([category, names]) => (names ?? []).map((name) => ({ name, category, level: '' }))).map((s, i) => ({ id: `s${i + 1}`, ...s })),
    languages: p.languages.map((l, i) => ({ id: `l${i + 1}`, ...l })),
    certificates: p.certificates.map((c, i) => ({ id: `c${i + 1}`, ...c })),
    interests: p.interests,
  });
}

export interface EvalCase {
  id: string;
  dir: string;
  meta: CaseMeta;
  profile: Profile;
  postingText: string;
  /** null, dopóki ogłoszenie nie zostało przeanalizowane i zamrożone */
  parsed: JobPosting | null;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

export function loadCase(dir: string): EvalCase {
  const id = path.basename(dir);
  const parsedFile = path.join(dir, 'posting.parsed.json');
  return {
    id,
    dir,
    meta: CaseMetaSchema.parse(readJson(path.join(dir, 'case.json'))),
    profile: expandProfile(id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64), readJson(path.join(dir, 'profile.json'))),
    postingText: fs.readFileSync(path.join(dir, 'posting.md'), 'utf8').trim(),
    parsed: fs.existsSync(parsedFile) ? JobPostingSchema.parse(readJson(parsedFile)) : null,
  };
}

/** Wszystkie przypadki z folderu, po kolei; `only` zawęża do podanych id (albo ich początków, np. "01"). */
export function loadCases(casesDir = CASES_DIR, only: string[] = []): EvalCase[] {
  return fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!only.length || only.some((o) => d.name === o || d.name.startsWith(`${o}-`))))
    .map((d) => loadCase(path.join(casesDir, d.name)))
    .sort((a, b) => a.id.localeCompare(b.id));
}
