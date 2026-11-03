import { CvContentSchema, type CvContent, type JobPosting, type Profile, type AtsReport } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { json, postingForPrompt, profileForPrompt, today, writingRules, forUser } from './common';

const SYSTEM = (lang: 'pl' | 'en') => `Jesteś doświadczonym rekruterem i ekspertem od CV przechodzących przez systemy ATS oraz automatyczną ocenę AI. Piszesz CV kandydata (student/junior) dopasowane do konkretnego ogłoszenia.

JĘZYK CV: ${lang === 'pl' ? 'polski' : 'angielski'}. Całą treść pisz w tym języku (nazwy własne, technologie i narzędzia zostaw w oryginale). Pole "notes" zawsze ${forUser()}.
${writingRules()}
STRUKTURA:
- "headline": tytuł stanowiska z ogłoszenia (dosłownie) albo jego bliski odpowiednik zgodny z poziomem kandydata.
- "summary": 2–4 zdania dopasowane do ogłoszenia: kim jest kandydat (np. student kierunku X), 3–4 najważniejsze dopasowane umiejętności, jeden konkretny dowód (projekt/osiągnięcie), co wnosi na tym stanowisku. Bez "Ja", bez frazesów. Też obiekt z statusem fact/suggested.
- "sectionOrder": kolejność sekcji od najważniejszej dla TEGO ogłoszenia. Dla studenta/juniora z małym doświadczeniem zwykle: summary, projects lub experience (co jest trafniejsze), education, skills, certificates, languages, interests. Pomiń sekcje, które byłyby puste.
- "experience" i "projects": wybierz pozycje trafne dla ogłoszenia; mniej trafne skróć do 1 punktu albo pomiń, jeśli brakuje miejsca. "dates" w formacie ${lang === 'pl' ? '"MM.RRRR – MM.RRRR" albo "MM.RRRR – obecnie"' : '"MM/YYYY – MM/YYYY" albo "MM/YYYY – present"'}. "sourceId" = id pozycji z profilu.
- "skills": 2–4 grupy z nazwami w języku CV (np. ${lang === 'pl' ? '"Narzędzia", "Umiejętności techniczne", "Kompetencje"' : '"Tools", "Technical skills", "Soft skills"'}). TYLKO umiejętności z profilu lub z extraFacts has=true; najpierw te z ogłoszenia; łącznie maks. ~15 pozycji. Każda pozycja to krótka nazwa (1–4 słowa), bez nawiasów z wyjaśnieniami - dowody umiejętności należą do punktów doświadczenia, nie do listy.
- "education": szczegóły tylko trafne (kierunek, specjalizacja, ważne przedmioty/projekty, średnia jeśli wysoka).
- "certificates", "languages": z profilu; w "languages" poziom w skali CEFR, jeśli znany.
- "interests": maks. 3 krótkie pozycje z profilu, tylko jeśli pomagają (inaczej pusta lista).
- Objętość: cel to JEDNA strona A4 (ok. 350–480 słów łącznie). Lepiej mniej i trafniej.
- "id" każdego obiektu tekstu: dowolny unikalny (np. s1, e1b1).
- Klauzulę RODO i zdjęcie program dodaje do CV sam, według ogłoszenia: nie wpisuj ich do treści i nie pisz o nich w "notes".
- "notes": 2–4 zdania ${forUser()} dla kandydata: co podkreślono pod to ogłoszenie i jakich wymagań brakuje (żeby mógł się douczyć lub uzupełnić profil).
Dzisiejsza data: ${today()}.`;

export async function generateCv(
  profile: Profile,
  posting: JobPosting,
  lang: 'pl' | 'en',
  ctx: LlmContext,
): Promise<CvContent> {
  return callJson({
    schema: CvContentSchema,
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.4,
    maxTokens: 10_000,
    system: SYSTEM(lang),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nNapisz CV (language="${lang}").`,
    ctx,
  });
}

const IMPROVE_EXTRA = `
POPRAWA NA PODSTAWIE RAPORTU:
Dostajesz obecną wersję CV i raport z oceny (brakujące słowa kluczowe, problemy z formatem, uwagi AI-rekrutera z poprawkami).
- Wprowadź poprawki z raportu, które NIE wymagają nowych informacji od kandydata (needsUserInput=false).
- Brakujące słowa kluczowe dodaj tylko wtedy, gdy profil lub extraFacts (has=true) potwierdza, że kandydat to zna. W przeciwnym razie pomiń i wymień je w "notes".
- Pozycje obecnego CV ze statusem "fact" zostały już zaakceptowane przez kandydata - zachowaj ich sens. Pozycje "suggested" możesz poprawić.
- CV MUSI nadal zmieścić się na jednej stronie (łącznie maks. ~480 słów). Nie wydłużaj go: jeśli coś dopisujesz, skróć albo usuń coś mniej trafnego. Jeśli raport wskazuje 2 strony - skróć.
- Zachowaj język i strukturę. Zwróć CAŁE CV.`;

export async function improveCv(
  profile: Profile,
  posting: JobPosting,
  current: CvContent,
  report: AtsReport,
  ctx: LlmContext,
): Promise<CvContent> {
  const reportForPrompt = {
    missingKeywords: report.keywords.missing,
    stuffedKeywords: report.keywords.stuffing,
    failedFormatChecks: report.format.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`),
    recruiter: report.ai?.review ?? null,
  };
  return callJson({
    schema: CvContentSchema,
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 10_000,
    system: SYSTEM(current.language) + IMPROVE_EXTRA,
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE CV:\n${json(current)}\n\nRAPORT:\n${json(reportForPrompt)}\n\nZwróć poprawione CV.`,
    ctx,
  });
}
