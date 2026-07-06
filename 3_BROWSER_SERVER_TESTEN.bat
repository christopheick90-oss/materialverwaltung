@echo off
cd /d "%~dp0"
echo ==============================================
echo   Eckl Eco Technics - Materialverwaltung - Browser/Netzwerk-Test
echo ==============================================
echo.
echo Danach im Browser oeffnen: http://localhost:4170
echo Fuer andere PCs: http://IP-DIESES-PCS:4170
echo.
echo Alte lokale Server beenden, damit sicher diese Version startet ...
for /L %%P in (4170,1,4189) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
  )
)
echo.
call npm start
pause
