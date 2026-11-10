// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CvContent, CvText, CvVersion } from '../../shared/schemas';
import { CvEditor, pendingCount } from '../../client/src/pages/app/CvEditor';

// Żółte sugestie: zdanie odważniejsze niż profil trafia do PDF dopiero po decyzji kandydata. "To prawda - zostaw"
// robi z niego fakt, "Użyj bezpiecznej wersji" wstawia wersję z samych faktów albo usuwa punkt, gdy jej nie ma.

const text = (id: string, t: string, extra: Partial<CvText> = {}): CvText => ({ id, text: t, status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp1'], ...extra });

const content = (over: Partial<CvContent> = {}): CvContent => ({
  language: 'pl',
  headline: 'Specjalista ds. marketingu',
  summary: text('s1', 'Studiuję marketing i prowadzę profil firmy na Instagramie.'),
  sectionOrder: ['summary', 'experience'],
  experience: [
    {
      sourceId: 'exp1',
      role: 'Stażystka ds. marketingu',
      company: 'Firma Testowa',
      location: 'Kraków',
      dates: '07.2025 - 09.2025',
      bullets: [
        text('b1', 'Prowadzenie profilu firmy na Instagramie'),
        text('b2', 'Zwiększenie zasięgu profilu o ok. 30%', { status: 'suggested', reason: 'Liczba spoza profilu (30%) - potwierdź albo odrzuć.', fallbackText: 'Zwiększenie zasięgu profilu' }),
        text('b3', 'Kierowanie kampanią w Google Ads', { status: 'suggested', reason: 'Silniejsza rola niż w profilu.', fallbackText: '' }),
      ],
    },
  ],
  projects: [],
  education: [],
  skills: [],
  certificates: [],
  languages: [],
  interests: [],
  notes: '',
  ...over,
});

const version = (c: CvContent): CvVersion => ({
  version: 1,
  createdAt: '',
  updatedAt: '',
  origin: 'generated',
  content: c,
  decisions: {},
  template: 'modern',
  photo: false,
  photoReason: '',
  rodo: { include: false, text: '', reason: '' },
});

function renderEditor(c: CvContent) {
  const onPatch = vi.fn();
  render(<CvEditor cv={version(c)} onPatch={onPatch} hasPhoto={false} unverifiedSkills={[]} focusId={null} onInstruct={async () => true} />);
  return onPatch;
}

/** Karta sugestii po jej tekście (w cudzysłowie, jak w edytorze). */
const card = (t: string) => screen.getByText(`„${t}”`).closest('.suggestion') as HTMLElement;
const bullets = (patch: { content: CvContent }) => patch.content.experience[0].bullets.map((b) => [b.text, b.status]);

afterEach(cleanup);

describe('Edytor CV: żółte sugestie', () => {
  it('pokazuje każdą sugestię z powodem i wersją bezpieczną, a licznik zgadza się z serwerem', () => {
    renderEditor(content());
    expect(screen.getByText('Do Twojej decyzji (2)')).toBeTruthy();
    expect(within(card('Zwiększenie zasięgu profilu o ok. 30%')).getByText(/Liczba spoza profilu/)).toBeTruthy();
    expect(within(card('Zwiększenie zasięgu profilu o ok. 30%')).getByText(/„Zwiększenie zasięgu profilu”/)).toBeTruthy();
    expect(within(card('Kierowanie kampanią w Google Ads')).getByText('usunięcie tego punktu')).toBeTruthy();
    expect(pendingCount(version(content()))).toBe(2);
  });

  it('"To prawda - zostaw": sugestia staje się faktem z tym samym tekstem', () => {
    const onPatch = renderEditor(content());
    fireEvent.click(within(card('Zwiększenie zasięgu profilu o ok. 30%')).getByRole('button', { name: 'To prawda - zostaw' }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(bullets(onPatch.mock.calls[0][0])).toEqual([
      ['Prowadzenie profilu firmy na Instagramie', 'fact'],
      ['Zwiększenie zasięgu profilu o ok. 30%', 'fact'],
      ['Kierowanie kampanią w Google Ads', 'suggested'],
    ]);
  });

  it('"Użyj bezpiecznej wersji": wstawia wersję z samych faktów, a bez niej usuwa punkt', () => {
    const onPatch = renderEditor(content());
    fireEvent.click(within(card('Zwiększenie zasięgu profilu o ok. 30%')).getByRole('button', { name: 'Użyj bezpiecznej wersji' }));
    expect(bullets(onPatch.mock.calls[0][0])).toEqual([
      ['Prowadzenie profilu firmy na Instagramie', 'fact'],
      ['Zwiększenie zasięgu profilu', 'fact'],
      ['Kierowanie kampanią w Google Ads', 'suggested'],
    ]);
    fireEvent.click(within(card('Kierowanie kampanią w Google Ads')).getByRole('button', { name: 'Użyj bezpiecznej wersji' }));
    expect(bullets(onPatch.mock.calls[1][0]).map(([t]) => t)).not.toContain('Kierowanie kampanią w Google Ads');
  });

  it('sugestia tytułu: zostawiona staje się tytułem, odrzucona zostawia wersję bezpieczną', () => {
    const titled = content({
      headline: 'Specjalista ds. marketingu',
      headlineSuggestion: text('headline', 'Specjalista ds. marketingu z Google Ads', { status: 'suggested', reason: 'Profil nie potwierdza: Google Ads.', fallbackText: 'Specjalista ds. marketingu', sourceIds: [] }),
    });
    const onPatch = renderEditor(titled);
    expect(screen.getByText('Do Twojej decyzji (3)')).toBeTruthy();
    fireEvent.click(within(card('Specjalista ds. marketingu z Google Ads')).getByRole('button', { name: 'To prawda - zostaw' }));
    expect(onPatch.mock.calls[0][0].content).toMatchObject({ headline: 'Specjalista ds. marketingu z Google Ads', headlineSuggestion: undefined });
    fireEvent.click(within(card('Specjalista ds. marketingu z Google Ads')).getByRole('button', { name: 'Użyj bezpiecznej wersji' }));
    expect(onPatch.mock.calls[1][0].content).toMatchObject({ headline: 'Specjalista ds. marketingu', headlineSuggestion: undefined });
  });
});
