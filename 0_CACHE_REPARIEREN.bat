@echo off
cd /d "%~dp0"

echo ==============================================
echo   Eckl Eco Technics - Materialverwaltung - Cache reparieren
echo ==============================================
echo.
echo Es werden nur Cache-Ordner geloescht, nicht die Materialdaten.
echo.
set "APPDIR=%LOCALAPPDATA%\Eckl Eco Technics - Materialverwaltung"
if exist "%APPDIR%\Cache" rmdir /s /q "%APPDIR%\Cache"
if exist "%APPDIR%\GPUCache" rmdir /s /q "%APPDIR%\GPUCache"
if exist "%APPDIR%\Benutzerdaten\Cache" rmdir /s /q "%APPDIR%\Benutzerdaten\Cache"
if exist "%APPDIR%\Benutzerdaten\GPUCache" rmdir /s /q "%APPDIR%\Benutzerdaten\GPUCache"

echo Cache wurde bereinigt.
echo.
pause
