import {
  CourseAdviceSchema,
  CoverLetterSchema,
  InterviewPrepSchema,
  type CourseAdvice,
  type CoverLetter,
  type InterviewPrep,
  type JobPosting,
  type Profile,
} from '../../../shared/schemas';
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

const COURSES_SYSTEM = () => `Jesteś doradcą kariery na polskim rynku pracy. Na podstawie ogłoszenia i profilu kandydata (student/junior) proponujesz kursy i certyfikaty, które najbardziej zwiększą jego szanse na TO stanowisko.
Zasady:
- 4-8 propozycji. Najpierw te, które pokrywają wymagania obowiązkowe, których profil nie potwierdza, potem mile widziane. W "covers" podaj brzmienie tych wymagań z ogłoszenia.
- Pomiń to, co kandydat już ma: certyfikaty i kursy z profilu, umiejętności potwierdzone w doświadczeniu, projektach albo w "extraFacts" (has=true).
- Tylko prawdziwe, znane kursy i certyfikaty z oficjalną nazwą i wydawcą (producent technologii, organizacja certyfikująca, uczelnia, platforma kursowa). Gdy nie znasz pewnej nazwy, opisz rodzaj kursu (np. "Kurs SQL dla początkujących") i w "provider" napisz, gdzie go szukać. Nie wymyślaj nazw.
- Nie podawaj linków ani cen (program sam dołącza wyszukiwanie). "cost": bezpłatny, płatny albo częściowo płatny (np. darmowy kurs i płatny egzamin).
- "time": realistyczny czas nauki, np. "ok. 10 godzin" albo "2-4 tygodnie po godzinie dziennie".
- "importance": must, gdy pokrywa wymaganie obowiązkowe, inaczej nice.
- "why" ${forUser()}, 1-2 zdania: co to da w tej rekrutacji (np. pokrywa wymaganie X, ATS szuka nazwy certyfikatu).
- "overview" ${forUser()}: 2-3 zdania, od czego zacząć, gdy jest mało czasu.
- "alreadyCovered": wymagania z ogłoszenia, których nie trzeba uzupełniać kursem, bo profil je potwierdza (krótko, ${forUser()}).
- Nazwy kursów i certyfikatów w oryginalnym brzmieniu, pozostałe pola ${forUser()}.
Dzisiejsza data: ${today()}.`;

/** `missing`: słowa kluczowe ogłoszenia, których brakuje w CV według ostatniej oceny (pusta lista, gdy oceny nie ma). */
export async function courseAdvice(profile: Profile, posting: JobPosting, missing: string[], ctx: LlmContext): Promise<CourseAdvice> {
  return callJson({
    schema: CourseAdviceSchema,
    schemaName: 'course_advice',
    tier: 'main',
    temperature: 0.4,
    maxTokens: 5000,
    system: COURSES_SYSTEM(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nBRAKUJĄCE W CV SŁOWA KLUCZOWE (z oceny ATS):\n${json(missing)}`,
    ctx,
  });
}
