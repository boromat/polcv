import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
} as any);
