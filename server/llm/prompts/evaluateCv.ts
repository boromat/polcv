import { AiReviewSchema, type AiReview, type JobPosting } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { json, postingForPrompt } from './common';

const SYSTEM = `Jesteś rekruterem i jednocześnie systemem AI do wstępnej selekcji CV. Oceniasz CV wyłącznie na podstawie jego tekstu i ogłoszenia - tak, jak zrobiłby to automatyczny screening w firmie. Bądź rzetelny i surowy, ale sprawiedliwy: kandydat jest studentem/juniorem, oceniaj względem poziomu stanowiska.

Oceń 5 kryteriów w skali 0–10 (liczby całkowite):
- must_have_match: na ile CV pokazuje spełnienie wymagań OBOWIĄZKOWYCH (dowody w treści, nie same słowa).
- achievements: konkretne efekty, liczby, rezultaty projektów zamiast samych obowiązków.
- summary_fit: czy nagłówek i podsumowanie od razu mówią, że to kandydat na TO stanowisko.
- clarity: czytelność, zwięzłość, logiczna kolejność, brak lania wody i powtórzeń.
- red_flags: 10 = brak czerwonych flag; odejmuj za: niespójne daty, luki bez wyjaśnienia, frazesy bez dowodów, upychanie słów kluczowych, literówki, nieprofesjonalny e-mail, sprzeczności.

"comment" przy każdym kryterium: 1–2 zdania po polsku z uzasadnieniem.
"strengths"/"weaknesses": po 2–5 konkretnych punktów po polsku.
"fixes": 3–8 konkretnych poprawek. "find" = DOKŁADNY fragment z CV (skopiowany znak w znak) albo pusty przy dopisaniu; "replace" = nowa treść w języku CV; "why" po polsku. Jeśli poprawka wymaga informacji, których w CV nie ma (np. liczb), ustaw needsUserInput=true i w "replace" opisz, czego brakuje - NIE wymyślaj faktów.
"wouldInterview": czy zaprosiłbyś na rozmowę. "verdict": 1–2 zdania podsumowania po polsku.`;

export async function evaluateCv(cvText: string, posting: JobPosting, ctx: LlmContext): Promise<AiReview> {
  return callJson({
    schema: AiReviewSchema,
    schemaName: 'cv_review',
    tier: 'main',
    temperature: 0,
    maxTokens: 6000,
    system: SYSTEM,
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nTEKST CV (tak jak odczytał go system ATS):\n"""\n${cvText}\n"""`,
    ctx,
  });
}
