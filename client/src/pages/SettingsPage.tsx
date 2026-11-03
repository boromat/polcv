import { useEffect, useMemo, useState } from 'react';
import { api, type ModelInfo, type PolanonStatus, type SettingsPatch, type SettingsView, type UsageView } from '../api';
import { useApp } from '../ctx';
import { ErrorBox, Field, usd } from '../components/ui';

function ModelSelect({ value, models, onChange }: { value: string; models: ModelInfo[]; onChange: (v: string) => void }) {
  const sorted = useMemo(() => [...models].sort((a, b) => a.id.localeCompare(b.id)), [models]);
  const inList = models.some((m) => m.id === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!inList && <option value={value}>{value} (niedostępny na liście)</option>}
      {sorted.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id} — {m.promptPrice.toFixed(2)} $ / {m.completionPrice.toFixed(2)} $ za 1M tokenów
        </option>
      ))}
    </select>
  );
}

function JobSearchCard({ settings, onSave }: { settings: SettingsView; onSave: (p: SettingsPatch) => void }) {
  const enable = () => {
    const ok = confirm(
      'Włączyć automatyczne wyszukiwanie ofert?\n\n' +
        'Program będzie sam wysyłał zapytania do portali (kilka–kilkanaście na stanowisko). Korzystasz z tego na własną odpowiedzialność: ' +
        'tylko na własny użytek i zgodnie z regulaminami portali. W każdej chwili możesz to wyłączyć.',
    );
    if (ok) onSave({ jobSearch: true });
  };
  return (
    <div className="card stack">
      <div className="row between">
        <h2>Wyszukiwanie ofert</h2>
        <span className={`badge ${settings.jobSearch ? 'good' : ''}`}>{settings.jobSearch ? 'włączone' : 'wyłączone'}</span>
      </div>
      <p className="muted small">
        W zakładce <i>Szukaj pracy</i> przy każdym proponowanym stanowisku są linki do wyszukiwarek portali — otwierasz je sam w przeglądarce. Po włączeniu
        tej opcji program dodatkowo sam przeszukuje portale ({settings.searchPortals.join(', ')}), odrzuca oferty niepasujące do Twoich preferencji i ocenia
        resztę przez AI.
      </p>
      {settings.jobSearch ? (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onSave({ jobSearch: false })}>
          Wyłącz wyszukiwanie
        </button>
      ) : (
        <>
          <div className="callout warn small">
            Portale z ofertami zwykle ograniczają w regulaminach automatyczne pobieranie danych. Program pyta tylko tam, gdzie pozwala na to plik robots.txt, i
            przedstawia się jako PolCV, ale za korzystanie odpowiadasz Ty.
            {settings.localPortals.length > 0 && (
              <> Ta kopia ma też lokalne dodatki ({settings.localPortals.join(', ')}), które tych zasad nie spełniają.</>
            )}
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={enable}>
            Włącz wyszukiwanie
          </button>
        </>
      )}
    </div>
  );
}

function PrivacyCard({ settings, onSave }: { settings: SettingsView; onSave: (p: SettingsPatch) => Promise<void> }) {
  const [status, setStatus] = useState<PolanonStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<{ ok: boolean; output: string } | null>(null);
  const [pythonPath, setPythonPath] = useState(settings.pythonPath);

  const refresh = () => {
    setStatus(null);
    api.polanonStatus().then(setStatus).catch(() => setStatus({ python: null, command: null, polanon: null, spacy: false, model: false, error: 'Nie udało się sprawdzić.' }));
  };
  useEffect(refresh, []);

  const install = async () => {
    if (!confirm(`Zainstalować polanon z PyPI?\n\nProgram uruchomi: ${status?.command} -m pip install --upgrade polanon`)) return;
    setInstalling(true);
    setInstallLog(null);
    try {
      const r = await api.installPolanon();
      setInstallLog(r);
      setStatus(r.status);
    } catch (e: any) {
      setInstallLog({ ok: false, output: e.message });
    } finally {
      setInstalling(false);
    }
  };

  const savePath = async () => {
    if (pythonPath.trim() === settings.pythonPath) return;
    await onSave({ pythonPath });
    refresh();
  };

  const cmd = status?.command ?? 'python';
  const broken = settings.maskPii && status && !status.polanon;
  return (
    <div className="card stack">
      <div className="row between">
        <h2>Ochrona danych osobowych (polanon)</h2>
        <span className="badge">opcjonalne</span>
      </div>
      <p className="muted small">
        <a href="https://github.com/boromat/polanon" target="_blank" rel="noreferrer">polanon</a> to osobny, darmowy pakiet Pythona. Zanim tekst trafi do AI, zamienia
        imię i nazwisko, e-mail, telefon, adres czy nazwy firm na tokeny (np. <code>&lt;OSOBA_1&gt;</code>), a w odpowiedzi wstawia prawdziwe wartości z
        powrotem. Działa na Twoim komputerze — model AI widzi tylko tokeny. Bez polanonu PolCV działa normalnie.
      </p>
      {broken && (
        <div className="callout error small">
          Maskowanie jest włączone, ale polanon nie działa — AI nie dostanie żadnych danych, dopóki tego nie naprawisz albo nie wyłączysz maskowania.
        </div>
      )}
      {!status ? (
        <p className="faint">Sprawdzam, czy polanon jest zainstalowany…</p>
      ) : !status.python ? (
        <div className="callout info small">
          {status.error} Żeby korzystać z polanonu, zainstaluj Pythona 3.11+ z{' '}
          <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">python.org</a> (zaznacz „Add python.exe to PATH”) i kliknij{' '}
          <button className="btn ghost sm" onClick={refresh}>Sprawdź ponownie</button>
        </div>
      ) : !status.polanon ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="callout info small">
            Python {status.python} jest (<code>{status.command}</code>), ale polanon nie jest zainstalowany. Zainstaluj go przyciskiem albo sam poleceniem{' '}
            <code>{cmd} -m pip install polanon</code>.
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={install} disabled={installing}>
            {installing ? 'Instaluję… (do minuty)' : 'Zainstaluj polanon'}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="badge good">polanon {status.polanon}</span>
            <span className="badge">Python {status.python}</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.maskPii} onChange={(e) => onSave({ maskPii: e.target.checked })} /> Maskuj dane osobowe przed wysłaniem do AI
          </label>
          <label className="check" style={{ opacity: status.spacy && status.model ? 1 : 0.6 }}>
            <input
              type="checkbox"
              checked={settings.maskPiiNer}
              disabled={!settings.maskPii || !(status.spacy && status.model)}
              onChange={(e) => onSave({ maskPiiNer: e.target.checked })}
            />{' '}
            Rozpoznawaj też miejsca i inne nazwy (model spaCy, dokładniej, ale wolniej)
          </label>
          {!(status.spacy && status.model) && (
            <p className="faint small">
              Model spaCy instalujesz sam: <code>{cmd} -m pip install "polanon[ner]"</code>, potem <code>{cmd} -m spacy download pl_core_news_md</code>.
            </p>
          )}
          <p className="faint small">
            To pseudonimizacja, a nie pełna anonimizacja — nie każdy szczegół da się wykryć (np. nazwa uczelni bez modelu spaCy zostaje czytelna).
          </p>
        </div>
      )}
      {installLog && <div className={`callout small ${installLog.ok ? 'good' : 'error'}`}>{installLog.ok ? 'Zainstalowano polanon.' : <pre className="pre" style={{ margin: 0 }}>{installLog.output}</pre>}</div>}
      <details className="small">
        <summary className="muted">Inny Python</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input value={pythonPath} onChange={(e) => setPythonPath(e.target.value)} onBlur={savePath} placeholder="np. C:\Python312\python.exe (puste = wykryj automatycznie)" style={{ flex: 1, minWidth: 220 }} />
        </div>
      </details>
    </div>
  );
}

export function SettingsPage() {
  const { settings, reloadSettings } = useApp();
  const [key, setKey] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.models().then(setModels).catch(() => setError('Nie udało się pobrać listy modeli z OpenRouter (brak internetu?).'));
    api.usage().then(setUsage).catch(() => {});
  }, []);

  if (!settings) return null;

  const saveKey = async () => {
    setError(null);
    setCheck(null);
    try {
      const res = await api.checkKey(key.trim());
      setCheck(res);
      if (!res.ok) return;
      await api.saveSettings({ apiKey: key.trim() });
      setKey('');
      await reloadSettings();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async (patch: SettingsPatch) => {
    try {
      await api.saveSettings(patch);
      await reloadSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Ustawienia</h1>
          <p className="sub">Ustawienia są wspólne dla wszystkich profili (profil może mieć własny klucz OpenRouter).</p>
        </div>
        {saved && <span className="badge good">zapisano</span>}
      </div>
      <div className="stack lg">
        <ErrorBox error={error} onClose={() => setError(null)} />

        <div className="card stack">
          <h2>Klucz OpenRouter</h2>
          {settings.hasKey ? (
            <div className="callout good">
              Klucz zapisany: <code>{settings.apiKeyMasked}</code>{' '}
              <button className="btn ghost sm" onClick={async () => setCheck(await api.checkKey())}>
                Sprawdź
              </button>
            </div>
          ) : (
            <div className="callout info">
              <b>Jak zdobyć klucz:</b> wejdź na <a href="https://openrouter.ai" target="_blank" rel="noreferrer">openrouter.ai</a>, załóż konto, doładuj je w zakładce <i>Credits</i> (np. 5–10 $ wystarczy na kilkadziesiąt CV), a potem w zakładce <i>Keys</i> kliknij <i>Create Key</i>, skopiuj klucz i wklej go poniżej.
            </div>
          )}
          <div className="row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={settings.hasKey ? 'Wklej nowy klucz, żeby go zmienić' : 'sk-or-v1-…'} style={{ flex: 1, minWidth: 220 }} autoComplete="off" />
            <button className="btn primary" disabled={!key.trim()} onClick={saveKey}>
              Sprawdź i zapisz
            </button>
          </div>
          {check && <div className={`callout ${check.ok ? 'good' : 'error'}`}>{check.message}</div>}
        </div>

        <div className="card stack">
          <h2>Modele AI</h2>
          <p className="muted small">
            Model główny pisze i ocenia CV (tu liczy się jakość). Model szybki tylko wyciąga dane z ogłoszeń i CV (może być tani). Ceny podane są za milion tokenów: wejście / wyjście. Jedno CV z oceną to zwykle kilka–kilkanaście centów.
          </p>
          <Field label="Model główny (pisanie i ocena CV)">
            <ModelSelect value={settings.mainModel} models={models} onChange={(mainModel) => save({ mainModel })} />
          </Field>
          <Field label="Model szybki (analiza ogłoszeń i import CV)">
            <ModelSelect value={settings.fastModel} models={models} onChange={(fastModel) => save({ fastModel })} />
          </Field>
        </div>

        <JobSearchCard settings={settings} onSave={save} />
        <PrivacyCard settings={settings} onSave={save} />

        <div className="card stack">
          <h2>Wydatki na AI</h2>
          {!usage || usage.calls === 0 ? (
            <p className="faint">Jeszcze nic nie wydano.</p>
          ) : (
            <>
              <p>
                Łącznie <b>{usd(usage.total)}</b> w {usage.calls} wywołaniach AI.
              </p>
              <div className="grid2">
                <div>
                  <h3>Według profilu</h3>
                  <ul className="check-list" style={{ marginTop: 8 }}>
                    {Object.entries(usage.byProfile).map(([k, v]) => (
                      <li key={k} className="row between"><span>{k}</span><b>{usd(v)}</b></li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Według zadania</h3>
                  <ul className="check-list" style={{ marginTop: 8 }}>
                    {Object.entries(usage.byTask).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                      <li key={k} className="row between"><span>{k}</span><b>{usd(v)}</b></li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
