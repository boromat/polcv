// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application, MockInterview, MockInterviewView } from '../../shared/schemas';
import * as fixtures from '../fixtures';

// Próbna rozmowa w zakładce Rozmowa: pytanie, odpowiedź, karta oceny z mocniejszą wersją i dopisanie faktu do profilu
// dopiero po kliknięciu.

const { api } = vi.hoisted(() => ({
  api: { mock: vi.fn(), startMock: vi.fn(), answerMock: vi.fn(), skipMock: vi.fn(), finishMock: vi.fn(), addMockFact: vi.fn(), clearMock: vi.fn() },
}));
vi.mock('../../client/src/api', () => ({ api }));

const { MockInterviewCard } = await import('../../client/src/pages/app/MockInterview');

const at = '2026-11-11T10:00:00.000Z';
const question = (id: string, text: string) => ({ id: `t-${id}`, role: 'interviewer' as const, kind: 'question' as const, questionId: id, content: text, at });
const interview = (over: Partial<MockInterview> = {}): MockInterview => ({
  id: 'm1',
  startedAt: at,
  status: 'active',
  language: 'pl',
  cvText: '',
  probes: [{ kind: 'skill', item: 'Canva', detail: 'Umiejętność „Canva” bez dowodu.' }],
  plan: {
    questions: [
      { id: 'q1', kind: 'experience', text: 'Proszę opowiedzieć o raportach.', lang: 'pl', why: '' },
      { id: 'q2', kind: 'gap', text: 'Jak radzi sobie Pan z brakiem Google Ads?', lang: 'pl', why: '' },
    ],
    companyChecks: ['Czym zajmuje się dział marketingu'],
  },
  turns: [question('q1', 'Proszę opowiedzieć o raportach.')],
  grades: [],
  summary: null,
  ...over,
});
const view = (m: MockInterview | null): MockInterviewView => ({ current: m, history: [], costUsd: 0.004 });

const app: Application = {
  id: 'a1', profileId: 'p1', createdAt: at, updatedAt: at, url: '', rawText: '', fetchMethod: 'wklejony tekst', posting: fixtures.posting, gap: null,
  status: 'przygotowane', notes: '', currentVersion: 1, pdfFile: '', hasInterviewPrep: false, hasCoverLetter: false,
};
const run = (_m: string, fn: () => Promise<void>) => void fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Próbna rozmowa w zakładce Rozmowa', () => {
  it('pytanie, odpowiedź, karta oceny z miejscami do uzupełnienia i dopisanie faktu dopiero po kliknięciu', async () => {
    api.mock.mockResolvedValue(view(interview()));
    const answered = interview({
      turns: [
        question('q1', 'Proszę opowiedzieć o raportach.'),
        { id: 'a1', role: 'candidate', kind: 'answer', questionId: 'q1', content: 'Robiłam raporty w GA4.', at },
        question('q2', 'Jak radzi sobie Pan z brakiem Google Ads?'),
      ],
      grades: [
        {
          questionId: 'q1', answerId: 'a1', score: 3,
          criteria: { concrete: 2, fit: 3, structure: 3, correctness: 4, length: 3 },
          good: ['Konkretne narzędzie.'], missing: ['Brak efektu.'],
          stronger: 'Przygotowuję raporty w Google Analytics 4 [ile raportów miesięcznie] dla działu marketingu.',
          placeholders: ['[ile raportów miesięcznie]'],
          factualErrors: [{ claim: 'GA4 liczy sesje jak Universal Analytics', correction: 'GA4 opiera się na zdarzeniach.', whereToCheck: 'dokumentacja Google Analytics' }],
          companyChecks: [],
          facts: [{ topic: 'Raporty GA4', answer: 'Co tydzień dla działu marketingu', added: false }],
        },
      ],
    });
    api.answerMock.mockResolvedValue(view(answered));
    api.addMockFact.mockResolvedValue(view(answered));

    render(<MockInterviewCard pid="p1" app={app} run={run} />);
    expect(await screen.findByText('Proszę opowiedzieć o raportach.')).toBeTruthy();
    expect(screen.getByText(/Czym zajmuje się dział marketingu/)).toBeTruthy();

    const send = screen.getByRole('button', { name: 'Wyślij odpowiedź' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Twoja odpowiedź'), { target: { value: 'Robiłam raporty w GA4.' } });
    fireEvent.click(send);
    await waitFor(() => expect(api.answerMock).toHaveBeenCalledWith('p1', 'a1', 'Robiłam raporty w GA4.'));

    const grade = await screen.findByLabelText('Ocena odpowiedzi');
    expect(within(grade).getByText('Ocena: 3/5')).toBeTruthy();
    expect(within(grade).getByText('[ile raportów miesięcznie]').tagName).toBe('MARK');
    expect(within(grade).getByText(/GA4 opiera się na zdarzeniach/)).toBeTruthy();
    expect(screen.getByText('Jak radzi sobie Pan z brakiem Google Ads?')).toBeTruthy();
    // Pole odpowiedzi jest puste dla następnego pytania.
    expect((screen.getByLabelText('Twoja odpowiedź') as HTMLTextAreaElement).value).toBe('');

    expect(api.addMockFact).not.toHaveBeenCalled();
    fireEvent.click(within(grade).getByRole('button', { name: 'Dopisz do profilu' }));
    await waitFor(() => expect(api.addMockFact).toHaveBeenCalledWith('p1', 'a1', 'a1', 0));
  });

  it('pominięcie pytania i ponowienie oceny, gdy wcześniej się nie udała', async () => {
    api.mock.mockResolvedValue(view(interview()));
    api.skipMock.mockResolvedValue(view(interview()));
    render(<MockInterviewCard pid="p1" app={app} run={run} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pomiń pytanie' }));
    await waitFor(() => expect(api.skipMock).toHaveBeenCalledWith('p1', 'a1'));
    cleanup();

    const failed = interview({ turns: [question('q1', 'Proszę opowiedzieć o raportach.'), { id: 'a1', role: 'candidate', kind: 'answer', questionId: 'q1', content: 'Odpowiedź', at }] });
    api.mock.mockResolvedValue(view(failed));
    api.answerMock.mockResolvedValue(view(failed));
    render(<MockInterviewCard pid="p1" app={app} run={run} />);
    expect(await screen.findByText('Odpowiedź jest zapisana, ale ocena się nie udała.')).toBeTruthy();
    expect(screen.queryByLabelText('Twoja odpowiedź')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Oceń ponownie' }));
    await waitFor(() => expect(api.answerMock).toHaveBeenCalledWith('p1', 'a1', ''));
  });
});
