import { readFileSync } from 'node:fs';

/** Wersja programu z package.json - jedno źródło dla serwera i interfejsu (vite.config.ts). */
export const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
