@echo off
cd /d "%~dp0"
echo ==============================================
echo   Electron reparieren
echo ==============================================
echo.
echo Dieser Schritt loescht nur die defekte Electron-Installation
echo und laedt Electron neu herunter.
echo.

if not exist package.json (
  echo FEHLER: package.json wurde nicht gefunden.
  echo Bitte diese Datei im entpackten Hauptordner starten.
  pause
  exit /b 1
)

if exist node_modules\electron (
  echo Loesche node_modules\electron ...
  rmdir /s /q node_modules\electron
)

if exist node_modules\.cache (
  echo Loesche node_modules\.cache ...
  rmdir /s /q node_modules\.cache
)

echo.
echo Installiere Electron neu ...
call npm install electron@31.7.7 --save-dev --include=dev
if errorlevel 1 (
  echo.
  echo Erster Versuch fehlgeschlagen. Versuche komplette npm-Installation ...
  call npm cache verify
  call npm install --include=dev
)

if exist node_modules\electron\install.js (
  echo.
  echo Fuehre Electron install.js aus ...
  call node node_modules\electron\install.js
)

echo.
echo Pruefe Ergebnis ...
if exist node_modules\electron\dist\electron.exe (
  echo OK: Electron ist jetzt vorhanden.
  echo Du kannst jetzt 2_DESKTOP_APP_TESTEN.bat starten.
  echo.
  pause
  exit /b 0
)

echo.
echo FEHLER: Electron ist immer noch nicht vollstaendig vorhanden.
echo Bitte sende die letzten Fehlerzeilen an ChatGPT.
echo.
pause
exit /b 1
