import { AiCriterionKeys, AiReviewSchema, type AiReview, type JobPosting } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { forUser, json, postingForPrompt } from './common';

const SYSTEM = () => `Jesteś rekruterem i jednocześnie systemem AI do wstępnej selekcji CV. Oceniasz CV wyłącznie na podstawie jego tekstu i ogłoszenia - tak, jak zrobiłby to automatyczny screening w firmie. Bądź rzetelny i surowy, ale sprawiedliwy: kandydat jest studentem/juniorem, oceniaj względem poziomu stanowiska.

CV zawiera wyłącznie fakty z profilu kandydata: program nie dopisuje niczego, czego kandydat sam nie podał. Nie obniżaj oceny za brak liczb ani szczegółów, których kandydat nie ma, i nie wpisuj ich do poprawek jako gotowego tekstu. Dane kontaktowe program wstawia z profilu: nie proś o nie (np. o "prawdziwy numer telefonu").

Oceń 5 kryteriów w skali 0–10: każde kryterium dokładnie raz, ocena to liczba całkowita. Trzymaj się progów poniżej, żeby to samo CV zawsze dostało tę samą ocenę; wartość pośrednią daj, gdy CV jest między progami.
- must_have_match: na ile CV pokazuje spełnienie wymagań OBOWIĄZKOWYCH (dowody w treści, nie same słowa). 10 = każde wymaganie obowiązkowe ma dowód w doświadczeniu, projektach lub edukacji; 7 = większość ma dowód, pojedyncze są tylko na liście umiejętności; 4 = mniej więcej połowa, część tylko jako słowa; 1 = prawie żadne.
- achievements: konkretne efekty i rezultaty zamiast samych obowiązków. 10 = mierzalne efekty (liczby, wyniki) w większości punktów; 8 = konkretne produkty pracy, skala lub narzędzia nawet bez liczb; 5 = same obowiązki bez efektów; 2 = ogólniki.
- summary_fit: czy nagłówek i podsumowanie od razu mówią, że to kandydat na TO stanowisko. 10 = nagłówek nazywa to stanowisko, a podsumowanie podaje kluczowe wymagania z ogłoszenia i dowód; 7 = trafne, ale bez dowodu albo bez nazwy stanowiska; 4 = ogólne, pasuje do wielu ofert; 1 = brak nagłówka i podsumowania albo inna branża.
- clarity: czytelność, zwięzłość, logiczna kolejność, brak lania wody i powtórzeń. 10 = krótkie punkty od czynności, logiczna kolejność, bez powtórzeń; 7 = czytelne, ale pojedyncze punkty są za długie albo się powtarzają; 4 = długie bloki tekstu albo chaotyczna kolejność; 1 = trudne do przeczytania.
- red_flags: 10 = brak czerwonych flag; 8 = jedna drobna (np. pojedynczy frazes); 5 = kilka drobnych albo jedna poważna; 2 = kilka poważnych. Odejmuj za: niespójne daty, luki bez wyjaśnienia, frazesy bez dowodów, upychanie słów kluczowych, literówki, nieprofesjonalny e-mail, sprzeczności. Nie odejmuj za brak liczb ani za krótką historię pracy typową dla studenta.

"comment" przy każdym kryterium: 1–2 zdania ${forUser()} z uzasadnieniem.
"strengths"/"weaknesses": po 2–5 konkretnych punktów ${forUser()}.
"fixes": 3–8 konkretnych poprawek. "find" = DOKŁADNY fragment z CV (skopiowany znak w znak) albo pusty przy dopisaniu; "replace" = nowa treść w języku CV; "why" ${forUser()}.
- Styl "replace": punkty CV po polsku formą rzeczownikową ("Przygotowywanie cotygodniowych raportów…", "Budowa dashboardu…"), nigdy w 1. osobie ("Przygotowywałem…", "Zbudowałam…"); po angielsku od czasownika w czasie przeszłym, bez "I" ("Built…", "Prepared…").
- needsUserInput=false tylko wtedy, gdy poprawkę da się zrobić z tego, co już jest w CV (przeredagowanie, skrót, kolejność, słowa z ogłoszenia potwierdzone treścią). Jeśli wymaga nowych informacji (liczby, wyniki, narzędzia, dane kontaktowe), ustaw needsUserInput=true i w "replace" opisz, o co zapytać kandydata - NIE wymyślaj faktów.
"wouldInterview": czy zaprosiłbyś na rozmowę. "verdict": 1–2 zdania podsumowania ${forUser()}.`;

/** Problemy z kryteriami: każde z 5 dokładnie raz, ocena całkowita 0-10 (inaczej wynik skacze między ocenami). */
export function reviewProblems(review: AiReview): string[] {
  const out: string[] = [];
  const keys = review.criteria.map((c) => c.key);
  const missing = AiCriterionKeys.filter((k) => !keys.includes(k));
  const repeated = AiCriterionKeys.filter((k) => keys.filter((x) => x === k).length > 1);
  if (missing.length) out.push(`Brak kryteriów: ${missing.join(', ')}. Oceń wszystkie 5: ${AiCriterionKeys.join(', ')}.`);
  if (repeated.length) out.push(`Kryteria ocenione więcej niż raz: ${repeated.join(', ')}. Każde kryterium podaj dokładnie raz.`);
  for (const c of review.criteria) {
    if (!Number.isInteger(c.score) || c.score < 0 || c.score > 10) out.push(`Ocena "${c.key}" = ${c.score}: musi być liczbą całkowitą od 0 do 10.`);
  }
  return out;
}

const CheckedReviewSchema = AiReviewSchema.superRefine((r, ctx) => {
  for (const message of reviewProblems(r)) ctx.addIssue({ code: 'custom', path: ['criteria'], message });
});

export async function evaluateCv(cvText: string, posting: JobPosting, ctx: LlmContext): Promise<AiReview> {
  return callJson({
    schema: CheckedReviewSchema,
    schemaName: 'cv_review',
    tier: 'main',
    temperature: 0,
    // Nowa próba po zapętleniu też blisko zera, żeby ocena nie zależała od losowania.
    retryTemperature: 0.2,
    maxTokens: 6000,
    system: SYSTEM(),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nTEKST CV (tak jak odczytał go system ATS):\n"""\n${cvText}\n"""`,
    ctx,
  });
}
