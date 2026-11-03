import { GapAnalysisSchema, type GapAnalysis, type JobPosting, type Profile } from '../../../shared/schemas';
import { callJson, type LlmContext } from '../openrouter';
import { json, postingForPrompt, profileForPrompt } from './common';

const SYSTEM = `Jesteś doradcą kariery. Porównujesz wymagania z ogłoszenia z profilem kandydata (student/junior), żeby przed napisaniem CV dopytać o brakujące informacje.
Zasady:
- Przejdź po wymaganiach obowiązkowych, mile widzianych i słowach kluczowych z ogłoszenia.
- Wymaganie jest pokryte ("covered"), jeśli profil je potwierdza: w doświadczeniu, projektach (także technologie projektów), edukacji, umiejętnościach, kursach albo w "extraFacts" z has=true. Uwzględniaj synonimy (np. "Excel" pokrywa "MS Excel").
- Jeśli w "extraFacts" jest już odpowiedź na dany temat (has=true lub has=false), NIE pytaj o to ponownie.
- Dla niepokrytych wymagań zadaj krótkie, konkretne pytanie po polsku, na "Ty". Pytanie ma wydobyć materiał do CV: czy kandydat to zna, gdzie tego używał (praca, studia, projekt, kurs), co konkretnie zrobił i z jakim efektem.
- Nie pytaj o rzeczy, których nie da się uczciwie wpisać w CV, ani o oczywistości. Przy wymaganym wykształceniu/stażu, którego kandydat nie ma, możesz zapytać, czy jest w trakcie lub ma coś pokrewnego.
- Maksymalnie 8 pytań: najpierw obowiązkowe, potem mile widziane. "hint" to krótka podpowiedź, co warto napisać (np. "Podaj nazwę kursu albo projektu i swoje zadania w nim").
- Formułuj pytania i podpowiedzi bez form zależnych od płci — także bez zapisów typu "miałeś(-aś)" czy "robiłeś/aś". Zamiast czasu przeszłego w 2. osobie pytaj w teraźniejszym albo bezosobowo: "Czy masz doświadczenie z…?", "Gdzie i jak tego używasz?", "Jak wyglądał ten projekt i co z niego wynikło?", "Podaj, gdzie to było (staż, projekt, kurs)".
- "id" pytań: q1, q2, …`;

// Słowa z rodzajem w 2. osobie ("robiłeś", "miałaś") i zapisy typu "miałeś(-aś)" — model czasem je wstawia mimo zasad,
// więc taka odpowiedź nie przechodzi walidacji i wraca do poprawki.
const GENDERED = /(?<!\p{L})\p{L}+ł(?:eś|aś)(?!\p{L})|\(-?a[śs]?\)|\/-?a[śs]?(?!\p{L})/giu;

export function genderedForms(g: GapAnalysis): string[] {
  return [...new Set(g.questions.flatMap((q) => `${q.question} ${q.hint}`.match(GENDERED) ?? []))];
}

const NeutralGapSchema = GapAnalysisSchema.superRefine((g, ctx) => {
  const found = genderedForms(g);
  if (found.length) {
    ctx.addIssue({
      code: 'custom',
      message: `Formy zależne od płci: ${found.join(', ')}. Przeformułuj neutralnie, np. „Czy masz doświadczenie z…?”, „Gdzie i jak tego używasz?”, „Co z tego wynikło?”.`,
    });
  }
});

export async function gapQuestions(profile: Profile, posting: JobPosting, ctx: LlmContext): Promise<GapAnalysis> {
  return callJson({
    schema: NeutralGapSchema,
    schemaName: 'gap_analysis',
    tier: 'fast',
    temperature: 0.2,
    maxTokens: 4000,
    system: SYSTEM,
    user: `OGŁOSZENIE:\n${json(postingForPrompt(posting))}\n\nPROFIL KANDYDATA:\n${json(profileForPrompt(profile))}`,
    ctx,
  });
}
