import { afterAll, describe, expect, it } from 'vitest';
import { renderCvHtml } from '../server/cv/render';
import { htmlToPdf } from '../server/cv/pdf';
import { closeBrowser } from '../server/cv/browser';
import { checkFormat } from '../server/ats/formatChecks';
import { applyDecisions } from '../server/llm/prompts/common';
import { TemplateIds } from '../shared/schemas';
import { cv, profile } from './fixtures';

afterAll(() => closeBrowser());

describe('PDF w obie strony (render → PDF → tekst jak w ATS)', () => {
  for (const template of TemplateIds) {
    it(`szablon ${template}: tekst, polskie znaki, 1 strona, komplet kontroli`, async () => {
      const version = { ...cv, template, decisions: { b2: 'accepted' as const } };
      const { pdf, text: raw, pages } = await htmlToPdf(renderCvHtml(version, profile, null, 'pdf'));
      const text = raw.replace(/\s+/g, ' ');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pages).toBe(1);
      expect(text).toContain('Zażółć gęślą jaźń');
      expect(text).toContain('Zofia Żółkiewska');
      expect(text).toContain('zofia.zolkiewska@example.com');
      expect(text).toContain('Doświadczenie zawodowe');
      expect(text).toContain('Zwiększenie zasięgu profilu o ok. 30%');

      const fmt = checkFormat(raw, pages, applyDecisions(version), profile);
      const failed = fmt.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
      expect(failed).toEqual([]);
      expect(fmt.score).toBe(fmt.max);
    });
  }

  it('podgląd podświetla oczekujące sugestie, PDF nie', () => {
    expect(renderCvHtml(cv, profile, null, 'preview')).toContain('<mark class="suggested" data-id="b2">');
    expect(renderCvHtml(cv, profile, null, 'pdf')).not.toContain('<mark');
  });

  it('odrzucona sugestia trafia do PDF jako wersja bezpieczna', async () => {
    const { text: raw } = await htmlToPdf(renderCvHtml({ ...cv, decisions: { b2: 'rejected' } }, profile, null, 'pdf'));
    const text = raw.replace(/\s+/g, ' ');
    expect(text).toContain('Rozwijanie zasięgu profilu');
    expect(text).not.toContain('o ok. 30%');
  });
});
