@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Client-EXE bauen
echo ==============================================
echo.
if not exist node_modules (
  echo Pakete fehlen noch. Bitte zuerst 1_PAKETE_INSTALLIEREN.bat starten.
  pause
  exit /b 1
)
set /p SERVER=Server-IP oder Server-URL fuer den Client eingeben: 
if "!SERVER!"=="" (
  echo Keine Server-Adresse eingegeben.
  pause
  exit /b 1
)
set "PREFIX=!SERVER:~0,4!"
if /I "!PREFIX!"=="http" (
  set "URL=!SERVER!"
) else (
  echo !SERVER! | findstr ":" >nul
  if errorlevel 1 (set "URL=http://!SERVER!:4170") else (set "URL=http://!SERVER!")
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
set "DESKTOP_OUT=%USERPROFILE%\Desktop\Eckl_Materialverwaltung_CLIENT_EXE"
if exist "!DESKTOP_OUT!" rmdir /s /q "!DESKTOP_OUT!"
xcopy "!APP_FOLDER!" "!DESKTOP_OUT!\" /E /I /Y >nul
>"!DESKTOP_OUT!\eckl-config.json" echo {"mode":"client","serverUrl":"!URL!"}
>"!DESKTOP_OUT!\SERVER_ADRESSE.txt" echo !URL!
echo.
echo FERTIG: Client-EXE liegt hier:
echo !DESKTOP_OUT!
echo.
echo Eingetragener Server: !URL!
explorer "!DESKTOP_OUT!"
pause
