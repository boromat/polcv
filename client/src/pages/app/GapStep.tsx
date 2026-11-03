import { useState } from 'react';
import type { Application, GapAnswer, TemplateId } from '../../../../shared/schemas';
import { Field, TEMPLATES } from '../../components/ui';
import { useT } from '../../i18n';

export function GapStep({
  app,
  onGenerate,
}: {
  app: Application;
  onGenerate: (answers: GapAnswer[], opts: { language?: 'pl' | 'en'; template: TemplateId }) => void;
}) {
  const { t } = useT();
  const questions = app.gap?.questions ?? [];
  // Zapisane odpowiedzi (np. po odświeżeniu strony w trakcie pisania CV) wracają do formularza, żeby nie wpisywać ich drugi raz.
  const [answers, setAnswers] = useState<Record<string, { has: boolean | null; answer: string }>>(() => {
    const saved = new Map((app.gap?.answers ?? []).map((a) => [a.questionId, a]));
    return Object.fromEntries(
      questions.map((q) => {
        const a = saved.get(q.id);
        return [q.id, a ? { has: a.has, answer: a.answer } : { has: null, answer: '' }];
      }),
    );
  });
  const [language, setLanguage] = useState<'' | 'pl' | 'en'>('');
  const [template, setTemplate] = useState<TemplateId>('modern');
  const posting = app.posting!;
  const autoLang = posting.cvLanguageRequired !== 'any' ? posting.cvLanguageRequired : posting.language;

  const set = (id: string, patch: Partial<{ has: boolean | null; answer: string }>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  const submit = () => {
    const list: GapAnswer[] = questions
      .filter((q) => answers[q.id]?.has !== null)
      .map((q) => ({ questionId: q.id, requirement: q.requirement, question: q.question, has: !!answers[q.id].has, answer: answers[q.id].answer }));
    onGenerate(list, { language: language || undefined, template });
  };

  const missingDetail = questions.some((q) => answers[q.id]?.has === true && !answers[q.id].answer.trim());

  return (
    <div className="gap-layout">
      <div className="stack lg">
        <div className="card">
          <h2>{t('Kilka pytań, zanim napiszę CV')}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {t('Ogłoszenie wymaga rzeczy, których nie ma w Twoim profilu. Jeśli coś znasz - napisz krótko, gdzie i w jaki sposób, a trafi to do CV.')}{' '}
            {t('Odpowiedzi zapiszą się w profilu, więc przy kolejnych ogłoszeniach nie będę pytać ponownie. Możesz też pominąć pytanie.')}
          </p>
        </div>
        {questions.length === 0 && (
          <div className="callout good">{t('Twój profil pokrywa wymagania z ogłoszenia - nie mam dodatkowych pytań.')}</div>
        )}
        {questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <div key={q.id} className="card stack">
              <div className="row between">
                <span className="faint">{t('Pytanie {n} z {total}', { n: i + 1, total: questions.length })}</span>
                <span className={`badge ${q.importance === 'must' ? 'bad' : 'warn'}`}>{q.importance === 'must' ? t('wymagane') : t('mile widziane')}</span>
              </div>
              <div className={`requirement ${q.importance}`}>{q.requirement}</div>
              <h3>{q.question}</h3>
              <div className="row">
                <label className="check">
                  <input type="radio" name={q.id} checked={a?.has === true} onChange={() => set(q.id, { has: true })} /> {t('Tak, znam to')}
                </label>
                <label className="check">
                  <input type="radio" name={q.id} checked={a?.has === false} onChange={() => set(q.id, { has: false })} /> {t('Nie znam')}
                </label>
                {a?.has !== null && (
                  <button className="btn ghost sm" onClick={() => set(q.id, { has: null, answer: '' })}>
                    {t('Pomiń')}
                  </button>
                )}
              </div>
              {a?.has === true && (
                <Field label={t('Gdzie i co konkretnie?')} hint={q.hint}>
                  {/* Fokus tylko na świeżo otwartym polu, nie na wczytanych odpowiedziach. */}
                  <textarea rows={3} value={a.answer} onChange={(e) => set(q.id, { answer: e.target.value })} autoFocus={!a.answer} />
                </Field>
              )}
            </div>
          );
        })}

        <div className="card stack">
          <h3>{t('Ustawienia CV')}</h3>
          <div className="grid2">
            <Field label={t('Język CV')} hint={t('Automatycznie: {language} (wg ogłoszenia).', { language: autoLang === 'pl' ? t('polski') : t('angielski') })}>
              <select value={language} onChange={(e) => setLanguage(e.target.value as '' | 'pl' | 'en')}>
                <option value="">{t('Automatycznie')}</option>
                <option value="pl">{t('Polski')}</option>
                <option value="en">{t('Angielski')}</option>
              </select>
            </Field>
            <Field label={t('Szablon')} hint={t('Wszystkie są bezpieczne dla ATS. Zmienisz go też później.')}>
              <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
                {TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {t(tpl.name)} - {t(tpl.desc)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {missingDetail && <div className="callout warn small">{t('Przy odpowiedziach „Tak” dopisz krótko szczegóły - bez nich AI nie będzie miało czego wpisać do CV.')}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary lg" onClick={submit}>
              {t('Napisz CV')} →
            </button>
          </div>
        </div>
      </div>

      <div className="card stack side">
        <h3>{t('Ogłoszenie w skrócie')}</h3>
        <p className="small">{posting.summary}</p>
        {app.gap && app.gap.covered.length > 0 && (
          <div>
            <b className="small">{t('Masz w profilu:')}</b>
            <div className="chips" style={{ marginTop: 6 }}>
              {app.gap.covered.map((c) => (
                <span key={c} className="badge good">✓ {c}</span>
              ))}
            </div>
          </div>
        )}
        <div>
          <b className="small">{t('Słowa kluczowe ATS:')}</b>
          <div className="chips" style={{ marginTop: 6 }}>
            {posting.keywords.map((k) => (
              <span key={k.term} className={`badge ${k.importance === 'must' ? 'accent' : ''}`}>{k.term}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
