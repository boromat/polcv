import type { CvContent, JobPosting, Profile } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { json, postingForPrompt, profileForPrompt, today, writingRules, forUser, genderForms } from './common';
import { checkedCvSchema, checkedImproveSchema, factTexts, groundCv, numberedNames } from './cvChecks';
import { planForPrompt, type ImprovePlan } from './improvePlan';
import type { SyncRequest } from '../../cv/syncMerge';

const SYSTEM = (lang: 'pl' | 'en', forms: ReturnType<typeof genderForms>) => `Jesteś doświadczonym rekruterem i ekspertem od CV przechodzących przez systemy ATS oraz automatyczną ocenę AI. Piszesz CV kandydata (student/junior) dopasowane do konkretnego ogłoszenia.

JĘZYK CV: ${lang === 'pl' ? 'polski' : 'angielski'}. Całą treść pisz w tym języku (nazwy własne, technologie i narzędzia zostaw w oryginale). Pole "notes" zawsze ${forUser()}.
${writingRules()}
STRUKTURA:
- "headline": tytuł stanowiska z ogłoszenia (dosłownie) albo jego bliski odpowiednik zgodny z poziomem kandydata.
- "summary": 2-4 zdania dopasowane do ogłoszenia: kim jest kandydat (np. student kierunku X), 3-4 najważniejsze dopasowane umiejętności, jeden konkretny dowód (projekt/osiągnięcie), co wnosi na tym stanowisku. ${lang === 'pl' ? `Kandydat pisze CV o sobie, więc CAŁE podsumowanie, także pierwsze zdanie, jest w 1. osobie liczby pojedynczej, w czasie teraźniejszym i bez zaimka "ja": ${forms?.label === 'on' ? '"Jestem studentem kierunku X i pracuję…"' : forms?.label === 'ona' ? '"Jestem studentką kierunku X i pracuję…"' : '"Studiuję X na…", "Pracuję…"'}, "Znam Pythona i n8n…", "Tworzę agentów AI…". Nigdy w 3. osobie ("Zna", "Tworzy", "Posiada"), bez równoważników zdań i imiesłowów ("Student kierunku X, pracujący z…") i bez czasu przeszłego z rodzajem ("pracowałem", "zbudowałam").` : 'No "I" or other pronouns, e.g. "Computer science student building…", "Experienced in…".'} Bez frazesów. Też obiekt z statusem fact/suggested.
- "sectionOrder": kolejność sekcji od najważniejszej dla TEGO ogłoszenia. Dla studenta/juniora z małym doświadczeniem zwykle: summary, projects lub experience (co jest trafniejsze), education, skills, certificates, languages, interests. Pomiń sekcje, które byłyby puste.
- "experience" i "projects": wybierz pozycje trafne dla ogłoszenia; mniej trafne skróć do 1 punktu albo pomiń, jeśli brakuje miejsca. "dates" w formacie ${lang === 'pl' ? '"MM.RRRR - MM.RRRR" albo "MM.RRRR - obecnie"' : '"MM/YYYY - MM/YYYY" albo "MM/YYYY - present"'}. "sourceId" = id pozycji z profilu.
- "skills": 2-4 grupy z nazwami w języku CV (np. ${lang === 'pl' ? '"Narzędzia", "Umiejętności techniczne", "Kompetencje"' : '"Tools", "Technical skills", "Soft skills"'}). TYLKO umiejętności z profilu lub z extraFacts has=true; najpierw te z ogłoszenia; łącznie maks. ~15 pozycji. Każda pozycja to krótka nazwa (1-4 słowa), bez nawiasów z wyjaśnieniami - dowody umiejętności należą do punktów doświadczenia, nie do listy.
- "education": KAŻDA szkoła z profilu zostaje w CV (także szkoła średnia z tytułem zawodowym, np. technik informatyk). Szczegóły tylko trafne (kierunek, specjalizacja, ważne przedmioty/projekty, średnia jeśli wysoka); przy braku miejsca skróć szczegóły, nie usuwaj szkoły.
- "certificates", "languages": z profilu; w "languages" poziom w skali CEFR, jeśli znany.
- "interests": maks. 3 krótkie pozycje z profilu, tylko jeśli pomagają (inaczej pusta lista).
- Objętość: CV musi zmieścić się na JEDNEJ stronie A4 razem z nagłówkiem, zdjęciem i klauzulą RODO, czyli łącznie ok. 300-420 słów. Punkt to jedna linia (do ok. 120 znaków), maks. 3 punkty na pozycję. Lepiej mniej i trafniej.
- "id" każdego obiektu tekstu: dowolny unikalny (np. s1, e1b1).
- Klauzulę RODO i zdjęcie program dodaje do CV sam, według ogłoszenia: nie wpisuj ich do treści i nie pisz o nich w "notes".
- "notes": 2-4 zdania ${forUser()} dla kandydata: co podkreślono pod to ogłoszenie i jakich wymagań brakuje (żeby mógł się douczyć lub uzupełnić profil).
Dzisiejsza data: ${today()}.`;

/** `confirmed`: teksty, których liczby kandydat już potwierdził (np. zaakceptowane punkty wcześniejszych wersji tej aplikacji). */
export async function generateCv(
  profile: Profile,
  posting: JobPosting,
  lang: 'pl' | 'en',
  ctx: LlmContext,
  confirmed: string[] = [],
): Promise<CvContent> {
  const content = await callJson({
    schema: checkedCvSchema(profile, lang),
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.4,
    maxTokens: 10_000,
    system: SYSTEM(lang, genderForms(profile.pronouns)),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nNapisz CV (language="${lang}").`,
    ctx,
  });
  return groundCv(content, profile, { lang, confirmed, names: numberedNames(posting) });
}

const IMPROVE_EXTRA = () => `
POPRAWA WEDŁUG PLANU:
Dostajesz obecną wersję CV i PLAN POPRAWEK wyliczony z raportu oceny. Wprowadź wszystko z planu, co da się zrobić zgodnie z prawdą.
- Każdą pozycję obecnego CV (także ze statusem "fact") możesz przeredagować, skrócić, połączyć z inną albo przenieść wyżej lub niżej, jeśli fakty zostają te same. Nie dopisuj nowych faktów: wszystko musi nadal wynikać z profilu lub z extraFacts (has=true).
- "addable": słowa kluczowe z ogłoszenia, które profil potwierdza ("profileText" i "where" mówią gdzie). Użyj DOSŁOWNEGO brzmienia z ogłoszenia ("term") w miejscu zgodnym z profilem i zrób to, co mówi "todo". Gdy profil ma inne brzmienie ("profileWording", np. polską nazwę funkcji), możesz podać oba, np. "VLOOKUP (WYSZUKAJ.PIONOWO)".
- "fixes": poprawki AI-rekrutera ("find" = obecny fragment, "replace" = propozycja). Wprowadź tylko tę część propozycji, która wynika z profilu.
- "criteria": słabo ocenione kryteria z komentarzem rekrutera i celem ("goal").
- "format": problemy z formatem do usunięcia.
- "stuffed": słowa powtórzone za często: zostaw każde maks. 2-3 razy.
- "keepKeywords": słowa kluczowe, które obecne CV już ma. Każde musi zostać w CV (możesz je przenieść albo przeredagować zdanie).
- Punkty obecnego CV w 1. osobie ("Przygotowywałem…") przepisz formą rzeczownikową ("Przygotowywanie…"), zachowując ich sens.
- CV MUSI nadal zmieścić się na jednej stronie (łącznie maks. ~420 słów). Nie wydłużaj go: jeśli coś dopisujesz, skróć albo usuń coś mniej trafnego.
- Zachowaj język CV. Zwróć CAŁE CV. W "notes" ${forUser()} napisz krótko, co zmieniono.`;

export async function improveCv(
  profile: Profile,
  posting: JobPosting,
  current: CvContent,
  plan: ImprovePlan,
  ctx: LlmContext,
): Promise<CvContent> {
  const lang = current.language;
  const content = await callJson({
    schema: checkedImproveSchema(profile, lang, current, posting.keywords),
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 10_000,
    system: SYSTEM(lang, genderForms(profile.pronouns)) + IMPROVE_EXTRA(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE CV:\n${json(current)}\n\nPLAN POPRAWEK:\n${json(planForPrompt(plan))}\n\nZwróć poprawione CV.`,
    ctx,
  });
  // Liczby z punktów, które kandydat już zaakceptował, są potwierdzone.
  return groundCv(content, profile, { lang, confirmed: factTexts(current), names: numberedNames(posting) });
}

const SYNC_EXTRA = () => `
AKTUALIZACJA Z PROFILU:
Kandydat poprawił to CV ręcznie. Dostajesz je jako OBECNE CV oraz NOWE W PROFILU: tylko to, co doszło do profilu po napisaniu tej wersji (rozmowa z doradcą kariery, odpowiedzi na pytania, edycja profilu, projekty z GitHuba).
- Niczego, co już jest w CV, nie zmieniaj ani nie usuwaj: tytułu, podsumowania, pozycji, punktów (zostaw ich "id" i tekst) ani kolejności. Kandydat mógł coś usunąć celowo: nie przywracaj tego.
- Dodaj z NOWEGO W PROFILU to, co jest trafne dla ogłoszenia: nowe doświadczenie, projekty i szkoły jako pozycje ("sourceId" = id z profilu), fakty ("facts") jako nowe punkty pozycji, której dotyczą (z id faktu w "sourceIds"), a umiejętności, certyfikaty i języki do ich sekcji. Fakt o pracy, stażu albo wolontariacie, którego nie ma w "experience" profilu, możesz pokazać jako pozycję doświadczenia z "sourceId" = id tego faktu.
- "updates" to pozycje, które już są w CV, a kandydat uzupełnił je w profilu: dopisz do nich nowe punkty tylko z "newPoints" (nietrafne pomiń), a gdy "header" = true, popraw nagłówek pozycji (stanowisko, firma, szkoła, kierunek) według profilu, w języku CV.
- To, co nietrafne dla tego ogłoszenia, pomiń. Nie skracaj CV: o tym, co usunąć, zdecyduje kandydat.
- Nie dopisuj niczego spoza profilu. Zachowaj język CV. Zwróć CAŁE CV.
- "notes" ${forUser()}: krótko, co dodano z profilu, a co pominięto i dlaczego.`;

/** Nowe rzeczy z profilu (od powstania tej wersji) dopisane do obecnego CV; reszta CV ma zostać bez zmian. */
export async function syncCv(profile: Profile, posting: JobPosting, current: CvContent, news: SyncRequest, ctx: LlmContext): Promise<CvContent> {
  const lang = current.language;
  const content = await callJson({
    // Szkoły, którą kandydat sam usunął z CV, synchronizacja nie przywraca.
    schema: checkedImproveSchema(profile, lang, current, posting.keywords, false),
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 10_000,
    system: SYSTEM(lang, genderForms(profile.pronouns)) + SYNC_EXTRA(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE CV:\n${json(current)}\n\nNOWE W PROFILU:\n${json(news)}\n\nZwróć CV uzupełnione o trafne nowości z profilu.`,
    ctx,
  });
  return groundCv(content, profile, { lang, confirmed: factTexts(current), names: numberedNames(posting) });
}

const INSTRUCT_EXTRA = () => `
POLECENIE KANDYDATA:
Kandydat poprawił już CV ręcznie i prosi o zmianę opisaną w POLECENIU (zwykle: dodaj coś ze swojego profilu).
- Zrób dokładnie to, o co prosi, korzystając wyłącznie z faktów z profilu i z "extraFacts" (has=true). Nowe pozycje mają "sourceId" = id z profilu.
- Resztę CV zostaw bez zmian. Kandydat mógł celowo coś usunąć: nie przywracaj tego, chyba że o to prosi.
- Jeśli prosi o coś, czego nie ma w profilu, nie wymyślaj tego: napisz w "notes", czego brakuje w profilu.
- CV musi nadal zmieścić się na jednej stronie: jeśli dodajesz, skróć najmniej trafne punkty, ale nie to, o co prosi kandydat.
- Zachowaj język CV. Zwróć CAŁE CV. W "notes" ${forUser()} napisz krótko, co zmieniono.`;

/** Zmiana CV według polecenia kandydata (np. "dodaj praktyki z mojego profilu"). */
export async function instructCv(profile: Profile, posting: JobPosting, current: CvContent, instruction: string, ctx: LlmContext): Promise<CvContent> {
  const lang = current.language;
  const content = await callJson({
    schema: checkedImproveSchema(profile, lang, current, posting.keywords, false),
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 10_000,
    system: SYSTEM(lang, genderForms(profile.pronouns)) + INSTRUCT_EXTRA(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE CV:\n${json(current)}\n\nPOLECENIE:\n"""\n${instruction}\n"""`,
    ctx,
  });
  return groundCv(content, profile, { lang, confirmed: factTexts(current), names: numberedNames(posting) });
}

const SHORTEN_EXTRA = (cut: number) => `
SKRACANIE DO JEDNEJ STRONY:
Dostajesz gotowe CV, które nie mieści się na jednej stronie A4 nawet przy zmniejszonej czcionce. Skróć treść o ok. ${cut}%.
- Wykształcenia nie usuwaj: każda szkoła zostaje, możesz najwyżej skrócić jej szczegóły.
- Najpierw tnij to, co najmniej trafne dla ogłoszenia: mniej ważne projekty i doświadczenie skróć do 1 punktu albo pomiń, długie punkty skróć do jednej linii (do ok. 110 znaków), listę umiejętności ogranicz do 12-15 pozycji (najpierw te z ogłoszenia), podsumowanie do 2-3 zdań.
- Nie dopisuj niczego nowego. Zachowaj słowa kluczowe z ogłoszenia, a w punktach, które zostają, fakty, "sourceId" i status (fact/suggested).
- Zachowaj język CV. Zwróć CAŁE CV. Pole "notes" przepisz i dopisz na końcu jedno zdanie ${forUser()}, co skrócono, żeby CV zmieściło się na stronie.`;

/** `fill`: ile strony zajmuje obecne CV przy najmniejszej czcionce (np. 1.1 = 10% za dużo). */
export async function shortenCv(
  profile: Profile,
  posting: JobPosting,
  current: CvContent,
  fill: number,
  ctx: LlmContext,
  confirmed: string[] = [],
): Promise<CvContent> {
  const lang = current.language;
  // Nagłówek, zdjęcie i klauzula się nie skracają, więc tekstu trzeba uciąć więcej, niż wystaje.
  const cut = Math.min(40, Math.max(10, Math.ceil((1 - 1 / fill) * 100) + 10));
  const content = await callJson({
    schema: checkedImproveSchema(profile, lang, current, posting.keywords),
    schemaName: 'cv',
    tier: 'main',
    temperature: 0.3,
    maxTokens: 10_000,
    system: SYSTEM(lang, genderForms(profile.pronouns)) + SHORTEN_EXTRA(cut),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE CV:\n${json(current)}\n\nSkróć CV, żeby zmieściło się na jednej stronie.`,
    ctx,
  });
  return groundCv(content, profile, { lang, confirmed: [...confirmed, ...factTexts(current)], names: numberedNames(posting) });
}
