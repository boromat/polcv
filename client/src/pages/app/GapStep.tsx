import { useState } from 'react';
import type { Application, GapAnswer, TemplateId } from '../../../../shared/schemas';
import { Field, TEMPLATES } from '../../components/ui';

export function GapStep({
  app,
  onGenerate,
}: {
  app: Application;
  onGenerate: (answers: GapAnswer[], opts: { language?: 'pl' | 'en'; template: TemplateId }) => void;
}) {
  const questions = app.gap?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, { has: boolean | null; answer: string }>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { has: null, answer: '' }])),
  );
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
          <h2>Kilka pytań, zanim napiszę CV</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Ogłoszenie wymaga rzeczy, których nie ma w Twoim profilu. Jeśli coś znasz - napisz krótko, gdzie i w jaki sposób, a trafi to do CV.
            Odpowiedzi zapiszą się w profilu, więc przy kolejnych ogłoszeniach nie będę pytać ponownie. Możesz też pominąć pytanie.
          </p>
        </div>
        {questions.length === 0 && (
          <div className="callout good">Twój profil pokrywa wymagania z ogłoszenia - nie mam dodatkowych pytań.</div>
        )}
        {questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <div key={q.id} className="card stack">
              <div className="row between">
                <span className="faint">Pytanie {i + 1} z {questions.length}</span>
                <span className={`badge ${q.importance === 'must' ? 'bad' : 'warn'}`}>{q.importance === 'must' ? 'wymagane' : 'mile widziane'}</span>
              </div>
              <div className={`requirement ${q.importance}`}>{q.requirement}</div>
              <h3>{q.question}</h3>
              <div className="row">
                <label className="check">
                  <input type="radio" name={q.id} checked={a?.has === true} onChange={() => set(q.id, { has: true })} /> Tak, znam to
                </label>
                <label className="check">
                  <input type="radio" name={q.id} checked={a?.has === false} onChange={() => set(q.id, { has: false })} /> Nie znam
                </label>
                {a?.has !== null && (
                  <button className="btn ghost sm" onClick={() => set(q.id, { has: null, answer: '' })}>
                    Pomiń
                  </button>
                )}
              </div>
              {a?.has === true && (
                <Field label="Gdzie i co konkretnie?" hint={q.hint}>
                  <textarea rows={3} value={a.answer} onChange={(e) => set(q.id, { answer: e.target.value })} autoFocus />
                </Field>
              )}
            </div>
          );
        })}

        <div className="card stack">
          <h3>Ustawienia CV</h3>
          <div className="grid2">
            <Field label="Język CV" hint={`Automatycznie: ${autoLang === 'pl' ? 'polski' : 'angielski'} (wg ogłoszenia).`}>
              <select value={language} onChange={(e) => setLanguage(e.target.value as '' | 'pl' | 'en')}>
                <option value="">Automatycznie</option>
                <option value="pl">Polski</option>
                <option value="en">Angielski</option>
              </select>
            </Field>
            <Field label="Szablon" hint="Wszystkie są bezpieczne dla ATS. Zmienisz go też później.">
              <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} - {t.desc}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {missingDetail && <div className="callout warn small">Przy odpowiedziach „Tak” dopisz krótko szczegóły - bez nich AI nie będzie miało czego wpisać do CV.</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary lg" onClick={submit}>
              Napisz CV →
            </button>
          </div>
        </div>
      </div>

      <div className="card stack side">
        <h3>Ogłoszenie w skrócie</h3>
        <p className="small">{posting.summary}</p>
        {app.gap && app.gap.covered.length > 0 && (
          <div>
            <b className="small">Masz w profilu:</b>
            <div className="chips" style={{ marginTop: 6 }}>
              {app.gap.covered.map((c) => (
                <span key={c} className="badge good">✓ {c}</span>
              ))}
            </div>
          </div>
        )}
        <div>
          <b className="small">Słowa kluczowe ATS:</b>
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
