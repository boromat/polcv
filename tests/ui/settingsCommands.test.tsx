// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolanonStatus, SettingsView, UpdateStatus } from '../../client/src/api';

// Ustawienia mogą uruchomić programy na komputerze (pip, git, npm). Okno potwierdzenia ma pokazać dokładne komendy,
// a serwer dostaje tylko te komendy, które kandydat zobaczył (pole "confirmed"); serwer uruchamia wyłącznie je.

const { api, settings } = vi.hoisted(() => {
  const settings: SettingsView = {
    apiKeyMasked: 'sk-or-…test',
    hasKey: true,
    keyFromEnv: false,
    mainModel: 'test/main',
    fastModel: 'test/fast',
    jobSearch: false,
    maskPii: false,
    maskPiiNer: false,
    pythonPath: '',
    searchPortals: ['nofluffjobs'],
  };
  return {
    settings,
    api: {
      models: vi.fn(async () => []),
      usage: vi.fn(async () => null),
      checkKey: vi.fn(),
      saveSettings: vi.fn(),
      polanonStatus: vi.fn(),
      installPolanon: vi.fn(),
      installNer: vi.fn(),
      updateStatus: vi.fn(),
      updatePolcv: vi.fn(),
    },
  };
});

vi.mock('../../client/src/api', () => ({ api }));
vi.mock('../../client/src/ctx', () => ({ useApp: () => ({ settings, reloadSettings: async () => {} }) }));

const { SettingsPage } = await import('../../client/src/pages/SettingsPage');

const PIP = ['C:\\Python312\\python.exe -m pip install --upgrade polanon'];
const NER = ['C:\\Python312\\python.exe -m pip install --upgrade "polanon[ner]"', 'C:\\Python312\\python.exe -m spacy download pl_core_news_md'];
const UPDATE = ['git pull --ff-only', 'npm install', 'npm run build'];

const polanon = (over: Partial<PolanonStatus> = {}): PolanonStatus => ({
  python: '3.12.4',
  command: 'C:\\Python312\\python.exe',
  polanon: null,
  spacy: false,
  model: false,
  error: '',
  installCommands: { polanon: PIP, ner: NER },
  ...over,
});
const update: UpdateStatus = { current: '1.2.0', latest: '1.3.0', updateAvailable: true, canSelfUpdate: true, releasesUrl: 'https://example.com/releases', commands: UPDATE };

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  api.polanonStatus.mockResolvedValue(polanon());
  api.updateStatus.mockResolvedValue({ ...update, updateAvailable: false });
  confirmSpy = vi.spyOn(window, 'confirm');
});
afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
});

describe('Ustawienia: potwierdzenie komend', () => {
  it('instalacja polanonu: okno pokazuje dokładną komendę, a serwer dostaje ją jako potwierdzoną', async () => {
    api.installPolanon.mockResolvedValue({ ok: true, output: '', status: polanon({ polanon: '0.2.0' }) });
    confirmSpy.mockReturnValue(true);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Zainstaluj polanon' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain(`Program uruchomi: ${PIP[0]}`);
    await waitFor(() => expect(api.installPolanon).toHaveBeenCalledWith(PIP));
  });

  it('odmowa w oknie: nic nie trafia do serwera', async () => {
    confirmSpy.mockReturnValue(false);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Zainstaluj polanon' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.installPolanon).not.toHaveBeenCalled();
  });

  it('model spaCy: okno pokazuje obie komendy po kolei, a serwer dostaje dokładnie te dwie', async () => {
    api.polanonStatus.mockResolvedValue(polanon({ polanon: '0.2.0' }));
    api.installNer.mockResolvedValue({ ok: true, output: '', status: polanon({ polanon: '0.2.0', spacy: true, model: true }) });
    confirmSpy.mockReturnValue(true);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Zainstaluj model spaCy' }));
    expect(confirmSpy.mock.calls[0][0]).toContain(`Program uruchomi: ${NER.join('\n')}`);
    await waitFor(() => expect(api.installNer).toHaveBeenCalledWith(NER));
  });

  it('aktualizacja PolCV: okno pokazuje git pull, npm install i build, a serwer dostaje te komendy', async () => {
    api.updateStatus.mockResolvedValue(update);
    api.updatePolcv.mockResolvedValue({ ok: true, output: '', version: '1.3.0' });
    confirmSpy.mockReturnValue(true);
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Zaktualizuj PolCV do 1.3.0' }));
    const message = String(confirmSpy.mock.calls[0][0]);
    expect(message).toContain('Zaktualizować PolCV do wersji 1.3.0?');
    expect(message).toContain(`Program uruchomi: ${UPDATE.join('\n')}`);
    await waitFor(() => expect(api.updatePolcv).toHaveBeenCalledWith(UPDATE));
  });
});
