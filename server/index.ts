import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError, DATA_DIR } from './storage/store';
import { settingsRouter } from './routes/settings';
import { profilesRouter } from './routes/profiles';
import { applicationsRouter } from './routes/applications';
import { careerRouter } from './routes/career';
import { closeBrowser } from './cv/browser';
import { langMiddleware, tr } from './i18n';
import { hostGuard } from './security';

// Jedna nieobsłużona obietnica (np. błąd w tle) nie może wyłączyć całego programu - tylko ją zapisujemy.
process.on('unhandledRejection', (e) => console.error('Nieobsłużony błąd (program działa dalej):', e));

const PORT = Number(process.env.PORT || 3000);
// Domyślnie tylko ten komputer; CV_HOST=0.0.0.0 udostępnia w sieci lokalnej.
const HOST = process.env.CV_HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', langMiddleware);
// Tylko zapytania pod localhost i z tej samej strony - opis w security.ts (CV_HOST, CV_ALLOWED_HOSTS).
app.use('/api', hostGuard);

app.use('/api', settingsRouter, profilesRouter, applicationsRouter, careerRouter);

app.use('/api', (_req, _res, next) => next(new HttpError(404, tr('Nie ma takiego adresu API'))));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err?.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  const message =
    err instanceof HttpError ? err.message : err?.code === 'LIMIT_FILE_SIZE' ? tr('Plik jest za duży (maks. 12 MB).') : tr('Błąd programu: {error}', { error: err?.message ?? String(err) });
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`PolCV działa: ${url}  (dane: ${DATA_DIR})`);
  if (process.env.CV_OPEN_BROWSER === '1') {
    exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
  }
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} jest zajęty - PolCV prawdopodobnie już działa w innym oknie.\n` +
        `Zamknij tamto okno (albo otwórz http://localhost:${PORT}) i uruchom start.bat ponownie.\n`,
    );
    process.exit(1);
  }
  throw e;
});
// Generowanie CV potrafi trwać ponad minutę - nie ucinamy długich zapytań.
server.requestTimeout = 0;
server.headersTimeout = 0;

const shutdown = async () => {
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
