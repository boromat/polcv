import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Application, ExtraFact, GapAnswer } from '../shared/schemas';
import * as fixtures from './fixtures';

// Osobny, tymczasowy folder danych - store czyta CV_DATA_DIR przy imporcie.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polcv-answers-'));
process.env.CV_DATA_DIR = dir;

const store = await import('../server/storage/store');
const svc = await import('../server/services');
const { withLang, tr } = await import('../server/i18n');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ans = (questionId: string, requirement: string, has: boolean, answer: string): GapAnswer => ({ questionId, requirement, question: `Czy znasz ${requirement}?`, has, answer });

async function setup(extraFacts: ExtraFact[] = []) {
  const profile = await store.saveProfile({ ...structuredClone(fixtures.profile), id: store.newId(), extraFacts });
  const t = store.nowIso();
  const app: Application = {
    id: store.newId(), profileId: profile.id, createdAt: t, updatedAt: t, url: '', rawText: 'x', fetchMethod: 'wklejony tekst',
    posting: structuredClone(fixtures.posting),
    gap: {
      covered: [],
      questions: [
        { id: 'q1', requirement: 'Excel', importance: 'must', question: 'Czy znasz Excel?', hint: '' },
        { id: 'q2', requirement: 'SQL', importance: 'nice', question: 'Czy znasz SQL?', hint: '' },
      ],
      answers: [],
    },
    status: 'szkic', notes: '', currentVersion: 0, pdfFile: '', hasInterviewPrep: false, hasCoverLetter: false,
  };
  await store.saveApplication(app);
  return { pid: profile.id, aid: app.id };
}

const facts = async (pid: string) => (await store.getProfile(pid)).extraFacts;

describe('odpowiedzi na pytania o braki', () => {
  it('ponowne wysłanie tych samych odpowiedzi nie dubluje faktów w profilu', async () => {
    const { pid, aid } = await setup();
    const answers = [ans('q1', 'Excel', true, 'Tabele przestawne na stażu'), ans('q2', 'SQL', false, '')];
    await svc.saveAnswers(pid, aid, answers);
    await svc.saveAnswers(pid, aid, answers);
    await svc.saveAnswers(pid, aid, answers);
    const list = await facts(pid);
    // "Nie" bez opisu nie trafia do profilu (tak jak wcześniej).
    expect(list.map((f) => [f.topic, f.answer])).toEqual([['Excel', 'Tabele przestawne na stażu']]);
    expect(list[0].id).toBe(svc.answerFactId(aid, 'Excel'));
  });

  it('zmieniona odpowiedź podmienia poprzednią w tym samym miejscu listy', async () => {
    const manual: ExtraFact = { id: 'm1', topic: 'Canva', has: true, answer: 'Grafiki na Instagram', source: 'ręcznie', date: '2026-01-01' };
    const { pid, aid } = await setup([manual]);
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Podstawy')]);
    await store.updateProfile(pid, (p) => {
      p.extraFacts.push({ ...manual, id: 'm2', topic: 'Figma' });
    });
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Tabele przestawne i WYSZUKAJ.PIONOWO'), ans('q2', 'SQL', true, 'SELECT i JOIN na studiach')]);
    expect((await facts(pid)).map((f) => `${f.topic}: ${f.answer}`)).toEqual([
      'Canva: Grafiki na Instagram',
      'Excel: Tabele przestawne i WYSZUKAJ.PIONOWO',
      'Figma: Grafiki na Instagram',
      'SQL: SELECT i JOIN na studiach',
    ]);
  });

  it('zmiana na "nie" bez opisu usuwa wcześniejszą odpowiedź', async () => {
    const { pid, aid } = await setup();
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Podstawy')]);
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', false, '')]);
    expect(await facts(pid)).toEqual([]);
  });

  it('to samo wymaganie w innej aplikacji to osobny fakt', async () => {
    const { pid, aid } = await setup();
    const t = store.nowIso();
    const other = await store.saveApplication({ ...(await store.getApplication(pid, aid)), id: store.newId(), createdAt: t });
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Raporty')]);
    await svc.saveAnswers(pid, other.id, [ans('q1', 'Excel', true, 'Raporty')]);
    expect((await facts(pid)).length).toBe(2);
  });

  it('scala kopie zapisane przez starszą wersję (losowe id, to samo źródło i temat)', async () => {
    const posting = fixtures.posting;
    const params = { title: posting.title, company: posting.company };
    const source = (lang: 'pl' | 'en') => withLang(lang, () => tr('Odpowiedź przy aplikacji: {title} – {company}', params).trim());
    const old = (id: string, answer: string, lang: 'pl' | 'en' = 'pl'): ExtraFact => ({ id, topic: 'Excel', has: true, answer, source: source(lang), date: '2026-01-01' });
    const fromChat: ExtraFact = { id: 'c1', topic: 'Excel', has: true, answer: 'Z rozmowy', source: 'Rozmowa z doradcą kariery', date: '2026-01-01' };
    const { pid, aid } = await setup([old('a1', 'stara 1'), fromChat, old('a2', 'stara 2', 'en'), old('a3', 'stara 3')]);
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Nowa')]);
    expect((await facts(pid)).map((f) => [f.id, f.answer])).toEqual([
      [svc.answerFactId(aid, 'Excel'), 'Nowa'],
      ['c1', 'Z rozmowy'],
    ]);
  });

  it('odpowiedzi zostają przy aplikacji, nowsza odpowiedź na pytanie zastępuje starszą', async () => {
    const { pid, aid } = await setup();
    await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Podstawy'), ans('q2', 'SQL', false, '')]);
    const app = await svc.saveAnswers(pid, aid, [ans('q1', 'Excel', true, 'Zaawansowany')]);
    expect(app.gap?.answers.map((a) => [a.questionId, a.has, a.answer])).toEqual([
      ['q2', false, ''],
      ['q1', true, 'Zaawansowany'],
    ]);
    expect(app.gap?.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect((await store.getApplication(pid, aid)).gap?.answers).toEqual(app.gap?.answers);
  });
});
