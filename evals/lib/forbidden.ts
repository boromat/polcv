import type { CvContent, CvText, Profile } from '../../shared/schemas';
import { countPhrase, tokenize, type MatchLang } from '../../server/ats/keywords';
import type { CaseMeta } from './cases';

// Fakty, których w CV być nie może: szukamy ich w gotowym CV tym samym dopasowaniem fraz co ocena ATS (z odmianą).

export interface Violation {
  term: string;
  /** brzmienie, które pasowało (term albo synonim) */
  foundAs: string;
  /** gdzie w CV: headline, summary, bullet, skills, technologies, certificates, languages, interests */
  where: string;
  /** fact = przeszło do CV jako fakt; suggested = tylko w żółtej sugestii, którą kandydat musi zatwierdzić */
  status: 'fact' | 'suggested';
  text: string;
}

interface Piece {
  where: string;
  status: 'fact' | 'suggested';
  text: string;
}

const textPiece = (where: string, t: CvText): Piece[] =>
  t.status === 'suggested'
    ? [
        { where, status: 'suggested', text: t.text },
        // Wersja bezpieczna po odrzuceniu sugestii staje się faktem.
        ...(t.fallbackText ? [{ where, status: 'fact' as const, text: t.fallbackText }] : []),
      ]
    : [{ where, status: 'fact', text: t.text }];

function cvPieces(c: CvContent): Piece[] {
  const fact = (where: string, text: string): Piece => ({ where, status: 'fact', text });
  return [
    fact('headline', c.headline),
    ...textPiece('summary', c.summary),
    ...c.experience.flatMap((e) => [fact('experience', `${e.role} ${e.company}`), ...e.bullets.flatMap((b) => textPiece('bullet', b))]),
    ...c.projects.flatMap((p) => [fact('projects', `${p.name} ${p.role}`), ...p.technologies.map((t) => fact('technologies', t)), ...p.bullets.flatMap((b) => textPiece('bullet', b))]),
    ...c.education.map((e) => fact('education', `${e.degree} ${e.field} ${e.details}`)),
    ...c.skills.flatMap((g) => g.items.map((i) => fact('skills', i))),
    ...c.certificates.map((x) => fact('certificates', `${x.name} ${x.issuer}`)),
    ...c.languages.map((l) => fact('languages', `${l.name} ${l.level}`)),
    ...c.interests.map((i) => fact('interests', i)),
  ].filter((p) => p.text.trim());
}

function find(pieces: Piece[], forbidden: CaseMeta['forbidden'], lang: MatchLang): Violation[] {
  const out: Violation[] = [];
  for (const f of forbidden) {
    for (const p of pieces) {
      const tokens = tokenize(p.text);
      const foundAs = [f.term, ...f.synonyms].find((v) => countPhrase(tokens, v, lang) > 0);
      if (foundAs) out.push({ term: f.term, foundAs, where: p.where, status: p.status, text: p.text });
    }
  }
  return out;
}

/** Zakazane fakty w gotowym CV (z podziałem na fakty i żółte sugestie). */
export const forbiddenInCv = (c: CvContent, forbidden: CaseMeta['forbidden']): Violation[] => find(cvPieces(c), forbidden, c.language);

/** To samo dla profilu: zakazany fakt nie może być w profilu, inaczej przypadek jest źle przygotowany. */
export function forbiddenInProfile(p: Profile, forbidden: CaseMeta['forbidden']): Violation[] {
  const texts = [
    p.headline,
    p.summary,
    ...p.experience.flatMap((e) => [e.role, e.company, e.description, ...e.achievements]),
    ...p.projects.flatMap((x) => [x.name, x.role, x.description, ...x.technologies, ...x.achievements]),
    ...p.education.flatMap((e) => [e.school, e.degree, e.field, e.details]),
    ...p.skills.map((s) => s.name),
    ...p.certificates.map((c) => `${c.name} ${c.issuer}`),
    ...p.languages.map((l) => `${l.name} ${l.level}`),
    ...p.interests,
  ];
  return find(texts.filter((t) => t.trim()).map((text) => ({ where: 'profile', status: 'fact', text })), forbidden, 'pl');
}
