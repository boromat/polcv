@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PolCV

where node >nul 2>nul
if errorlevel 1 (
  echo Nie znaleziono Node.js. Zainstaluj wersje LTS z https://nodejs.org i uruchom ten plik ponownie.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Pierwsze uruchomienie: instaluje zaleznosci, to potrwa kilka minut...
  call npm install
  if errorlevel 1 goto :error
  call npx playwright install chromium
  if errorlevel 1 goto :error
)

echo Buduje interfejs...
call npm run build
if errorlevel 1 goto :error

set CV_OPEN_BROWSER=1
echo.
echo PolCV dziala pod adresem http://localhost:3000
echo Zamknij to okno, aby wylaczyc program.
echo.
call npm start
goto :eof

:error
echo.
echo Cos poszlo nie tak. Skopiuj komunikat powyzej i zglos problem.
pause
