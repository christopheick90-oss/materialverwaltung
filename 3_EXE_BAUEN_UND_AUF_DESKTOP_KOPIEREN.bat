@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Eckl Eco Technics - Materialverwaltung - EXE bauen
echo ==============================================
echo.
echo WICHTIG: Diese Datei muss in einem ENTPACKTEN Ordner liegen.
echo Nicht direkt aus der ZIP-Datei starten.
echo.
echo Aktueller Ordner:
echo %cd%
echo.

rem Warnung, falls die BAT aus einem Windows-Temp-Ordner gestartet wurde
set "CURRENT=%cd%"
echo %CURRENT% | find /I "\Temp\" >nul
if not errorlevel 1 (
  echo WARNUNG: Es sieht so aus, als ob die Datei aus einem TEMP-Ordner gestartet wurde.
  echo Bitte ZIP-Datei zuerst mit Rechtsklick ^> Alle extrahieren entpacken.
  echo.
  pause
  exit /b 1
)

if not exist package.json (
  echo FEHLER: package.json wurde nicht gefunden.
  echo Bitte diese BAT-Datei im entpackten Hauptordner starten.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Pakete fehlen noch. Starte zuerst 1_PAKETE_INSTALLIEREN.bat
  echo.
  pause
  exit /b 1
)

if exist release (
  echo Alter release-Ordner wird entfernt ...
  rmdir /s /q release
)

echo Baue portable EXE-Testversion ...
call npm run pack:win
if errorlevel 1 (
  echo.
  echo FEHLER: Der EXE-Bau ist fehlgeschlagen.
  echo Bitte die letzten Fehlerzeilen kopieren und an ChatGPT senden.
  echo.
  pause
  exit /b 1
)

echo.
echo Suche fertige EXE ...
set "EXE_PATH="
for /f "delims=" %%F in ('dir /s /b "release\Eckl Eco Technics - Materialverwaltung.exe" 2^>nul') do (
  set "EXE_PATH=%%F"
)

if "%EXE_PATH%"=="" (
  echo.
  echo FEHLER: npm meldete Erfolg, aber die EXE wurde im release-Ordner nicht gefunden.
  echo Ich zeige dir jetzt, was im Ordner liegt:
  echo.
  if exist release (
    dir /s /b release
  ) else (
    echo Es gibt keinen release-Ordner.
  )
  echo.
  pause
  exit /b 1
)

for %%A in ("%EXE_PATH%") do set "APP_FOLDER=%%~dpA"
set "DESKTOP_OUT=%USERPROFILE%\Desktop\Eckl_Eco_Technics_Materialverwaltung_EXE"

if exist "%DESKTOP_OUT%" (
  echo Alter Desktop-Ordner wird entfernt ...
  rmdir /s /q "%DESKTOP_OUT%"
)

echo Kopiere fertige App auf den Desktop ...
xcopy "%APP_FOLDER%" "%DESKTOP_OUT%\" /E /I /Y >nul
if errorlevel 1 (
  echo.
  echo FEHLER: Kopieren auf den Desktop hat nicht funktioniert.
  echo Die EXE liegt aber hier:
  echo %EXE_PATH%
  echo.
  pause
  exit /b 1
)

echo.
echo FERTIG!
echo.
echo Du findest die EXE jetzt sichtbar auf dem Desktop im Ordner:
echo %DESKTOP_OUT%
echo.
echo Datei:
echo %DESKTOP_OUT%\Eckl Eco Technics - Materialverwaltung.exe
echo.
explorer "%DESKTOP_OUT%"
pause
