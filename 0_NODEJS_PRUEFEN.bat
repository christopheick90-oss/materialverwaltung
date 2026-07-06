@echo off
cd /d "%~dp0"
echo ==============================================
echo   Node.js Pruefung
echo ==============================================
echo.
node -v
if errorlevel 1 (
  echo.
  echo FEHLER: Node.js wurde nicht gefunden.
  echo Bitte Node.js LTS installieren und danach dieses Fenster neu starten.
  echo.
  pause
  exit /b 1
)
npm -v
if errorlevel 1 (
  echo.
  echo FEHLER: npm wurde nicht gefunden.
  echo Bitte Node.js LTS neu installieren.
  echo.
  pause
  exit /b 1
)
echo.
echo OK: Node.js und npm sind vorhanden.
echo.
pause
