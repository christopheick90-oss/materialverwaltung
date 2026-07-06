@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Server-PORTABLE ohne Node.js bauen
echo ==============================================
echo.
echo Der Ziel-Server-PC braucht danach kein Node.js und kein Electron.
echo Nur dieser Bau-PC braucht Node.js zum Erstellen.
echo.
if not exist node_modules (
  echo Pakete fehlen noch. Bitte zuerst 1_PAKETE_INSTALLIEREN.bat starten.
  pause
  exit /b 1
)
if exist release rmdir /s /q release
call npm run pack:win
if errorlevel 1 pause & exit /b 1
set "EXE_PATH="
for /f "delims=" %%F in ('dir /s /b "release\Eckl Eco Technics - Materialverwaltung.exe" 2^>nul') do set "EXE_PATH=%%F"
if "!EXE_PATH!"=="" (
  echo EXE wurde nicht gefunden.
  pause
  exit /b 1
)
for %%A in ("!EXE_PATH!") do set "APP_FOLDER=%%~dpA"
set "DESKTOP_OUT=%USERPROFILE%\Desktop\Eckl_Materialverwaltung_SERVER_PORTABLE_OHNE_NODE"
if exist "!DESKTOP_OUT!" rmdir /s /q "!DESKTOP_OUT!"
xcopy "!APP_FOLDER!" "!DESKTOP_OUT!\" /E /I /Y >nul
>"!DESKTOP_OUT!\eckl-config.json" echo {"mode":"server","port":4170,"forcePort":true}
>"!DESKTOP_OUT!\SERVER_STARTEN.bat" echo @echo off
>>"!DESKTOP_OUT!\SERVER_STARTEN.bat" echo cd /d "%%~dp0"
>>"!DESKTOP_OUT!\SERVER_STARTEN.bat" echo start "" "Eckl Eco Technics - Materialverwaltung.exe"
>"!DESKTOP_OUT!\SERVER_IP_ANZEIGEN.bat" echo @echo off
>>"!DESKTOP_OUT!\SERVER_IP_ANZEIGEN.bat" echo ipconfig ^| findstr /R /C:"IPv4"
>>"!DESKTOP_OUT!\SERVER_IP_ANZEIGEN.bat" echo echo Clients verbinden sich mit http://SERVER-IP:4170
>>"!DESKTOP_OUT!\SERVER_IP_ANZEIGEN.bat" echo pause
>"!DESKTOP_OUT!\README_SERVER.txt" echo Server-Portable ohne Node.js. Kompletten Ordner auf Server-PC kopieren und SERVER_STARTEN.bat starten.

echo.
echo FERTIG: Server-Portable liegt hier:
echo !DESKTOP_OUT!
explorer "!DESKTOP_OUT!"
pause
