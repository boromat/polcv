import { describe, expect, it } from 'vitest';
import { countPhrase, normalize, scoreKeywords, tokenize, tokenMatches } from '../server/ats/keywords';
import { decideLanguage, decidePhoto, decideRodo, RODO_STANDARD } from '../server/cv/rodo';
import { applyDecisions } from '../server/llm/prompts/common';
import { toStrictJsonSchema } from '../server/llm/openrouter';
import { CvContentSchema } from '../shared/schemas';
import { checkFormat } from '../server/ats/formatChecks';
import { shortCompany } from '../server/services';
import { cv, posting, profile } from './fixtures';

describe('normalizacja i fleksja', () => {
  it('usuwa polskie znaki i zostawia nazwy techniczne', () => {
    expect(normalize('Zażółć Gęślą JAŹŃ, C++ i Node.js')).toBe('zazolc gesla jazn c++ i node.js');
  });

  it('łapie polskie odmiany', () => {
    expect(tokenMatches('marketingu', 'marketing')).toBe(true);
    expect(tokenMatches('analizy', 'analiza')).toBe(true);
    expect(tokenMatches('sprzedazy', 'sprzedaz')).toBe(true);
    expect(tokenMatches('zarzadzania', 'zarzadzanie')).toBe(true);
  });

  it('nie myli różnych słów i krótkich skrótów', () => {
    expect(tokenMatches('komunikacja', 'komunikatywnosc')).toBe(false);
    expect(tokenMatches('dziennie', 'dziennikarstwo')).toBe(false);
    expect(tokenMatches('marketingu', 'marketingowy')).toBe(true);
    expect(tokenMatches('sql', 'sqlite')).toBe(false);
    expect(tokenMatches('ga4', 'ga3')).toBe(false);
  });

  it('liczy frazy wielowyrazowe z odmianą', () => {
    const t = tokenize('Doświadczenie w prowadzeniu kampanii Google Ads oraz kampanii w mediach społecznościowych');
    expect(countPhrase(t, 'Google Ads')).toBe(1);
    expect(countPhrase(t, 'media społecznościowe')).toBe(1);
    expect(countPhrase(t, 'kampania')).toBe(2);
  });
});

describe('wynik słów kluczowych', () => {
  it('waży obowiązkowe ×3 i zgłasza braki', () => {
    const r = scoreKeywords('Analityka Google Analytics 4, Instagram, Excel', posting.keywords);
    // must: GA (3) + social (3), nice: Excel (1) z 8 możliwych
    expect(r.score).toBe(Math.round((7 / 8) * 40));
    expect(r.missing.map((m) => m.term)).toEqual(['Google Ads']);
  });

  it('karze upychanie słów', () => {
    const r = scoreKeywords('Excel '.repeat(8), [{ term: 'Excel', synonyms: [], importance: 'must', category: 'narzędzie' }]);
    expect(r.stuffing).toEqual(['Excel']);
    expect(r.score).toBeLessThan(40);
  });
});

describe('RODO, zdjęcie, język', () => {
  it('dosłowna klauzula z ogłoszenia ma pierwszeństwo', () => {
    const r = decideRodo({ ...posting, rodoClause: 'Klauzula firmy X' }, 'pl');
    expect(r).toMatchObject({ include: true, text: 'Klauzula firmy X' });
  });

  it('standardowa klauzula dla polskiej oferty, z przyszłymi rekrutacjami na życzenie', () => {
    expect(decideRodo(posting, 'pl').text).toBe(RODO_STANDARD);
    expect(decideRodo({ ...posting, mentionsFutureRecruitment: true }, 'pl').text).toContain('przyszłych procesów');
  });

  it('bez klauzuli dla zagranicznej firmy po angielsku', () => {
    expect(decideRodo({ ...posting, companyIsInternational: true }, 'en').include).toBe(false);
  });

  it('zdjęcie tylko gdy pasuje', () => {
    expect(decidePhoto(posting, 'pl', true).include).toBe(true);
    expect(decidePhoto(posting, 'pl', false).include).toBe(false);
    expect(decidePhoto({ ...posting, photoPreference: 'unwanted' }, 'pl', true).include).toBe(false);
    expect(decidePhoto({ ...posting, companyIsInternational: true }, 'en', true).include).toBe(false);
  });

  it('język CV z wymogu albo z ogłoszenia', () => {
    expect(decideLanguage({ cvLanguageRequired: 'en', language: 'pl' })).toBe('en');
    expect(decideLanguage({ cvLanguageRequired: 'any', language: 'pl' })).toBe('pl');
  });
});

describe('kontrole formatu', () => {
  const text = (body: string) => ['Zofia Żółkiewska', 'zofia.zolkiewska@example.com | +48 600 100 200', body].join('\n');
  const base = applyDecisions(cv);

  it('nagłówek liczy się tylko jako osobna linia', () => {
    const order: typeof base = { ...base, sectionOrder: ['summary', 'experience', 'education'] };
    // "Wykształcenie" występuje w treści przed nagłówkiem "Doświadczenie zawodowe" — kolejność ma nadal przejść.
    // Zawinięta linia "wykształcenie." (z kropką) przed nagłówkiem też nie może być wzięta za nagłówek.
    const t = text(['Podsumowanie', 'Student ze stażem, a także', 'wykształcenie.', 'Doświadczenie zawodowe', 'Staż', 'Wykształcenie', 'UE Kraków', 'x'.repeat(300)].join('\n'));
    const r = checkFormat(t, 1, order, profile);
    expect(r.checks.find((c) => c.name === 'Kolejność czytania')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'Standardowe nagłówki sekcji')?.ok).toBe(true);
  });

  it('krótka nazwa firmy w nazwie pliku', () => {
    expect(shortCompany('CLOUDFIDE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')).toBe('CLOUDFIDE');
    expect(shortCompany('Alfasigma Polska Sp. z o.o.')).toBe('Alfasigma Polska');
    expect(shortCompany('Przykład S.A.')).toBe('Przykład');
    expect(shortCompany('Mimosa')).toBe('Mimosa');
  });

  it('sam rok przy projekcie nie psuje spójności dat, mieszanie . i / tak', () => {
    const withYear = { ...base, projects: [{ sourceId: 'p', name: 'P', role: '', dates: '2025', technologies: [], link: '', bullets: [] }] };
    expect(checkFormat(text('x'.repeat(400)), 1, withYear, profile).checks.find((c) => c.name === 'Spójny format dat')?.ok).toBe(true);
    const mixed = { ...base, projects: [{ sourceId: 'p', name: 'P', role: '', dates: '03/2025 – 05/2025', technologies: [], link: '', bullets: [] }] };
    expect(checkFormat(text('x'.repeat(400)), 1, mixed, profile).checks.find((c) => c.name === 'Spójny format dat')?.ok).toBe(false);
  });
});

describe('sugestie i schemat', () => {
  it('odrzucona sugestia wraca do wersji bezpiecznej, zaakceptowana staje się faktem', () => {
    const rejected = applyDecisions({ ...cv, decisions: { b2: 'rejected' } });
    expect(rejected.experience[0].bullets[1].text).toBe('Rozwijanie zasięgu profilu');
    const accepted = applyDecisions({ ...cv, decisions: { b2: 'accepted' } });
    expect(accepted.experience[0].bullets[1]).toMatchObject({ status: 'fact', text: 'Zwiększenie zasięgu profilu o ok. 30%' });
  });

  it('schemat dla modelu jest w trybie strict', () => {
    const s: any = toStrictJsonSchema(CvContentSchema);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(Object.keys(s.properties));
    expect(s.properties.experience.items.properties.bullets.items.additionalProperties).toBe(false);
  });
});
