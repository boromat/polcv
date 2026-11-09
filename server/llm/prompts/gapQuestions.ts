import { GapAnalysisSchema, type GapAnalysis, type JobPosting, type Profile } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { HttpError } from '../../storage/store';
import { forUser, genderForms, json, postingForPrompt, profileForPrompt } from './common';

const SYSTEM = (forms: ReturnType<typeof genderForms>) => `Jesteś doradcą kariery. Porównujesz wymagania z ogłoszenia z profilem kandydata (student/junior), żeby przed napisaniem CV dopytać o brakujące informacje.
Zasady:
- Przejdź po wymaganiach obowiązkowych, mile widzianych i słowach kluczowych z ogłoszenia.
- Wymaganie jest pokryte ("covered"), jeśli profil je potwierdza: w doświadczeniu, projektach (także technologie projektów), edukacji, umiejętnościach, kursach albo w "extraFacts" z has=true. Uwzględniaj synonimy (np. "Excel" pokrywa "MS Excel").
- Jeśli w "extraFacts" jest już odpowiedź na dany temat (has=true lub has=false), NIE pytaj o to ponownie.
- "covered": krótko, najwyżej 12 pozycji, każda do ok. 8 słów (wymaganie i gdzie jest w profilu).
- Dla niepokrytych wymagań zadaj krótkie, konkretne pytanie ${forUser()}, na "Ty". Pola "requirement", "hint" i "covered" też ${forUser()}. Pytanie ma wydobyć materiał do CV: czy to znasz, gdzie (praca, studia, projekt, kurs), jakie było zadanie i z jakim efektem.
- Nie pytaj o rzeczy, których nie da się uczciwie wpisać w CV, ani o oczywistości. Przy wymaganym wykształceniu/stażu, którego kandydat nie ma, możesz zapytać, czy jest w trakcie lub ma coś pokrewnego.
- Maksymalnie 8 pytań: najpierw obowiązkowe, potem mile widziane. "hint" to krótka podpowiedź, co warto napisać (np. "Podaj nazwę kursu albo projektu i swoje zadania w nim").
- ${forms ? `Kandydat określa się jako "${forms.label}": w pytaniach i podpowiedziach zwracaj się do niego formami ${forms.you}. Nie używaj innych form z rodzajem ani zapisów typu "miałeś(-aś)".` : "Formułuj pytania i podpowiedzi bez form zależnych od płci - także bez zapisów typu \"miałeś(-aś)\" czy \"robiłeś/aś\". Zamiast czasu przeszłego w 2. osobie pytaj w teraźniejszym albo bezosobowo: \"Czy masz doświadczenie z…?\", \"Gdzie i jak tego używasz?\", \"Jak wyglądał ten projekt i co z niego wynikło?\", \"Podaj, gdzie to było (staż, projekt, kurs)\". Zamiast \"Gdzie używałeś…?\" pisz \"Gdzie tego używasz?\", zamiast \"Czy budowałeś…?\" pisz \"Czy masz doświadczenie z budową…?\", zamiast \"Co zrobiłeś?\" pisz \"Co było Twoim zadaniem?\"."}
- "id" pytań: q1, q2, …`;

// Słowa z rodzajem w 2. osobie ("robiłeś", "miałaś", "miałoś") i zapisy typu "miałeś(-aś)" - model czasem je wstawia mimo zasad,
// więc taka odpowiedź nie przechodzi walidacji i wraca do poprawki. Formy zgodne z tym, jak kandydat się określa, są w porządku.
const GENDERED = /(?<!\p{L})\p{L}+ł(?:eś|aś|oś)(?!\p{L})|\(-?a[śs]?\)|\/-?a[śs]?(?!\p{L})/giu;

/** Formy z rodzajem w pytaniach, które nie pasują do kandydata (bez wyboru: wszystkie). */
export function genderedForms(g: GapAnalysis, pronouns?: Profile['pronouns']): string[] {
  const allowed = genderForms(pronouns)?.suffix;
  const found = g.questions.flatMap((q) => `${q.question} ${q.hint}`.match(GENDERED) ?? []);
  return [...new Set(found.filter((w) => !allowed || !w.toLowerCase().endsWith(`ł${allowed}`)))];
}

const gapSchema = (pronouns: Profile['pronouns']) =>
  GapAnalysisSchema.superRefine((g, ctx) => {
    const found = genderedForms(g, pronouns);
    if (!found.length) return;
    const forms = genderForms(pronouns);
    ctx.addIssue({
      code: 'custom',
      message: forms
        ? `Formy niezgodne z tym, jak kandydat się określa ("${forms.label}"): ${found.join(', ')}. Użyj form ${forms.you}.`
        : `Formy zależne od płci: ${found.join(', ')}. Przeformułuj neutralnie, np. „Czy masz doświadczenie z…?”, „Gdzie i jak tego używasz?”, „Co z tego wynikło?”.`,
    });
  });

export async function gapQuestions(profile: Profile, posting: JobPosting, ctx: LlmContext): Promise<GapAnalysis> {
  const opts = {
    schemaName: 'gap_analysis',
    tier: 'fast' as const,
    temperature: 0.2,
    // Duży profil (np. z projektami z GitHuba) daje długą listę "covered"; 4000 tokenów potrafiło uciąć odpowiedź.
    maxTokens: 8000,
    system: SYSTEM(genderForms(profile.pronouns)),
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}`,
    ctx,
  };
  try {
    return await callJson({ ...opts, schema: gapSchema(profile.pronouns) });
  } catch (e) {
    // Styl pytań nie może zatrzymać CV: gdy model mimo poprawek pisze "używałeś", bierzemy pytania bez tej kontroli.
    if (!(e instanceof HttpError) || e.status !== 502) throw e;
    console.warn('[AI] gap_analysis: formy z rodzajem mimo poprawek - przyjmuję pytania bez tej kontroli.');
    return callJson({ ...opts, schema: GapAnalysisSchema });
  }
}
