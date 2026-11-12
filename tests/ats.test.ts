import { describe, expect, it } from 'vitest';
import {
  BREAK,
  countPhrase,
  findKeyword,
  keywordWeight,
  normalize,
  scoreKeywords,
  tokenize,
  tokenMatches,
  type MatchLang,
} from '../server/ats/keywords';
import { decideLanguage, decidePhoto, decideRodo, RODO_STANDARD, RODO_STANDARD_EN } from '../server/cv/rodo';
import { cleanHeadline, renderCvHtml, withoutPending } from '../server/cv/render';
import { applyDecisions } from '../server/llm/prompts/common';
import { toStrictJsonSchema } from '../server/llm/openrouter';
import { CvContentSchema, type AiReview, type AtsReport, type CvContent, type Keyword } from '../shared/schemas';
import { checkFormat, FORMAT_MAX, withoutClause } from '../server/ats/formatChecks';
import { aiScore, buildReport, honestReport } from '../server/ats/score';
import { pendingSuggestions, shortCompany } from '../server/services';
import { blankContent, cv, posting, profile, review } from './fixtures';

const fact = (text: string, id = 'x') => ({ id, text, status: 'fact' as const, reason: '', fallbackText: '', sourceIds: [] });
const content = (patch: Partial<CvContent>): CvContent => ({ ...blankContent, ...patch });
const job = (bullets: string[], role = 'Stażysta') => ({ sourceId: 'e', role, company: '', location: '', dates: '', bullets: bullets.map((b, i) => fact(b, `b${i}`)) });
const withBullets = (...bullets: string[]) => content({ experience: [job(bullets)] });
const withSkills = (...items: string[]) => content({ skills: [{ category: 'Narzędzia', items }] });
const kw = (term: string, importance: Keyword['importance'] = 'must', category: Keyword['category'] = 'umiejętność', synonyms: string[] = []): Keyword => ({
  term,
  synonyms,
  importance,
  category,
});

describe('normalizacja i tokeny', () => {
  it('usuwa polskie znaki i zostawia nazwy techniczne', () => {
    expect(normalize('Zażółć Gęślą JAŹŃ, C++ i Node.js')).toBe('zazolc gesla jazn c++ i node.js');
  });

  it.each([
    ['Google Docs, Ads Manager', ['google', 'docs', BREAK, 'ads', 'manager']],
    ['Excel; Word | PowerPoint', ['excel', BREAK, 'word', BREAK, 'powerpoint']],
    ['Power BI (raporty)', ['power', 'bi', BREAK, 'raporty']],
    ['Excel • Word\nCanva', ['excel', BREAK, 'word', BREAK, 'canva']],
    ['Narzędzia: Excel', ['narzedzia', BREAK, 'excel']],
    ['Znam Excel. Ads Manager', ['znam', 'excel', BREAK, 'ads', 'manager']],
    ['Google – Ads', ['google', BREAK, 'ads']],
    ['np. excel, ds. marketingu', ['np', 'excel', BREAK, 'ds', 'marketingu']],
    ["Managed the client's accounts", ['managed', 'the', 'clients', 'accounts']],
    ['CI/CD, Node.js, C#', ['ci/cd', BREAK, 'node.js', BREAK, 'c#']],
  ])('tokenize(%j)', (text, tokens) => {
    expect(tokenize(text)).toEqual(tokens);
  });
});

describe('dopasowanie słów', () => {
  const m = (a: string, b: string, lang: MatchLang) => tokenMatches(normalize(a), normalize(b), lang) && tokenMatches(normalize(b), normalize(a), lang);

  // [słowo z CV, słowo z ogłoszenia, język CV]
  it.each<[string, string, MatchLang]>([
    ['marketingu', 'marketing', 'pl'],
    ['analizy', 'analiza', 'pl'],
    ['sprzedaży', 'sprzedaż', 'pl'],
    ['zarządzania', 'zarządzanie', 'pl'],
    ['marketingu', 'marketingowy', 'pl'],
    // fleksja z krótkim rdzeniem
    ['pracy', 'praca', 'pl'],
    ['umowy', 'umowa', 'pl'],
    ['bazy', 'baza', 'pl'],
    ['bazami', 'bazy', 'pl'],
    ['baz', 'bazy', 'pl'],
    ['danych', 'dane', 'pl'],
    ['roli', 'rola', 'pl'],
    ['zespołowej', 'zespołowa', 'pl'],
    ['zespołowej', 'zespole', 'pl'],
    ['kampanii', 'kampania', 'pl'],
    ['mediach', 'media', 'pl'],
    ['Krakowie', 'Kraków', 'pl'],
    ['angielskim', 'angielski', 'pl'],
    // słowotwórstwo: -owanie, -ować, -acja, -acyjny, -ość
    ['raportowanie', 'raport', 'pl'],
    ['analizowanie', 'analiza', 'pl'],
    ['testowanie', 'testy', 'pl'],
    ['negocjowanie', 'negocjacje', 'pl'],
    ['dokumentów', 'dokumentacja', 'pl'],
    ['raportowałam', 'raport', 'pl'],
    ['analizuje', 'analiza', 'pl'],
    ['komunikacyjne', 'komunikacja', 'pl'],
    ['komunikatywny', 'komunikatywność', 'pl'],
    // oboczności
    ['rynku', 'rynek', 'pl'],
    ['analityce', 'analityka', 'pl'],
    ['obsłudze', 'obsługa', 'pl'],
    ['metodzie', 'metoda', 'pl'],
    ['kulturze', 'kultura', 'pl'],
    // nazwy angielskie w polskim CV
    ['Excela', 'Excel', 'pl'],
    ['Excelu', 'Excel', 'pl'],
    ['APIs', 'API', 'pl'],
    ['Node', 'Node.js', 'pl'],
    ['NodeJS', 'Node.js', 'pl'],
    // angielski: liczba mnoga i dopełniacz
    ['offices', 'office', 'en'],
    ['processes', 'process', 'en'],
    ['companies', 'company', 'en'],
    ['managers', 'manager', 'en'],
    ['React', 'React.js', 'en'],
  ])('%s = %s (%s)', (a, b, lang) => {
    expect(m(a, b, lang)).toBe(true);
  });

  it.each<[string, string, MatchLang]>([
    ['komunikacja', 'komunikatywność', 'pl'],
    ['dziennie', 'dziennikarstwo', 'pl'],
    ['sql', 'sqlite', 'pl'],
    ['ga4', 'ga3', 'pl'],
    ['C', 'C++', 'pl'],
    ['C', 'C#', 'pl'],
    // wspólny początek, ale inne słowo
    ['excellent', 'Excel', 'pl'],
    ['officer', 'office', 'pl'],
    ['reaction', 'React', 'pl'],
    ['accessible', 'access', 'pl'],
    ['market', 'marketing', 'pl'],
    ['kontroling', 'kontrola', 'pl'],
    ['program', 'programista', 'pl'],
    ['pracownik', 'praca', 'pl'],
    ['analityk', 'analiza', 'pl'],
    ['projektant', 'projekt', 'pl'],
    ['bazar', 'baza', 'pl'],
    ['rolnictwo', 'rola', 'pl'],
    ['excellent', 'Excel', 'en'],
    ['officer', 'office', 'en'],
    ['reaction', 'React', 'en'],
    ['accessible', 'access', 'en'],
    ['market', 'marketing', 'en'],
    // po angielsku bez polskiej fleksji
    ['Excela', 'Excel', 'en'],
    ['rola', 'role', 'en'],
    ['date', 'data', 'en'],
    ['plane', 'plan', 'en'],
    ['risky', 'risk', 'en'],
  ])('%s ≠ %s (%s)', (a, b, lang) => {
    expect(m(a, b, lang)).toBe(false);
  });
});

describe('frazy', () => {
  // [tekst CV, fraza z ogłoszenia, ile razy]
  it.each<[string, string, number]>([
    ['Doświadczenie w prowadzeniu kampanii Google Ads oraz kampanii w mediach społecznościowych', 'Google Ads', 1],
    ['Doświadczenie w prowadzeniu kampanii Google Ads oraz kampanii w mediach społecznościowych', 'media społecznościowe', 1],
    ['Doświadczenie w prowadzeniu kampanii Google Ads oraz kampanii w mediach społecznościowych', 'kampania', 2],
    // separatory list i zdań
    ['Google Docs, Ads Manager', 'Google Ads', 0],
    ['Power Automate, BI', 'Power BI', 0],
    ['Google\nAds', 'Google Ads', 0],
    ['Google (Analytics)', 'Google Analytics', 0],
    ['Znam Google. Ads Manager też', 'Google Ads', 0],
    ['Google – Ads', 'Google Ads', 0],
    ['Google Ads, Meta Ads', 'Google Ads', 1],
    ['Power BI (raporty)', 'Power BI', 1],
    ['Excel • Word', 'Excel', 1],
    // przerwa tylko na słowo pomocnicze
    ['zarządzanie dużymi projektami', 'zarządzanie projektami', 0],
    ['praca w zespole', 'praca zespołowa', 1],
    ['pracy zespołowej', 'praca zespołowa', 1],
    ['pracy zespołowej', 'praca w zespole', 1],
    ['baz danych', 'bazy danych', 1],
    ['znajomość języka angielskiego', 'język angielski', 1],
    // fraza z nawiasem: obie części muszą wystąpić
    ['Google Analytics 4 (GA4)', 'Google Analytics (GA4)', 1],
    ['Google Analytics 4', 'Google Analytics (GA4)', 0],
  ])('%j ~ %j', (text, phrase, n) => {
    expect(countPhrase(tokenize(text), phrase)).toBe(n);
  });

  it('dopełniacz po angielsku', () => {
    expect(countPhrase(tokenize("Managed the client's accounts"), 'client accounts', 'en')).toBe(1);
  });

  // [tekst, fraza, ile razy z `gap`]; bez `gap` każda z tych fraz to 0 albo tyle samo
  it.each<[string, string, number]>([
    ['zajmuję się wdrażaniem rozwiązań AI oraz automatyzacją procesów', 'wdrażanie AI', 1],
    ['zarządzanie dużymi projektami', 'zarządzanie projektami', 1],
    ['Led the data quality analysis', 'data analysis', 1],
    // tylko jedno słowo przerwy
    ['wdrażanie nowych rozwiązań AI', 'wdrażanie AI', 0],
    // granic list i zdań nie przeskakuje
    ['wdrażanie, AI', 'wdrażanie AI', 0],
    ['Wdrażanie procesów. AI w pracy', 'wdrażanie AI', 0],
    // przeczenia nie przeskakuje
    ['wdrażanie bez AI', 'wdrażanie AI', 0],
    ['wdrażanie nie AI', 'wdrażanie AI', 0],
    // słowo pomocnicze działa jak bez `gap`
    ['praca w zespole', 'praca zespołowa', 1],
  ])('z przerwą: %j ~ %j', (text, phrase, n) => {
    expect(countPhrase(tokenize(text), phrase, 'pl', true)).toBe(n);
  });

  it('bez `gap` jedno słowo w środku frazy dalej ją przerywa (sprawdzanie profilu)', () => {
    expect(countPhrase(tokenize('zajmuję się wdrażaniem rozwiązań AI'), 'wdrażanie AI')).toBe(0);
    expect(countPhrase(tokenize('zajmuję się wdrażaniem AI'), 'wdrażanie AI')).toBe(1);
  });
});

describe('wynik słów kluczowych', () => {
  it('liczy z treści CV: pełne punkty za opis, połowa za samą listę umiejętności', () => {
    const r = scoreKeywords(applyDecisions(cv), posting.keywords);
    // must: GA (3, podsumowanie) + social (3, punkt doświadczenia), nice: Excel (0,5 - tylko umiejętności), Google Ads brak
    expect(r.score).toBe(Math.round((6.5 / 8) * 40));
    expect(r.missing.map((m) => m.term)).toEqual(['Google Ads']);
    expect(r.matched.find((m) => m.term === 'Excel')).toMatchObject({ where: ['skills'], credit: 0.5 });
    expect(r.matched.find((m) => m.term === 'social media')).toMatchObject({ where: ['summary', 'experience'], credit: 1 });
  });

  it('sama lista słów to połowa punktów, te same słowa w opisie to komplet', () => {
    const words = ['Google Analytics', 'social media', 'Excel', 'Google Ads'];
    expect(scoreKeywords(withSkills(...words), posting.keywords).score).toBe(20);
    expect(scoreKeywords(withBullets(`Kampanie w ${words.join(', ')}`), posting.keywords).score).toBe(40);
  });

  it.each<[string, Partial<CvContent>, number]>([
    ['nagłówek', { headline: 'Specjalista Google Ads' }, 0.5],
    ['technologie projektu', { projects: [{ sourceId: 'p', name: 'Sklep', role: '', dates: '', technologies: ['Google Ads'], link: '', bullets: [] }] }, 0.5],
    ['zainteresowania', { interests: ['Google Ads'] }, 0.5],
    ['podsumowanie', { summary: fact('Prowadzę kampanie Google Ads.') }, 1],
    ['punkt projektu', { projects: [{ sourceId: 'p', name: 'Sklep', role: '', dates: '', technologies: [], link: '', bullets: [fact('Kampania Google Ads')] }] }, 1],
    ['wykształcenie', { education: [{ sourceId: 'e', school: 'UEK', degree: 'Licencjat', field: 'Marketing', dates: '', details: 'Praca dyplomowa o Google Ads' }] }, 1],
    ['certyfikat', { certificates: [{ name: 'Google Ads Search', issuer: 'Google', date: '' }] }, 1],
  ])('%s: %s punktu', (_, patch, credit) => {
    const r = scoreKeywords(content(patch), [kw('Google Ads')]);
    expect(r.matched[0]?.credit).toBe(credit);
  });

  it('findKeyword działa na dowolnym tekście, np. z profilu', () => {
    const src = [{ where: 'experience' as const, credit: 1, bullet: true, text: 'Prowadziłam kampanie w Google Ads' }];
    expect(findKeyword(kw('Google Ads'), src, 'pl')).toMatchObject({ credit: 1, count: 1, where: ['experience'] });
    expect(findKeyword(kw('Meta Ads'), src, 'pl')).toBeNull();
  });

  it('fraza z jednym słowem w środku liczy się w CV, ale w profilu nadal nie', () => {
    const text = 'Jestem studentem i zajmuję się wdrażaniem rozwiązań AI oraz automatyzacją procesów.';
    const r = scoreKeywords(content({ summary: fact(text) }), [kw('wdrażanie AI', 'must', 'umiejętność', ['AI implementation'])]);
    expect(r.missing).toEqual([]);
    expect(r.matched[0]).toMatchObject({ term: 'wdrażanie AI', where: ['summary'], credit: 1 });
    const src = [{ where: 'summary' as const, credit: 1, bullet: false, text }];
    expect(findKeyword(kw('wdrażanie AI'), src, 'pl')).toBeNull();
  });

  it('karze upychanie słów', () => {
    const r = scoreKeywords(withBullets('Excel '.repeat(8)), [kw('Excel', 'must', 'narzędzie')]);
    expect(r.stuffing).toEqual(['Excel']);
    expect(r.score).toBeLessThan(40);
  });

  it('klauzula RODO nie daje słów kluczowych (PL i EN)', () => {
    const pl = buildReport({
      version: 1,
      pdfText: `Zofia Żółkiewska\n${RODO_STANDARD}`,
      pages: 1,
      cv: blankContent,
      clause: RODO_STANDARD,
      profile,
      posting: { ...posting, keywords: [kw('znajomość RODO'), kw('RODO'), kw('przetwarzanie danych osobowych'), kw('rekrutacja')] },
      review,
      aiError: '',
    });
    expect(pl.keywords.matched).toEqual([]);
    const en = buildReport({
      version: 1,
      pdfText: `Zofia Zolkiewska\n${RODO_STANDARD_EN}`,
      pages: 1,
      cv: { ...blankContent, language: 'en' },
      clause: RODO_STANDARD_EN,
      profile,
      posting: { ...posting, keywords: [kw('GDPR'), kw('personal data'), kw('recruitment')] },
      review,
      aiError: '',
    });
    expect(en.keywords.matched).toEqual([]);
  });
});

describe('kompetencje miękkie i wykształcenie', () => {
  const soft = kw('komunikatywność', 'must', 'kompetencja miękka');

  it.each<[Keyword, number]>([
    [soft, 1],
    [kw('praca zespołowa', 'must', 'umiejętność'), 1], // rozpoznana z listy mimo złej kategorii
    [kw('Excel', 'must', 'narzędzie'), 3],
    [kw('Excel', 'nice', 'narzędzie'), 1],
  ])('waga %j', (k, w) => {
    expect(keywordWeight(k)).toBe(w);
  });

  it('liczą się tylko z punktów doświadczenia lub projektu', () => {
    const declared = content({ summary: fact('Komunikatywna studentka.'), skills: [{ category: 'Miękkie', items: ['komunikatywność'] }] });
    expect(scoreKeywords(declared, [soft])).toMatchObject({ score: 0, matched: [{ credit: 0, where: ['summary', 'skills'] }] });
    const team = kw('praca w zespole', 'must', 'kompetencja miękka');
    expect(scoreKeywords(withBullets('Praca w zespole pięciu osób przy kampanii'), [team]).score).toBe(40);
    // obok twardej umiejętności: 3 z 4 punktów wagi
    expect(scoreKeywords({ ...declared, experience: [job(['Raporty w Excelu'])] }, [soft, kw('Excel')]).score).toBe(30);
  });

  it.each<[string, Keyword, Partial<CvContent>, boolean]>([
    ['licencjat', kw('wykształcenie wyższe', 'must', 'wykształcenie'), { education: [{ sourceId: 'e', school: 'UEK', degree: 'Licencjat', field: 'Marketing', dates: '', details: '' }] }, true],
    ['magister', kw('wyższe wykształcenie', 'must', 'wykształcenie'), { education: [{ sourceId: 'e', school: 'UW', degree: 'mgr', field: 'Ekonomia', dates: '', details: '' }] }, true],
    ['studia w trakcie', kw('wykształcenie wyższe', 'must', 'wykształcenie'), { education: [{ sourceId: 'e', school: 'AGH', degree: 'Studia I stopnia (w trakcie)', field: 'Informatyka', dates: '', details: '' }] }, true],
    ['BSc', kw("Bachelor's degree", 'must', 'wykształcenie'), { language: 'en', education: [{ sourceId: 'e', school: 'UCL', degree: 'BSc', field: 'Economics', dates: '', details: '' }] }, true],
    ['Master', kw('degree', 'must', 'wykształcenie'), { language: 'en', education: [{ sourceId: 'e', school: 'UCL', degree: 'Master of Science', field: 'Finance', dates: '', details: '' }] }, true],
    ['Scrum Master to nie stopień', kw('degree', 'must', 'wykształcenie'), { language: 'en', experience: [job([], 'Scrum Master')] }, false],
    ['liceum to nie studia', kw('wykształcenie wyższe', 'must', 'wykształcenie'), { education: [{ sourceId: 'e', school: 'II LO', degree: 'liceum', field: '', dates: '', details: '' }] }, false],
  ])('%s', (_, k, patch, found) => {
    expect(scoreKeywords(content(patch), [k]).matched.length).toBe(found ? 1 : 0);
  });
});

describe('ocena AI', () => {
  const crit = (pairs: [AiReview['criteria'][number]['key'], number][]): AiReview => ({
    ...review,
    criteria: pairs.map(([key, score]) => ({ key, score, comment: '' })),
  });
  const base = review.criteria.map((c) => [c.key, c.score] as [AiReview['criteria'][number]['key'], number]);

  it.each<[string, AiReview, number | null]>([
    ['komplet', review, 28],
    ['brak kryterium', crit(base.filter(([k]) => k !== 'achievements')), null],
    ['powtórzone kryterium: liczy się pierwsze', crit([...base, ['must_have_match', 10]]), 28],
    ['powtórzone kryterium na początku', crit([['must_have_match', 10], ...base]), 32],
    ['wynik spoza skali', crit(base.map(([k, s]) => [k, k === 'clarity' ? 15 : s])), 29],
  ])('%s', (_, r, score) => {
    expect(aiScore(r)).toBe(score);
  });

  const args = { version: 1, pdfText: 'x', pages: 1, cv: applyDecisions(cv), clause: '', profile, posting, aiError: '' };

  it('bez oceny AI wynik łączny jest pusty, a części zostają', () => {
    const r = buildReport({ ...args, review: null, aiError: 'brak klucza' });
    expect(r).toMatchObject({ total: null, ai: null, aiError: 'brak klucza' });
    expect(r.keywords.score).toBeGreaterThan(0);
    expect(r.format.max).toBe(FORMAT_MAX);
  });

  it('niepełna ocena AI nie daje wyniku łącznego', () => {
    const r = buildReport({ ...args, review: crit(base.slice(1)) });
    expect(r.total).toBeNull();
    expect(r.ai).toBeNull();
    expect(r.aiError).not.toBe('');
  });

  it('pełna ocena: suma części, kryteria bez powtórzeń', () => {
    const r = buildReport({ ...args, review: crit([...base, ['clarity', 0]]) });
    expect(r.total).toBe(r.keywords.score + r.format.score + 28);
    expect(r.ai?.review.criteria.map((c) => c.key)).toEqual(['must_have_match', 'achievements', 'summary_fit', 'clarity', 'red_flags']);
  });

  it('stary raport bez AI z wynikiem przeskalowanym do 100 jest pokazywany jako niepełny', () => {
    const old = { ...buildReport({ ...args, review: null }), total: 92 } as AtsReport;
    expect(honestReport(old)?.total).toBeNull();
    const ok = buildReport({ ...args, review });
    expect(honestReport(ok)).toBe(ok);
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
  const check = (r: ReturnType<typeof checkFormat>, name: string) => r.checks.find((c) => c.name === name)?.ok;

  it('nagłówek liczy się tylko jako osobna linia', () => {
    const order: typeof base = { ...base, sectionOrder: ['summary', 'experience', 'education'] };
    // "Wykształcenie" występuje w treści przed nagłówkiem "Doświadczenie zawodowe" - kolejność ma nadal przejść.
    // Zawinięta linia "wykształcenie." (z kropką) przed nagłówkiem też nie może być wzięta za nagłówek.
    const t = text(['Podsumowanie', 'Student ze stażem, a także', 'wykształcenie.', 'Doświadczenie zawodowe', 'Staż', 'Wykształcenie', 'UE Kraków', 'x'.repeat(300)].join('\n'));
    const r = checkFormat(t, 1, order, profile);
    expect(check(r, 'Kolejność czytania')).toBe(true);
    expect(check(r, 'Standardowe nagłówki sekcji')).toBe(true);
  });

  it('krótka nazwa firmy w nazwie pliku', () => {
    expect(shortCompany('PRZYKŁADOWA FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')).toBe('PRZYKŁADOWA FIRMA');
    expect(shortCompany('Alfasigma Polska Sp. z o.o.')).toBe('Alfasigma Polska');
    expect(shortCompany('Przykład S.A.')).toBe('Przykład');
    expect(shortCompany('Mimosa')).toBe('Mimosa');
  });

  it('sam rok przy projekcie nie psuje spójności dat, mieszanie . i / tak', () => {
    const withYear = { ...base, projects: [{ sourceId: 'p', name: 'P', role: '', dates: '2025', technologies: [], link: '', bullets: [] }] };
    expect(check(checkFormat(text('x'.repeat(400)), 1, withYear, profile), 'Spójny format dat')).toBe(true);
    const mixed = { ...base, projects: [{ sourceId: 'p', name: 'P', role: '', dates: '03/2025 – 05/2025', technologies: [], link: '', bullets: [] }] };
    expect(check(checkFormat(text('x'.repeat(400)), 1, mixed, profile), 'Spójny format dat')).toBe(false);
  });

  it('klauzula RODO sama nie zalicza czytelności ani polskich znaków', () => {
    const t = text(`Podsumowanie\nStudent\n${RODO_STANDARD}`);
    // Bez wycinania klauzula (376 znaków, polskie litery) zaliczała obie kontrole.
    const naive = checkFormat(t, 1, base, profile);
    expect(check(naive, 'Tekst da się odczytać')).toBe(true);
    const r = checkFormat(t, 1, base, profile, RODO_STANDARD);
    expect(check(r, 'Tekst da się odczytać')).toBe(false);
    expect(r.score).toBe(0);
    const ascii = checkFormat(text(`${'Marketing '.repeat(40)}\n${RODO_STANDARD}`).replace('Żółkiewska', 'Zolkiewska'), 1, base, profile, RODO_STANDARD);
    expect(check(ascii, 'Polskie znaki i kodowanie')).toBe(false);
  });

  it('wynik formatu to 20 minus kary za błędy', () => {
    const t = text(['Podsumowanie', 'Doświadczenie zawodowe', 'Wykształcenie', 'Umiejętności', 'Języki obce', 'Żółw '.repeat(80)].join('\n'));
    expect(checkFormat(t, 1, base, profile).score).toBe(FORMAT_MAX);
    const noEmail = checkFormat(t, 1, base, { ...profile, contact: { ...profile.contact, email: '' } });
    expect(noEmail.score).toBe(FORMAT_MAX - 4);
    // e-mail jest w profilu, ale nie w PDF: kara i opis, że nie odczytano (nie "Odczytany poprawnie")
    const lost = checkFormat(t.replace('zofia.zolkiewska@example.com', ''), 1, base, profile);
    expect(lost.score).toBe(FORMAT_MAX - 4);
    expect(lost.checks.find((c) => c.name === 'Adres e-mail')?.detail).toBe('Nie znaleziono w tekście odczytanym z PDF.');
    expect(checkFormat(t, 2, base, profile).score).toBe(FORMAT_MAX - 2); // połowa kary za długość
    expect(checkFormat(t, 3, base, profile).score).toBe(FORMAT_MAX - 4);
  });

  it('wycina klauzulę także zawiniętą w kilka linii', () => {
    const wrapped = `CV\n${RODO_STANDARD.replace('Parlamentu ', 'Parlamentu\n').replace(' osobowych i', '\nosobowych i')}`;
    expect(withoutClause(wrapped, RODO_STANDARD).trim()).toBe('CV');
    expect(withoutClause('CV bez klauzuli', RODO_STANDARD)).toBe('CV bez klauzuli');
  });
});

describe('render do oceny', () => {
  it("tryb 'ats' pokazuje oczekującą sugestię w wersji bezpiecznej", () => {
    const html = renderCvHtml(cv, profile, null, 'ats');
    expect(html).not.toContain('o ok. 30%');
    expect(html).toContain('Rozwijanie zasięgu profilu');
    expect(html).not.toContain('<mark');
    // zaakceptowana sugestia zostaje
    expect(renderCvHtml({ ...cv, decisions: { b2: 'accepted' } }, profile, null, 'ats')).toContain('o ok. 30%');
  });

  it("oczekująca sugestia bez wersji bezpiecznej znika w trybie 'ats' i w treści do oceny", () => {
    const noFallback = { ...cv, content: { ...cv.content, experience: [{ ...cv.content.experience[0], bullets: [cv.content.experience[0].bullets[0], { ...cv.content.experience[0].bullets[1], fallbackText: '' }] }] } };
    expect(renderCvHtml(noFallback, profile, null, 'ats')).not.toContain('Zwiększenie zasięgu');
    expect(applyDecisions(withoutPending(noFallback)).experience[0].bullets.map((b) => b.text)).toEqual(['Prowadzenie profilu firmy na Instagramie (social media)']);
    expect(applyDecisions(withoutPending(cv)).experience[0].bullets[1].text).toBe('Rozwijanie zasięgu profilu');
  });

  it('język dokumentu i etykieta technologii po angielsku', () => {
    const en = { ...cv, content: { ...cv.content, language: 'en' as const, projects: [{ sourceId: 'p', name: 'Shop', role: '', dates: '', technologies: ['React'], link: '', bullets: [] }] } };
    const html = renderCvHtml(en, profile, null, 'pdf');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Technologies: React');
    expect(renderCvHtml(cv, profile, null, 'pdf')).toContain('<html lang="pl">');
  });

  it.each([
    ['Specjalista ds. marketingu (K/M)', 'Specjalista ds. marketingu'],
    ['Młodszy księgowy (k/m/n)', 'Młodszy księgowy'],
    ['Junior Developer (m/f/d)', 'Junior Developer'],
    ['Analityk ( K / M )', 'Analityk'],
    ['Developer (f/m/x) - Kraków', 'Developer - Kraków'],
    ['Programista Java (B2B)', 'Programista Java (B2B)'],
    ['Specjalista (Marketing)', 'Specjalista (Marketing)'],
  ])('nagłówek %j', (raw, clean) => {
    expect(cleanHeadline(raw)).toBe(clean);
  });

  it('sugestia tytułu: w podglądzie na żółto, do oceny wersja bezpieczna, po decyzji tytuł z wybranej wersji', () => {
    const suggestion = { id: 'headline', text: 'Junior Java Developer (K/M)', status: 'suggested' as const, reason: 'Profil nie potwierdza: Java.', fallbackText: 'Junior Developer', sourceIds: [] };
    const withTitle = { ...cv, content: { ...cv.content, headline: 'Junior Developer', headlineSuggestion: suggestion } };
    expect(renderCvHtml(withTitle, profile, null, 'preview')).toContain('<div class="headline"><mark class="suggested" data-id="headline">Junior Java Developer</mark></div>');
    expect(renderCvHtml(withTitle, profile, null, 'ats')).toContain('<div class="headline">Junior Developer</div>');
    expect(pendingSuggestions(withTitle)).toBe(pendingSuggestions(cv) + 1);
    expect(applyDecisions(withoutPending(withTitle))).toMatchObject({ headline: 'Junior Developer', headlineSuggestion: undefined });
    expect(applyDecisions({ ...withTitle, decisions: { headline: 'accepted' } })).toMatchObject({ headline: 'Junior Java Developer (K/M)', headlineSuggestion: undefined });
    // Bez wersji bezpiecznej i po odrzuceniu: CV bez tytułu pod nazwiskiem.
    const noSafe = { ...withTitle, content: { ...withTitle.content, headline: '', headlineSuggestion: { ...suggestion, fallbackText: '' } } };
    expect(renderCvHtml(noSafe, profile, null, 'ats')).not.toContain('class="headline"');
  });

  it('nagłówek w PDF bez oznaczenia płci', () => {
    const html = renderCvHtml({ ...cv, content: { ...cv.content, headline: 'Specjalista ds. Marketingu (K/M)' } }, profile, null, 'pdf');
    expect(html).toContain('Specjalista ds. Marketingu</div>');
    expect(html).not.toContain('(K/M)');
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
    // Sugestię tytułu dopisuje program, nie model: schemat odpowiedzi jej nie ma.
    expect(s.properties.headlineSuggestion).toBeUndefined();
  });
});
