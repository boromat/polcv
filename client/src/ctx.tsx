import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Profile } from '../../shared/schemas';
import { api, type SettingsView } from './api';

interface AppCtx {
  profiles: Profile[];
  current: Profile | null;
  settings: SettingsView | null;
  loading: boolean;
  select: (id: string | null) => void;
  reloadProfiles: () => Promise<void>;
  reloadSettings: () => Promise<void>;
}

const Ctx = createContext<AppCtx>(null as unknown as AppCtx);

const KEY = 'cvmaker.profile';
const readSaved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(readSaved);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadProfiles = useCallback(async () => setProfiles(await api.profiles()), []);
  const reloadSettings = useCallback(async () => setSettings(await api.settings()), []);

  useEffect(() => {
    Promise.all([reloadProfiles(), reloadSettings()]).finally(() => setLoading(false));
  }, [reloadProfiles, reloadSettings]);

  const select = (id: string | null) => {
    setCurrentId(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* brak dostępu do localStorage - wybór działa do odświeżenia */
    }
  };

  const current = profiles.find((p) => p.id === currentId) ?? null;
  return (
    <Ctx.Provider value={{ profiles, current, settings, loading, select, reloadProfiles, reloadSettings }}>{children}</Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
