import { describe, expect, it } from 'vitest';
import type { CvText, CvVersion, Profile } from '../shared/schemas';
import { profileEntriesOf, profileIdsOf, profileNews } from '../server/cv/profileNews';
import { applyProfileFields, entryUpdates, mergeSync, needsAi, syncRequest } from '../server/cv/syncMerge';
import { checkedImproveSchema } from '../server/llm/prompts/cvChecks';
import * as fixtures from './fixtures';

const text = (id: string, t: string, sourceIds = ['exp1']): CvText => ({ id, text: t, status: 'fact', reason: '', fallbackText: '', sourceIds });

/** Wersja CV z kopią profilu z chwili powstania i z ręcznymi poprawkami kandydata. */
function edited(profile: Profile, withEntries = true): CvVersion {
  const cv = structuredClone(fixtures.cv);
  cv.profileIds = profileIdsOf(profile);
  if (withEntries) cv.profileEntries = profileEntriesOf(profile);
  cv.content.summary.text = 'Moje własne podsumowanie, poprawione ręcznie.';
  cv.content.experience[0].bullets = [text('b1', 'Prowadzenie profilu firmy na Instagramie i TikToku')];
  cv.decisions = {};
  return cv;
}

let n = 0;
const fresh = () => `new${++n}`;

function plan(profile: Profile, cv: CvVersion, sameLang = true) {
  const news = profileNews(profile, cv);
  const updates = entryUpdates(news, cv);
  const fields = applyProfileFields(cv.content, profile, news, updates, sameLang);
  return { news, updates, fields, request: syncRequest(news, fields.content, updates, fields.aiHeaders) };
}

describe('synchronizacja z profilem bez gubienia ręcznych poprawek', () => {
  it('zmienione stanowisko i daty: wpisane bez AI, punkty i podsumowanie kandydata zostają', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before);
    const after = structuredClone(before);
    after.experience[0].role = 'Specjalistka ds. marketingu';
    after.experience[0].end = '2025-12';

    const { updates, fields, request } = plan(after, cv);
    expect(updates).toEqual([{ id: 'exp1', header: true, points: [], technologies: [] }]);
    expect(needsAi(request)).toBe(false);
    const e = fields.content.experience[0];
    expect(e.role).toBe('Specjalistka ds. marketingu');
    expect(e.dates).toBe('07.2025 - 12.2025');
    expect(e.bullets).toEqual(cv.content.experience[0].bullets);
    expect(fields.content.summary.text).toBe('Moje własne podsumowanie, poprawione ręcznie.');
    expect(fields.touched).toEqual(['Specjalistka ds. marketingu']);
  });

  it('wersja bez kopii pozycji (sprzed zmiany): poprawia nagłówek, punktów nie rusza i nie woła AI', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before, false);
    const after = structuredClone(before);
    after.experience[0].role = 'Specjalistka ds. marketingu';
    after.experience[0].achievements.push('Nowe osiągnięcie');
    const { fields, request } = plan(after, cv);
    expect(needsAi(request)).toBe(false);
    expect(fields.content.experience[0].role).toBe('Specjalistka ds. marketingu');
    expect(fields.content.experience[0].bullets).toHaveLength(1);
  });

  it('nowe osiągnięcie w pozycji z CV: AI dopisuje jeden punkt, przepisany i przywrócony punkt odpadają', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before);
    const after = structuredClone(before);
    after.experience[0].achievements.push('Przygotowywałam kampanie w Google Ads');

    const { fields, request } = plan(after, cv);
    expect(request.updates).toEqual([{ id: 'exp1', header: false, newPoints: ['Przygotowywałam kampanie w Google Ads'] }]);
    expect(needsAi(request)).toBe(true);

    const ai = structuredClone(fields.content);
    ai.summary.text = 'Podsumowanie napisane przez AI od nowa.';
    ai.experience[0].bullets = [
      text('x1', 'Prowadzenie profilu firmy na Instagramie i TikToku (social media)'), // przepisany punkt kandydata
      text('x2', 'Przygotowywanie raportów w Google Analytics 4'), // punkt, który kandydat usunął
      text('x3', 'Przygotowywanie kampanii w Google Ads'), // nowy
    ];
    ai.notes = 'Dodano kampanie Google Ads.';
    const merged = mergeSync(fields.content, ai, request, fresh);
    expect(merged.summary.text).toBe('Moje własne podsumowanie, poprawione ręcznie.');
    expect(merged.experience[0].bullets.map((b) => b.text)).toEqual([
      'Prowadzenie profilu firmy na Instagramie i TikToku',
      'Przygotowywanie kampanii w Google Ads',
    ]);
    expect(merged.experience[0].bullets[0].id).toBe('b1');
    expect(merged.experience[0].bullets[1].id).toMatch(/^new/);
    expect(merged.notes).toBe('Dodano kampanie Google Ads.');
  });

  it('nowa praca: staje tam, gdzie postawiło ją AI, a reszta CV i pozycje, których AI nie oddało, zostają', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before);
    const after = structuredClone(before);
    after.experience.push({
      id: 'exp2', kind: 'praca', role: 'Asystentka ds. social media', company: 'Nowa Firma', location: 'Kraków',
      start: '2025-10', end: '', current: true, description: '', achievements: ['Tworzyłam posty na Instagramie'],
    });
    const { fields, request } = plan(after, cv);
    expect(request.experience.map((e) => e.id)).toEqual(['exp2']);

    const ai = structuredClone(fields.content);
    ai.experience = [
      { sourceId: 'exp2', role: 'Asystentka ds. social media', company: 'Nowa Firma', location: 'Kraków', dates: '10.2025 - obecnie', bullets: [text('y1', 'Tworzenie postów na Instagramie', ['exp2'])] },
      { sourceId: 'exp-fake', role: 'Wymyślona', company: 'Nie ma', location: '', dates: '', bullets: [] },
    ];
    ai.education = [];
    const merged = mergeSync(fields.content, ai, request, fresh);
    expect(merged.experience.map((e) => e.sourceId)).toEqual(['exp2', 'exp1']);
    expect(merged.experience[0].bullets[0].id).toMatch(/^new/);
    expect(merged.experience[1]).toEqual(fields.content.experience[0]);
    expect(merged.education).toEqual(fields.content.education);
  });

  it('"mam to" przy słowie kluczowym: umiejętność z faktu wchodzi, wymyślona przez AI nie', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before);
    const after = structuredClone(before);
    after.extraFacts.push({ id: 'f1', topic: 'Google Ads', has: true, answer: 'Prowadziłam kampanie na zajęciach', source: 'raport ATS', date: '2026-11-09' });
    const { fields, request } = plan(after, cv);
    expect(request.facts.map((f) => f.id)).toEqual(['f1']);

    const ai = structuredClone(fields.content);
    ai.skills = [{ category: 'Narzędzia', items: ['Google Analytics 4', 'Canva', 'MS Excel', 'Google Ads', 'Meta Ads'] }];
    ai.experience[0].bullets.push(text('z1', 'Prowadzenie kampanii Google Ads na zajęciach', ['f1']));
    const merged = mergeSync(fields.content, ai, request, fresh);
    expect(merged.skills[0].items).toEqual(['Google Analytics 4', 'Canva', 'MS Excel', 'Google Ads']);
    expect(merged.experience[0].bullets.map((b) => b.text)).toEqual([
      'Prowadzenie profilu firmy na Instagramie i TikToku',
      'Prowadzenie kampanii Google Ads na zajęciach',
    ]);
  });

  it('kontrola stylu przy poprawce: tekst kandydata z obecnej wersji przechodzi, nowy tekst AI z tym samym błędem nie', () => {
    const current = structuredClone(fixtures.cv.content);
    current.summary.text = 'Studiuję marketing i sama poprawiłam to podsumowanie.';
    const schema = checkedImproveSchema(fixtures.profile, 'pl', current, fixtures.posting.keywords, false);
    expect(schema.safeParse(current).success).toBe(true);
    const rewritten = structuredClone(current);
    rewritten.summary.text = 'Studiuję marketing i prowadziłam kampanie.';
    expect(schema.safeParse(rewritten).success).toBe(false);
  });

  it('CV w innym języku niż profil: daty wprost z profilu, stanowisko tłumaczy AI', () => {
    const before = structuredClone(fixtures.profile);
    const cv = edited(before);
    cv.content.language = 'en';
    cv.content.experience[0].role = 'Marketing Intern';
    const after = structuredClone(before);
    after.experience[0].role = 'Specjalistka ds. marketingu';
    after.experience[0].end = '2025-12';

    const { fields, request } = plan(after, cv, false);
    expect(fields.content.experience[0].role).toBe('Marketing Intern');
    expect(fields.content.experience[0].dates).toBe('07/2025 - 12/2025');
    expect(request.updates).toEqual([{ id: 'exp1', header: true, newPoints: [] }]);

    const ai = structuredClone(fields.content);
    ai.experience[0].role = 'Marketing Specialist';
    const merged = mergeSync(fields.content, ai, request, fresh);
    expect(merged.experience[0].role).toBe('Marketing Specialist');
    expect(merged.experience[0].bullets).toEqual(fields.content.experience[0].bullets);
  });
});
