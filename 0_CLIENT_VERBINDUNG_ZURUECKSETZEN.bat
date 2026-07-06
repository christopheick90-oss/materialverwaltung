@echo off
echo ==============================================
echo   Client-Verbindung zuruecksetzen

echo ==============================================
echo.
echo Dadurch fragt die Client-EXE beim naechsten Start wieder nach der Server-IP.
echo.
set "CFG=%LOCALAPPDATA%\Eckl Eco Technics - Materialverwaltung\eckl-config.json"
if exist "%CFG%" (
  del "%CFG%"
  echo Gespeicherte Verbindung geloescht:
  echo %CFG%
) else (
  echo Keine gespeicherte Verbindung gefunden.
)
echo.
pause
