@echo off
cd /d "%~dp0"
echo ==============================================
echo   Eckl Eco Technics - Probeserver starten
echo ==============================================
echo.
echo Dieser PC wird jetzt der Server fuer die Materialverwaltung.
echo Andere PCs verbinden sich mit der IP dieses PCs und Port 4170.
echo.
if not exist node_modules (
  echo Pakete fehlen noch. Bitte zuerst 1_PAKETE_INSTALLIEREN.bat starten.
  echo.
  pause
  exit /b 1
)

echo Alte lokale Server auf Port 4170 werden beendet ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4170" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>nul
)

echo Firewall-Regel fuer Port 4170 wird versucht anzulegen ...
netsh advfirewall firewall add rule name="Eckl Materialverwaltung Port 4170" dir=in action=allow protocol=TCP localport=4170 >nul 2>nul

echo.
echo Server-IP anzeigen:
call 3_SERVER_IP_ANZEIGEN.bat /quiet

echo.
echo Starte Server-Oberflaeche ...
set ECKL_APP_MODE=server
set ECKL_FORCE_PORT=1
set ECKL_SERVER_PORT=4170
call npm run desktop
pause
