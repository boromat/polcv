import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { EN } from './i18n/en';

/**
 * Tłumaczenia interfejsu. Kluczem jest polski tekst, więc kod nadal czyta się po polsku:
 * t('Nowe CV') daje "Nowe CV" albo "New CV". Wstawki w klamrach: t('Sprawdzono {n} ofert', { n }).
 * Test tests/i18n.test.ts pilnuje, żeby każdy t('…') miał angielski odpowiednik.
 */

export type Lang = 'pl' | 'en';
type Params = Record<string, string | number>;

const KEY = 'polcv.lang';

function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'pl';
  } catch {
    return 'pl';
  }
}

let current: Lang = readLang();
if (typeof document !== 'undefined') document.documentElement.lang = current;

/** Język interfejsu poza komponentami (zapytania do serwera, formatowanie dat). */
export const getLang = (): Lang => current;

/** Polska odmiana liczebników: 2-4 (oprócz 12-14) bierze formę "strony", reszta "stron". */
export const plFew = (n: number) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20);

export function translate(text: string, params?: Params): string {
  const base = current === 'en' ? (EN[text] ?? text) : text;
  return params ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : base;
}

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* bez localStorage wybór żyje do odświeżenia strony */
    }
    document.documentElement.lang = l;
    setLangState(l);
  }, []);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useT() {
  const { lang, setLang } = useContext(LangCtx);
  // `lang` w zależnościach: zmiana języka daje nową funkcję t i odświeża komponenty.
  const t = useCallback((text: string, params?: Params) => translate(text, params), [lang]);
  return { t, lang, setLang };
}
