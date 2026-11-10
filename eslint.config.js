// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// ESLint z typescript-eslint, bez reguł opartych na typach (typy sprawdza `npm run typecheck`).
// Parser typescript-eslint potrzebuje klasycznego API TypeScriptu, więc pakiet `typescript` to wersja 6.0,
// a sprawdzanie typów robi TypeScript 7 zainstalowany jako `@typescript/native`.
export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'data/', 'coverage/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Nazwy z "_" na początku to celowo pominięte wartości, np. pole wycięte z obiektu.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Dane z zewnątrz (odpowiedzi portali i API, błędy) bywają nieopisane; `any` ograniczamy, ale nie blokuje CI.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
