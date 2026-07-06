@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===============================================
echo  ECKL MATERIALDATENBANK NOTFALL LEEREN
echo ===============================================
echo.
echo Das entfernt ALLE Materialien, Bestellungen, Inventuren,
echo Material-Historien und Rueckgaengig-Sicherungen.
echo Benutzer, Einstellungen und Backups bleiben erhalten.
echo.
set /p CONFIRM=Zum Bestaetigen MATERIALIEN LOESCHEN eingeben: 
if /I not "%CONFIRM%"=="MATERIALIEN LOESCHEN" (
  echo.
  echo Abgebrochen. Es wurde nichts geloescht.
  pause
  exit /b 1
)
echo.
echo Beende alten lokalen Server auf Port 4170...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4170 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
node tools\materialdatenbank_notfall_leeren.js
echo.
pause
