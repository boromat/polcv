import { describe, expect, it } from 'vitest';
import { loadCases } from '../evals/lib/cases';
import { forbiddenInProfile } from '../evals/lib/forbidden';

// Zbiór do ewaluacji jakości (evals/cases): poprawne dane, fikcyjne osoby i sensowne pułapki.
const cases = loadCases();
const allText = (c: (typeof cases)[number]) => JSON.stringify(c.profile) + c.postingText;

describe('zbiór przypadków ewaluacji', () => {
  it('15-20 par profil + ogłoszenie, wszystkie poprawne według schematów aplikacji', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(cases.length).toBeLessThanOrEqual(20);
    for (const c of cases) {
      expect(c.postingText.length, c.id).toBeGreaterThan(200);
      expect(c.profile.experience.length + c.profile.projects.length, c.id).toBeGreaterThan(0);
    }
  });

  it('różne poziomy i co najmniej trzy pułapki', () => {
    const levels = new Set(cases.map((c) => c.meta.level));
    expect([...levels].sort()).toEqual(['junior', 'praca fizyczna', 'student', 'zmiana branży']);
    expect(cases.filter((c) => c.meta.trap).length).toBeGreaterThanOrEqual(3);
  });

  it('dane fikcyjne: adresy e-mail i linki tylko w example.com', () => {
    for (const c of cases) {
      for (const email of allText(c).match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email.endsWith('@example.com'), `${c.id}: ${email}`).toBe(true);
      for (const url of allText(c).match(/https?:\/\/[^\s"),]+/g) ?? []) expect(new URL(url).hostname, `${c.id}: ${url}`).toBe('example.com');
    }
  });

  it('co najmniej 5 par z listą zakazanych faktów, a żadnego z nich nie ma w profilu', () => {
    const withForbidden = cases.filter((c) => c.meta.forbidden.length);
    expect(withForbidden.length).toBeGreaterThanOrEqual(5);
    for (const c of withForbidden) expect(forbiddenInProfile(c.profile, c.meta.forbidden), c.id).toEqual([]);
  });

  it('profil bez liczb naprawdę nie ma liczb poza datami', () => {
    const c = cases.find((x) => x.id.includes('bez-liczb'))!;
    const p = c.profile;
    const texts = [p.headline, p.summary, ...p.experience.flatMap((e) => [e.role, e.company, e.description, ...e.achievements]), ...p.skills.map((s) => s.name)];
    expect(texts.filter((t) => /\d/.test(t))).toEqual([]);
  });

  it('bardzo długi profil jest naprawdę długi', () => {
    const p = cases.find((x) => x.id.includes('dlugi-profil'))!.profile;
    expect(p.experience.length).toBeGreaterThanOrEqual(8);
    expect(p.skills.length).toBeGreaterThanOrEqual(30);
  });
});
