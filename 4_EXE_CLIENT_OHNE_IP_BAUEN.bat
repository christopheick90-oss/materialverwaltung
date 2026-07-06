@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Client-PORTABLE ohne Node.js bauen
echo ==============================================
echo.
echo Der Ziel-Client-PC braucht danach kein Node.js und kein Electron.
echo Beim ersten Start fragt der Client nach der Server-IP.
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
set "DESKTOP_OUT=%USERPROFILE%\Desktop\Eckl_Materialverwaltung_CLIENT_PORTABLE_OHNE_NODE"
if exist "!DESKTOP_OUT!" rmdir /s /q "!DESKTOP_OUT!"
xcopy "!APP_FOLDER!" "!DESKTOP_OUT!\" /E /I /Y >nul
>"!DESKTOP_OUT!\eckl-config.json" echo {"mode":"client"}
>"!DESKTOP_OUT!\CLIENT_STARTEN.bat" echo @echo off
>>"!DESKTOP_OUT!\CLIENT_STARTEN.bat" echo cd /d "%%~dp0"
>>"!DESKTOP_OUT!\CLIENT_STARTEN.bat" echo start "" "Eckl Eco Technics - Materialverwaltung.exe"
>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo @echo off
>>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo set "CFG=%%LOCALAPPDATA%%\Eckl Eco Technics - Materialverwaltung\eckl-config.json"
>>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo if exist "%%CFG%%" del "%%CFG%%"
>>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo ^>"eckl-config.json" echo {"mode":"client"}
>>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo echo Verbindung geloescht. Beim naechsten Start wird wieder nach der Server-IP gefragt.
>>"!DESKTOP_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo pause
>"!DESKTOP_OUT!\README_CLIENT.txt" echo Client-Portable ohne Node.js. Kompletten Ordner auf Client-PC kopieren und CLIENT_STARTEN.bat starten.

echo.
echo FERTIG: Client-Portable liegt hier:
echo !DESKTOP_OUT!
explorer "!DESKTOP_OUT!"
pause
