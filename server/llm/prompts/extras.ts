import { CoverLetterSchema, InterviewPrepSchema, type CoverLetter, type InterviewPrep, type JobPosting, type Profile } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { forUser, json, postingForPrompt, profileForPrompt, today } from './common';

const INTERVIEW_SYSTEM = (lang: 'pl' | 'en') => `Jesteś doświadczonym rekruterem i coachem kariery. Przygotowujesz kandydata (student/junior) do rozmowy kwalifikacyjnej na konkretne stanowisko.
Język: opisy, wyjaśnienia i wskazówki ${forUser()}; "suggestedAnswer" w języku, w którym prawdopodobnie odbędzie się rozmowa (${lang === 'pl' ? 'polski' : 'angielski'}).
Zasady:
- 12–16 pytań, które realnie mogą paść: techniczne/merytoryczne z wymagań ogłoszenia, behawioralne, o doświadczenie i projekty z CV, motywacja i firma, trudne (braki, luki, "dlaczego nie masz X").
- "suggestedAnswer": gotowa do przećwiczenia odpowiedź OPARTA WYŁĄCZNIE na faktach z profilu kandydata, przy behawioralnych w schemacie STAR (Sytuacja, Zadanie, Działanie, Rezultat). Jeśli kandydat nie ma doświadczenia, pokaż uczciwą odpowiedź (czego się uczy, co zrobi). Nie wymyślaj faktów.
- "whyAsked": co rekruter chce sprawdzić. "tips": krótka wskazówka.
- Odpowiedzi są w pierwszej osobie: jeśli w profilu kandydat pisze formami z rodzajem ("zrobiłem"/"zrobiłam"), użyj tego samego rodzaju; jeśli nie wiadomo, buduj zdania bez form zależnych od płci. Nie zgaduj płci z imienia. Wskazówki pisz neutralnie.
- "questionsToAsk": 4–6 dobrych pytań kandydata do pracodawcy.
- "topicsToReview": tematy do powtórki przed rozmową (z wymagań, których kandydat nie zna dobrze) z konkretnym sposobem przygotowania.
- "weakSpots": słabe punkty kandydata względem ogłoszenia i jak o nich mówić.
Dzisiejsza data: ${today()}.`;

export async function interviewPrep(profile: Profile, posting: JobPosting, cvText: string, ctx: LlmContext): Promise<InterviewPrep> {
  const lang = posting.language === 'en' || posting.cvLanguageRequired === 'en' ? 'en' : 'pl';
  return callJson({
    schema: InterviewPrepSchema,
    schemaName: 'interview_prep',
    tier: 'main',
    temperature: 0.5,
    maxTokens: 12_000,
    system: INTERVIEW_SYSTEM(lang),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nWYSŁANE CV:\n"""\n${cvText}\n"""`,
    ctx,
  });
}

const LETTER_SYSTEM = (lang: 'pl' | 'en') => `Piszesz list motywacyjny kandydata (student/junior) do konkretnego ogłoszenia. Język: ${lang === 'pl' ? 'polski' : 'angielski'}.
Zasady:
- 3–4 akapity, łącznie 220–330 słów. Zwięźle, konkretnie, bez lania wody i frazesów ("jestem osobą kreatywną i komunikatywną").
- Akapit 1: na jakie stanowisko aplikuje i jedno zdanie, dlaczego właśnie ta firma/rola (na podstawie ogłoszenia).
- Akapit 2–3: 2–3 najmocniejsze dopasowania do wymagań, każde z konkretnym dowodem z profilu (projekt, praca, kurs, efekt).
- Ostatni akapit: co wniesie, gotowość do rozmowy, podziękowanie.
- Opieraj się WYŁĄCZNIE na faktach z profilu i extraFacts (has=true). Nie wymyślaj liczb ani doświadczeń.
- Nie dopisuj szczegółów, których nie ma w profilu: jak często kandydat czegoś używa ("codziennie"), do czego, z jakim efektem, jakie ma nawyki czy cechy. Nie przypisuj mu wymagań z ogłoszenia, których profil nie potwierdza. Lepiej krótszy list niż jedno zmyślone zdanie.
- Po polsku: jeśli w profilu kandydat pisze formami z rodzajem, zachowaj ten sam rodzaj; jeśli nie wiadomo, buduj zdania tak, by ominąć formy z rodzajem. Nie zgaduj płci z imienia.
- "greeting": np. "Szanowni Państwo," / "Dear Hiring Manager,"; "closing": np. "Z wyrazami szacunku" / "Kind regards".`;

export async function coverLetter(profile: Profile, posting: JobPosting, lang: 'pl' | 'en', ctx: LlmContext): Promise<CoverLetter> {
  return callJson({
    schema: CoverLetterSchema,
    schemaName: 'cover_letter',
    tier: 'main',
    temperature: 0.5,
    maxTokens: 4000,
    system: LETTER_SYSTEM(lang),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}`,
    ctx,
  });
}
