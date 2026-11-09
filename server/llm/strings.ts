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

/** Długa pauza (—) i półpauza (–) jako zwykły myślnik: "a — b" → "a - b", "2–3" → "2-3", "a – b" → "a - b". */
export const plainDashText = (t: string) =>
  t
    .replace(/[ \t]*—[ \t]*/g, ' - ')
    .replace(/(?<=\S)–(?=\S)/g, '-')
    .replace(/[ \t]*–[ \t]*/g, ' - ');

/**
 * Długa pauza (—) i półpauza (–) to dziś typowe ślady tekstu pisanego przez AI, a rekruterzy zaczęli je zauważać.
 * W tekstach od modelu zamieniamy je na zwykły myślnik, którego ludzie faktycznie używają.
 */
export function plainDashes<T>(value: T): T {
  const texts: string[] = [];
  collectStrings(value, texts);
  return replaceStrings(value, texts.map(plainDashText)[Symbol.iterator]());
}

/** Zamykający znak bez pary w tekście - resztka składni JSON ("…i efekty.}"). */
function orphanCloser(s: string, ch: string): boolean {
  if (ch === '}') return !s.includes('{');
  if (ch === ']') return !s.includes('[');
  // Cudzysłów: nieparzysta liczba "; przy „…" albo “…" zostawiamy, bo to może być zamknięcie cytatu.
  return (s.match(/"/g)?.length ?? 0) % 2 === 1 && !/[„“]/.test(s);
}

function cleanTailText(t: string): string {
  let s = t;
  for (;;) {
    const m = /([}\]"])\s*$/.exec(s);
    if (!m || !orphanCloser(s, m[1])) break;
    s = s.slice(0, m.index);
  }
  return s === t ? t : s.trimEnd();
}

/** Usuwa z końca tekstów od modelu zabłąkane "}", "]" i '"', które nie mają otwierającej pary. */
export function cleanTail<T>(value: T): T {
  const texts: string[] = [];
  collectStrings(value, texts);
  return replaceStrings(value, texts.map(cleanTailText)[Symbol.iterator]());
}
