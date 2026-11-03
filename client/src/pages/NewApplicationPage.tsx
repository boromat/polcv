import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../ctx';
import { Busy, ErrorBox, Field } from '../components/ui';

export function NewApplicationPage() {
  const { current } = useApp();
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!current) return null;
  const profileEmpty = !current.experience.length && !current.education.length && !current.skills.length;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const app = await api.createApplication(current.id, url, showText ? text : '');
      nav(`/app/${app.id}`);
    } catch (e: any) {
      setError(e.message);
      // Gdy link nie działa, od razu pokazujemy pole na wklejenie tekstu.
      if (!showText) setShowText(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      {busy && <Busy message="Pobieram i analizuję ogłoszenie…" hint="Wyciągam wymagania, słowa kluczowe ATS i informacje o klauzuli RODO." />}
      <div className="page-head">
        <div>
          <h1>Nowe CV pod ogłoszenie</h1>
          <p className="sub">Wklej link do oferty z pracuj.pl, justjoin.it, nofluffjobs albo innej strony.</p>
        </div>
      </div>
      <div className="stack lg">
        {profileEmpty && (
          <div className="callout warn">
            Twój profil jest pusty, więc AI nie będzie miało z czego pisać CV. <Link to="/profile">Najpierw wgraj swoje CV w profilu.</Link>
          </div>
        )}
        <ErrorBox error={error} onClose={() => setError(null)} />
        <div className="card stack">
          <Field label="Link do ogłoszenia">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.pracuj.pl/praca/…" autoFocus />
          </Field>
          {!showText ? (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowText(true)}>
              Link nie działa? Wklej treść ogłoszenia
            </button>
          ) : (
            <Field label="Treść ogłoszenia" hint="Zaznacz całe ogłoszenie na stronie (Ctrl+A), skopiuj (Ctrl+C) i wklej tutaj (Ctrl+V). Jeśli wkleisz tekst, link jest tylko do zapamiętania.">
              <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Wklej tutaj treść ogłoszenia…" />
            </Field>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary lg" disabled={busy || (!url.trim() && !text.trim())} onClick={start}>
              Analizuj ogłoszenie →
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Co będzie dalej</h3>
          <ol className="muted" style={{ margin: '10px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>AI wyciągnie z ogłoszenia wymagania i słowa kluczowe, których szuka system ATS.</li>
            <li>Porówna je z Twoim profilem i zapyta o to, czego w nim brakuje.</li>
            <li>Napisze CV pod to ogłoszenie — odważniejsze sformułowania zaznaczy na żółto do Twojej decyzji.</li>
            <li>Oceni CV tak, jak ATS i AI-rekruter, i zaproponuje poprawki.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
