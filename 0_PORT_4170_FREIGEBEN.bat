@echo off
chcp 65001 >nul
cls
echo ==============================================
echo   Eckl Eco Technics - Materialverwaltung - Port 4170 freigeben
echo ==============================================
echo.
echo Diese Datei beendet alte lokale Test-Server auf Port 4170.
echo Nutze sie nur, wenn die App meldet: address already in use / EADDRINUSE.
echo.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4170" ^| findstr "LISTENING"') do (
  echo Beende Prozess %%a auf Port 4170 ...
  taskkill /PID %%a /F
)
echo.
echo Fertig. Starte danach 2_DESKTOP_APP_TESTEN.bat erneut.
echo.
pause
