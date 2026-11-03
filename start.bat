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

rem Vite 8 i reszta zaleznosci wymagaja Node.js 22.12 lub nowszego (program jest testowany na Node.js 24).
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a>22||(a===22&&b>=12))process.exit(0);console.log('Masz za stara wersje Node.js ('+process.version+'). PolCV potrzebuje Node.js 22.12 lub nowszego, najlepiej 24 LTS.');process.exit(1)"
if errorlevel 1 (
  echo Pobierz nowa wersje z https://nodejs.org, zainstaluj ja i uruchom ten plik ponownie.
  pause
  exit /b 1
)

rem Znacznik powstaje dopiero po udanej instalacji - po nieudanej albo przerwanej probie instalacja rusza od nowa.
if not exist "node_modules\.polcv-installed" (
  echo Pierwsze uruchomienie: instaluje zaleznosci, to potrwa kilka minut...
  call npm install
  if errorlevel 1 goto :install_error
  call npx playwright install chromium
  if errorlevel 1 goto :install_error
  echo ok>"node_modules\.polcv-installed"
) else (
  rem Gdy Chromium juz jest, to polecenie nic nie pobiera; uzupelnia go, jesli zniknal.
  call npx playwright install chromium
  if errorlevel 1 echo Uwaga: nie udalo sie sprawdzic przegladarki Chromium. PDF moze nie dzialac, reszta programu tak.
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
if errorlevel 1 (
  echo.
  echo PolCV zakonczyl dzialanie z bledem. Przeczytaj komunikat powyzej.
  pause
)
goto :eof

:install_error
echo.
echo Instalacja nie powiodla sie. Sprawdz polaczenie z internetem i uruchom start.bat ponownie:
echo instalacja zacznie sie od nowa. Jesli blad sie powtarza, skopiuj komunikat powyzej i zglos problem.
pause
exit /b 1

:error
echo.
echo Cos poszlo nie tak. Skopiuj komunikat powyzej i zglos problem.
pause
exit /b 1
