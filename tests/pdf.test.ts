import { afterAll, describe, expect, it } from 'vitest';
import { renderCvHtml } from '../server/cv/render';
import { htmlToPdf } from '../server/cv/pdf';
import { closeBrowser, withPage } from '../server/cv/browser';
import { RODO_STANDARD } from '../server/cv/rodo';
import { checkFormat, withoutClause } from '../server/ats/formatChecks';
import { applyDecisions } from '../server/llm/prompts/common';
import { TemplateIds } from '../shared/schemas';
import { blankContent, cv, profile } from './fixtures';

afterAll(() => closeBrowser());

const rodo = { include: true, text: RODO_STANDARD, reason: '' };

describe('PDF w obie strony (render → PDF → tekst jak w ATS)', () => {
  for (const template of TemplateIds) {
    it(`szablon ${template}: tekst, polskie znaki, 1 strona, komplet kontroli bez klauzuli`, async () => {
      const version = { ...cv, template, rodo, decisions: { b2: 'accepted' as const } };
      const { pdf, text: raw, pages } = await htmlToPdf(renderCvHtml(version, profile, null, 'pdf'));
      const text = raw.replace(/\s+/g, ' ');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pages).toBe(1);
      expect(text).toContain('Zażółć gęślą jaźń');
      expect(text).toContain('Zofia Żółkiewska');
      expect(text).toContain('zofia.zolkiewska@example.com');
      expect(text).toContain('Doświadczenie zawodowe');
      expect(text).toContain('Zwiększenie zasięgu profilu o ok. 30%');
      // Klauzula zawinięta w kilka linii PDF i tak jest wycinana w całości.
      expect(withoutClause(raw, RODO_STANDARD)).not.toMatch(/Rozporządzeniem|RODO/);

      // Kontrole liczone na samym CV: treść fixture'a musi je zaliczyć bez pomocy klauzuli.
      const fmt = checkFormat(raw, pages, applyDecisions(version), profile, version.rodo.text);
      const failed = fmt.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
      expect(failed).toEqual([]);
      expect(fmt.score).toBe(fmt.max);
    });
  }

  it('prawie puste CV z długą klauzulą nie dostaje punktów za format', async () => {
    const empty = { ...cv, rodo, content: { ...blankContent, summary: { ...blankContent.summary, text: 'Student.' }, sectionOrder: cv.content.sectionOrder } };
    const { text, pages } = await htmlToPdf(renderCvHtml(empty, profile, null, 'pdf'));
    // Wcześniej sama klauzula zaliczała "Tekst da się odczytać" i "Polskie znaki".
    expect(checkFormat(text, pages, empty.content, profile).checks.find((c) => c.name === 'Tekst da się odczytać')?.ok).toBe(true);
    const fmt = checkFormat(text, pages, empty.content, profile, RODO_STANDARD);
    expect(fmt.checks.find((c) => c.name === 'Tekst da się odczytać')?.ok).toBe(false);
    expect(fmt.score).toBe(0);
  });

  it('prawdziwe błędy obniżają wynik formatu', async () => {
    const mixed = {
      ...cv,
      rodo,
      decisions: { b2: 'accepted' as const },
      content: { ...cv.content, projects: [{ sourceId: 'p', name: 'Blog', role: '', dates: '03/2025 – 05/2025', technologies: [], link: '', bullets: [] }] },
    };
    const noPhone = { ...profile, contact: { ...profile.contact, phone: '' } };
    const { text, pages } = await htmlToPdf(renderCvHtml(mixed, noPhone, null, 'pdf'));
    const fmt = checkFormat(text, pages, applyDecisions(mixed), noPhone, RODO_STANDARD);
    expect(fmt.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['Numer telefonu', 'Spójny format dat']);
    expect(fmt.score).toBe(fmt.max - 3);
  });

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

  it("PDF do oceny (tryb 'ats') nie zawiera niepotwierdzonej sugestii", async () => {
    const { text: raw } = await htmlToPdf(renderCvHtml(cv, profile, null, 'ats'));
    const text = raw.replace(/\s+/g, ' ');
    expect(text).toContain('Rozwijanie zasięgu profilu');
    expect(text).not.toContain('o ok. 30%');
  });
});

describe('dopasowanie do jednej strony', () => {
  /** CV z doświadczeniem powtórzonym `n` razy: 8 to trochę za dużo na stronę, 14 to dużo za dużo. */
  const longer = (n: number) => {
    const content = structuredClone(cv.content);
    content.experience = Array.from({ length: n }, () => structuredClone(cv.content.experience)).flat();
    return renderCvHtml({ ...cv, content, decisions: { b2: 'accepted' } }, profile, null, 'pdf');
  };
  const fitIn = (html: string) =>
    withPage(async (page) => {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      return page.evaluate(() => (window as any).__cvFit() as { scale: number; fill: number });
    });

  it('treść trochę dłuższa niż strona: mniejsza czcionka i jedna strona', async () => {
    const html = longer(8);
    const fit = await fitIn(html);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.fill).toBeLessThanOrEqual(1);
    const { pages, fill } = await htmlToPdf(html);
    expect(pages).toBe(1);
    expect(fill).toBeLessThanOrEqual(1);
  });

  it('gdy najmniejsza czcionka nie wystarcza, węższe marginesy (nie poniżej 10 mm) i dalej jedna strona', async () => {
    const html = longer(9);
    const fit = (await fitIn(html)) as { scale: number; fill: number; margins: number[] };
    expect(fit.scale).toBeCloseTo(8.6 / 9.8, 2);
    expect(fit.margins.every((m) => m >= 10)).toBe(true);
    expect(fit.margins[0]).toBeLessThan(13); // "modern" ma zwykle 13 mm u góry
    const { pages } = await htmlToPdf(html);
    expect(pages).toBe(1);
  });

  it('czcionka nie schodzi poniżej minimum, a za długie CV zgłasza, o ile wystaje', async () => {
    const { pages, fill } = await htmlToPdf(longer(14));
    expect(pages).toBe(2);
    expect(fill).toBeGreaterThan(1);
    // Najmniejsza skala w szablonie "modern" (9,8 pt) to 8,6 pt.
    expect((await fitIn(longer(14))).scale).toBeCloseTo(8.6 / 9.8, 2);
  });

  it('krótkie CV zostaje w pełnym rozmiarze', async () => {
    const fit = await fitIn(renderCvHtml(cv, profile, null, 'pdf'));
    expect(fit.scale).toBe(1);
  });
});
