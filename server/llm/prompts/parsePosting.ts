import { JobPostingSchema, type JobPosting, type Keyword } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { cleanTail, plainDashes } from '../strings';
import { forUser, today } from './common';

const SYSTEM = () => `Jesteś ekspertem rekrutacji i systemów ATS na polskim rynku pracy. Analizujesz ogłoszenie o pracę i zamieniasz je na strukturę.
Zasady:
- Opieraj się wyłącznie na tekście ogłoszenia. Pomijaj elementy strony niezwiązane z ofertą (menu, inne oferty, stopki portalu).
- "language" = język, w którym napisano ogłoszenie. "cvLanguageRequired": "en", jeśli ogłoszenie prosi o CV po angielsku lub jest w całości po angielsku; "pl", jeśli prosi o CV po polsku; inaczej "any".
- "companyIsInternational": true, jeśli rekrutuje firma zagraniczna lub zespół pracuje po angielsku.
- "requirementsMust": wymagania obowiązkowe; "requirementsNice": mile widziane (np. "mile widziane", "nice to have", "dodatkowym atutem będzie").
- "keywords": 12–25 słów kluczowych, których szukałby system ATS: umiejętności twarde, narzędzia, technologie, metodyki, certyfikaty, języki, wymagane wykształcenie, kluczowe kompetencje miękkie i sam tytuł stanowiska. "term" w dosłownym brzmieniu z ogłoszenia, ale KRÓTKO: 1–4 słowa, tak jak wpisałby je rekruter w wyszukiwarkę ATS (np. "analiza konkurencji", nie "analiza sprzedaży produktu i konkurencji"). Wyliczenia rozbij na osobne słowa kluczowe ("marketing, socjologia" → dwa wpisy). Bez całych zdań i bez opisów obowiązków. W "synonyms" podaj warianty: skróty, pełne nazwy, wersje polskie/angielskie, popularne odmiany (np. "MS Excel" → ["Excel", "Microsoft Excel"]). importance: "must" dla wymagań obowiązkowych, "nice" dla mile widzianych.
- Język obcy jako słowo kluczowe: "term" to sama nazwa języka ("angielski", "English"), BEZ poziomu. Poziom ("B2", "C1", "komunikatywny") zostaje w treści wymagania w "requirementsMust"/"requirementsNice", nie w "term" ani w "synonyms".
- "rodoClause": jeśli ogłoszenie zawiera treść klauzuli zgody na przetwarzanie danych osobowych, którą kandydat ma umieścić w CV, przepisz ją DOSŁOWNIE. Informacje o administratorze danych (obowiązek informacyjny firmy) to nie jest klauzula do CV - wtedy zostaw pusty string.
- "mentionsFutureRecruitment": true, jeśli ogłoszenie prosi o zgodę na przyszłe rekrutacje.
- "photoPreference": "unwanted", jeśli ogłoszenie prosi o CV bez zdjęcia; "wanted", jeśli prosi o zdjęcie; inaczej "unspecified".
- "summary": 2–3 zdania ${forUser()} o tym, czego firma szuka. "applicationNotes" też ${forUser()}.
Dzisiejsza data: ${today()}.`;

export async function parsePosting(text: string, url: string, ctx: LlmContext): Promise<JobPosting> {
  const posting = await callJson({
    schema: JobPostingSchema,
    schemaName: 'job_posting',
    verbatim: true,
    tier: 'fast',
    temperature: 0,
    maxTokens: 6000,
    system: SYSTEM(),
    user: `${url ? `Link: ${url}\n\n` : ''}Treść ogłoszenia:\n"""\n${text}\n"""`,
    ctx,
  });
  // Ogłoszenie przepisujemy dosłownie (np. klauzula RODO), ale podsumowanie pisze AI - bez długich myślników.
  return {
    ...posting,
    keywords: withoutLevels(posting.keywords),
    summary: cleanTail(plainDashes(posting.summary)),
    applicationNotes: cleanTail(plainDashes(posting.applicationNotes)),
  };
}

// Poziom języka przy nazwie: "angielski B2", "English (min. C1)", "B2 English", "biegły angielski", "angielski - komunikatywny".
const CEFR = String.raw`[ABC][12]\+?(?:\s*[-–/]\s*[ABC][12]\+?)?`;
const WORDS = String.raw`(?:bardzo\s+)?dobr\p{L}*|biegł\p{L}*|płynn\p{L}*|zaawansowan\p{L}*|komunikatywn\p{L}*|podstawow\p{L}*|średni\p{L}*|fluent|advanced|(?:upper[-\s])?intermediate|basic|(?:very\s+)?good|proficient|conversational`;
const LEVEL_END = new RegExp(
  String.raw`\s*[-–:,(]?\s*(?:(?:min\.?|minimum|co\s+najmniej)\s*)?(?:(?:na\s+)?poziom(?:ie)?\s+|level\s+)?(?<![\p{L}\p{N}])(?:${CEFR}|${WORDS})\s*\)?$`,
  'iu',
);
const LEVEL_START = new RegExp(String.raw`^(?:${CEFR}|${WORDS})\s+(?=\p{L})`, 'iu');

/** Nazwa języka bez poziomu - z poziomem słowo kluczowe nie pasuje do "Angielski - C1" w CV. */
export function withoutLevel(term: string): string {
  const t = term.replace(LEVEL_END, '').replace(LEVEL_START, '').trim();
  return t || term.trim();
}

/** Słowa kluczowe języków bez poziomów (prompt o to prosi, ale model nie zawsze słucha). */
export function withoutLevels(keywords: Keyword[]): Keyword[] {
  return keywords.map((k) => {
    if (k.category !== 'język') return k;
    const term = withoutLevel(k.term);
    // Synonim, który po zdjęciu poziomu powtarza nazwę ("English B2" przy "English"), odpada.
    const seen = new Set([term.toLowerCase()]);
    const synonyms: string[] = [];
    for (const s of k.synonyms.map(withoutLevel)) {
      if (seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      synonyms.push(s);
    }
    return { ...k, term, synonyms };
  });
}
