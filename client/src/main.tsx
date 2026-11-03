import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles.css';
import { AppProvider, useApp } from './ctx';
import { LangProvider, useT } from './i18n';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfilePage } from './pages/ProfilePage';
import { NewApplicationPage } from './pages/NewApplicationPage';
import { ApplicationPage } from './pages/ApplicationPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { CareerPage } from './pages/CareerPage';

function Shell({ children }: { children: ReactNode }) {
  const { current, profiles, select, settings } = useApp();
  const { t, lang, setLang } = useT();
  const nav = useNavigate();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-logo">CV</span> PolCV
        </Link>
        {current && (
          <nav className="nav">
            <NavLink to="/career">{t('Szukaj pracy')}</NavLink>
            <NavLink to="/new">{t('Nowe CV')}</NavLink>
            <NavLink to="/history">{t('Historia')}</NavLink>
            <NavLink to="/profile">{t('Mój profil')}</NavLink>
            <NavLink to="/settings">{t('Ustawienia')}</NavLink>
          </nav>
        )}
        <div className="spacer" />
        <div className="lang-switch" role="group" aria-label={t('Język interfejsu')}>
          {(['pl', 'en'] as const).map((l) => (
            <button key={l} className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {current && (
          <div className="profile-switch">
            <span className="faint">{t('Profil:')}</span>
            <select
              value={current.id}
              aria-label={t('Wybierz profil')}
              onChange={(e) => {
                if (e.target.value === '__manage') nav('/profiles');
                else {
                  select(e.target.value);
                  nav('/history');
                }
              }}
              style={{ width: 'auto' }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
              <option value="__manage">{t('Zarządzaj profilami…')}</option>
            </select>
          </div>
        )}
      </header>
      {settings && !settings.hasKey && current && !current.apiKey && (
        <div className="container" style={{ paddingBottom: 0 }}>
          <div className="callout warn">
            <b>{t('Brak klucza OpenRouter.')}</b> {t('Bez niego AI nie zadziała.')} <Link to="/settings">{t('Przejdź do Ustawień')}</Link>{t(', żeby go wkleić.')}
          </div>
        </div>
      )}
      {children}
    </>
  );
}

function RequireProfile({ children }: { children: ReactNode }) {
  const { current, loading } = useApp();
  if (loading) return null;
  if (!current) return <Navigate to="/profiles" replace />;
  return <>{children}</>;
}

function App() {
  const { loading, current } = useApp();
  if (loading) return null;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to={current ? '/history' : '/profiles'} replace />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/profile" element={<RequireProfile><ProfilePage /></RequireProfile>} />
        <Route path="/career" element={<RequireProfile><CareerPage /></RequireProfile>} />
        <Route path="/new" element={<RequireProfile><NewApplicationPage /></RequireProfile>} />
        <Route path="/history" element={<RequireProfile><HistoryPage /></RequireProfile>} />
        <Route path="/app/:aid" element={<RequireProfile><ApplicationPage /></RequireProfile>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </LangProvider>
  </StrictMode>,
);
