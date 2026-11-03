import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import { ErrorBox, fmtDate } from '../components/ui';

export function ProfilesPage() {
  const { profiles, current, select, reloadProfiles } = useApp();
  const { t } = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  const create = async () => {
    try {
      const p = await api.createProfile(name.trim());
      await reloadProfiles();
      select(p.id);
      setName('');
      nav('/profile');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const remove = async (id: string, displayName: string) => {
    if (!confirm(t('Usunąć profil „{name}” razem z historią aplikacji? Tego nie da się cofnąć.', { name: displayName }))) return;
    try {
      await api.deleteProfile(id);
      if (current?.id === id) select(null);
      await reloadProfiles();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>{t('Profile')}</h1>
          <p className="sub">{t('Każda osoba ma swój profil z danymi i historią aplikacji. Profile są zapisane tylko na tym komputerze.')}</p>
        </div>
      </div>
      <div className="stack lg">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {profiles.length > 0 && (
          <div className="card">
            <h2>{t('Wybierz profil')}</h2>
            <div className="stack" style={{ marginTop: 12 }}>
              {profiles.map((p) => (
                <div key={p.id} className="card tight row between" style={{ boxShadow: 'none' }}>
                  <div>
                    <b>{p.displayName}</b> {current?.id === p.id && <span className="badge accent">{t('aktywny')}</span>}
                    <div className="faint">
                      {p.contact.fullName || t('brak danych')} · {t('utworzony {date}', { date: fmtDate(p.createdAt) })}
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn primary sm"
                      onClick={() => {
                        select(p.id);
                        nav('/history');
                      }}
                    >
                      {t('Używaj')}
                    </button>
                    <button className="btn ghost sm danger" onClick={() => remove(p.id, p.displayName)}>
                      {t('Usuń')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="card">
          <h2>{profiles.length ? t('Nowy profil') : t('Zacznij od utworzenia profilu')}</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            {t('Wpisz nazwę (np. swoje imię albo „Kolega”). W następnym kroku wgrasz swoje obecne CV, a AI wypełni profil za Ciebie.')}
          </p>
          <form
            className="row"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
          >
            <input type="text" placeholder={t('Nazwa profilu')} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn primary" disabled={!name.trim()}>
              {t('Utwórz profil')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
