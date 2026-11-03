/** Wszystkie teksty w strukturze JSON, w stałej kolejności (tej samej co w replaceStrings). */
export function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
}

export function replaceStrings<T>(value: T, next: Iterator<string>): T {
  if (typeof value === 'string') return next.next().value as T;
  if (Array.isArray(value)) return value.map((v) => replaceStrings(v, next)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceStrings(v, next)])) as T;
  }
  return value;
}

/**
 * Długi myślnik (—) to dziś typowy ślad tekstu pisanego przez AI, a rekruterzy zaczęli go zauważać.
 * W tekstach od modelu zamieniamy go na zwykły myślnik, którego ludzie faktycznie używają.
 */
export function plainDashes<T>(value: T): T {
  const texts: string[] = [];
  collectStrings(value, texts);
  return replaceStrings(value, texts.map((t) => t.replace(/[ \t]*—[ \t]*/g, ' - '))[Symbol.iterator]());
}
