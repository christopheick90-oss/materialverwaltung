@echo off
cd /d "%~dp0"
if "%1"=="/quiet" goto SHOW

echo ==============================================
echo   Server-IP anzeigen
echo ==============================================
echo.
:SHOW
if exist tools\server_ip_anzeigen.js (
  node tools\server_ip_anzeigen.js
) else (
  ipconfig | findstr /i "IPv4"
  echo.
  echo Im Client nutzen: http://IP-DIESES-PCS:4170
)
if not "%1"=="/quiet" pause
