@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Eckl Eco Technics - Client-App starten
echo ==============================================
echo.
echo Diese App verbindet sich mit dem Probeserver.
echo Beispiel: 192.168.178.50 oder http://192.168.178.50:4170
echo.
if not exist node_modules (
  echo Pakete fehlen noch. Bitte zuerst 1_PAKETE_INSTALLIEREN.bat starten.
  echo.
  pause
  exit /b 1
)

set "SERVER="
if exist server-adresse.txt (
  set /p SERVER=<server-adresse.txt
  echo Gespeicherte Server-Adresse: !SERVER!
)
if "!SERVER!"=="" (
  set /p SERVER=Server-IP oder Server-URL eingeben: 
) else (
  set /p USEOLD=Diese Adresse verwenden? ENTER=ja / neue Adresse eintippen: 
  if not "!USEOLD!"=="" set "SERVER=!USEOLD!"
)
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
  if errorlevel 1 (
    set "URL=http://!SERVER!:4170"
  ) else (
    set "URL=http://!SERVER!"
  )
)

echo !URL!>server-adresse.txt
>eckl-config.json echo {"mode":"client","serverUrl":"!URL!"}

echo.
echo Verbinde mit: !URL!
echo.
set ECKL_APP_MODE=client
set ECKL_SERVER_URL=!URL!
call npm run desktop
pause
