import { describe, expect, it } from 'vitest';
import { genderedForms } from '../server/llm/prompts/gapQuestions';
import { toStrictJsonSchema } from '../server/llm/openrouter';
import { GapAnalysisSchema } from '../shared/schemas';

const gap = (question: string, hint = '') => ({ covered: [], questions: [{ id: 'q1', requirement: 'Testy A/B', importance: 'must' as const, question, hint }] });

describe('pytania o braki bez form zależnych od płci', () => {
  it('wyłapuje "miałeś(-aś)", "robiłeś", "zrobiłaś" i "/aś"', () => {
    expect(genderedForms(gap('Czy miałeś(-aś) styczność z testami A/B?', 'Podaj, gdzie to robiłeś'))).toEqual(['miałeś', '(-aś)', 'robiłeś']);
    expect(genderedForms(gap('Co zrobiłaś w projekcie?'))).toEqual(['zrobiłaś']);
    expect(genderedForms(gap('Czy pracowałeś/aś z SQL?'))).toEqual(['pracowałeś', '/aś']);
  });

  it('przepuszcza formy neutralne (także "właśnie", "Testy A/B")', () => {
    expect(genderedForms(gap('Czy masz doświadczenie z testami A/B? Właśnie tego szukają.', 'Podaj, gdzie to było (staż, projekt, kurs).'))).toEqual([]);
  });

  it('kontrola nie zmienia schematu JSON wysyłanego do modelu', async () => {
    const { gapQuestions } = await import('../server/llm/prompts/gapQuestions');
    expect(gapQuestions).toBeTypeOf('function');
    expect(toStrictJsonSchema(GapAnalysisSchema.superRefine(() => {}))).toEqual(toStrictJsonSchema(GapAnalysisSchema));
  });
});
