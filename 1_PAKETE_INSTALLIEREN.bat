@echo off
cd /d "%~dp0"
echo ==============================================
echo   Pakete sauber installieren
echo ==============================================
echo.
echo Wichtig: Das kann beim ersten Mal einige Minuten dauern.
echo Electron wird dabei komplett heruntergeladen.
echo.

if exist node_modules\electron (
  echo Alte/beschaedigte Electron-Installation wird entfernt ...
  rmdir /s /q node_modules\electron
)

call npm config set fetch-retries 5
call npm config set fetch-retry-mintimeout 20000
call npm config set fetch-retry-maxtimeout 120000

echo.
echo Starte npm install ...
call npm install --include=dev
if errorlevel 1 (
  echo.
  echo FEHLER: npm install ist fehlgeschlagen.
  echo Bitte die letzten roten Fehlerzeilen kopieren und an ChatGPT senden.
  echo.
  pause
  exit /b 1
)

echo.
echo Pruefe Electron ...
if exist node_modules\electron\dist\electron.exe (
  echo Electron wurde korrekt installiert.
  echo.
  pause
  exit /b 0
)

echo Electron-Datei fehlt noch. Starte Electron-Nachinstallation ...
if exist node_modules\electron\install.js (
  call node node_modules\electron\install.js
)

if exist node_modules\electron\dist\electron.exe (
  echo.
  echo Fertig: Electron wurde repariert.
  echo.
  pause
  exit /b 0
)

echo.
echo FEHLER: Electron konnte nicht vollstaendig installiert werden.
echo Bitte pruefe Internet/Firewall/Antivirus und starte danach:
echo 1_ELECTRON_REPARIEREN.bat
echo.
pause
exit /b 1
