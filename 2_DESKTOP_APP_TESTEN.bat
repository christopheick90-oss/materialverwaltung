@echo off
cd /d "%~dp0"
echo ==============================================
echo   Desktop-App testen
echo ==============================================
echo.
echo Die App startet gleich in einem eigenen Fenster.
echo Dieses CMD-Fenster dabei offen lassen.
echo.
echo Alte lokale Server beenden, damit sicher diese Version startet ...
for /L %%P in (4170,1,4189) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
  )
)
echo.
call npm run desktop
pause
