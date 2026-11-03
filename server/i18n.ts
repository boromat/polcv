import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { EN } from './i18n/en';

/**
 * Język interfejsu dla jednego zapytania. Przeglądarka wysyła go w nagłówku X-PolCV-Lang (albo ?lang=
 * w podglądzie i PDF), a komunikaty serwera i teksty od AI dla użytkownika powstają w tym języku.
 * Treść CV dalej idzie za językiem ogłoszenia.
 */

export type Lang = 'pl' | 'en';
type Params = Record<string, string | number>;

const store = new AsyncLocalStorage<Lang>();

export const lang = (): Lang => store.getStore() ?? 'pl';

export function langMiddleware(req: Request, _res: Response, next: NextFunction) {
  const asked = req.get('x-polcv-lang') ?? (typeof req.query.lang === 'string' ? req.query.lang : '');
  store.run(asked === 'en' ? 'en' : 'pl', next);
}

/** Polski tekst albo jego angielski odpowiednik; wartości trafiają w miejsca w klamrach, np. {model}. */
export function tr(text: string, params?: Params): string {
  const base = lang() === 'en' ? (EN[text] ?? text) : text;
  return params ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : base;
}

/** Do testów i skryptów: uruchamia funkcję tak, jakby zapytanie przyszło w danym języku. */
export const withLang = <T,>(l: Lang, fn: () => T): T => store.run(l, fn);
