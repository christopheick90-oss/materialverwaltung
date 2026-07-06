@echo off
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ==============================================
echo   Server + Client PORTABLE ohne Node.js bauen
echo ==============================================
echo.
echo Ziel: Auf Server-PC und Client-PCs muss danach kein Node.js und kein Electron installiert sein.
echo Nur dieser Bau-PC braucht Node.js einmalig zum Erstellen der fertigen Ordner.
echo.
if not exist node_modules (
  echo Pakete fehlen noch. Bitte auf diesem Bau-PC zuerst starten:
  echo 1_PAKETE_INSTALLIEREN.bat
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

set "SERVER_OUT=%USERPROFILE%\Desktop\Eckl_Materialverwaltung_SERVER_PORTABLE_OHNE_NODE"
set "CLIENT_OUT=%USERPROFILE%\Desktop\Eckl_Materialverwaltung_CLIENT_PORTABLE_OHNE_NODE"

if exist "!SERVER_OUT!" rmdir /s /q "!SERVER_OUT!"
if exist "!CLIENT_OUT!" rmdir /s /q "!CLIENT_OUT!"

xcopy "!APP_FOLDER!" "!SERVER_OUT!\" /E /I /Y >nul
xcopy "!APP_FOLDER!" "!CLIENT_OUT!\" /E /I /Y >nul

>"!SERVER_OUT!\eckl-config.json" echo {"mode":"server","port":4170,"forcePort":true}
>"!CLIENT_OUT!\eckl-config.json" echo {"mode":"client"}

>"!SERVER_OUT!\SERVER_STARTEN.bat" echo @echo off
>>"!SERVER_OUT!\SERVER_STARTEN.bat" echo cd /d "%%~dp0"
>>"!SERVER_OUT!\SERVER_STARTEN.bat" echo start "" "Eckl Eco Technics - Materialverwaltung.exe"

>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo @echo off
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo echo IP-Adressen dieses Server-PCs:
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo echo.
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo ipconfig ^| findstr /R /C:"IPv4"
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo echo.
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo echo Clients verbinden sich mit: http://SERVER-IP:4170
>>"!SERVER_OUT!\SERVER_IP_ANZEIGEN.bat" echo pause

>"!CLIENT_OUT!\CLIENT_STARTEN.bat" echo @echo off
>>"!CLIENT_OUT!\CLIENT_STARTEN.bat" echo cd /d "%%~dp0"
>>"!CLIENT_OUT!\CLIENT_STARTEN.bat" echo start "" "Eckl Eco Technics - Materialverwaltung.exe"

>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo @echo off
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo echo Client-Verbindung wird zurueckgesetzt.
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo set "CFG=%%LOCALAPPDATA%%\Eckl Eco Technics - Materialverwaltung\eckl-config.json"
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo if exist "%%CFG%%" del "%%CFG%%"
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo ^>"eckl-config.json" echo {"mode":"client"}
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo echo Beim naechsten Start fragt der Client wieder nach der Server-IP.
>>"!CLIENT_OUT!\CLIENT_VERBINDUNG_ZURUECKSETZEN.bat" echo pause

>"!SERVER_OUT!\README_SERVER.txt" echo Server-Version ohne Node.js auf dem Server-PC.
>>"!SERVER_OUT!\README_SERVER.txt" echo Diesen kompletten Ordner auf den Server-PC kopieren.
>>"!SERVER_OUT!\README_SERVER.txt" echo Start: SERVER_STARTEN.bat oder EXE direkt.
>>"!SERVER_OUT!\README_SERVER.txt" echo Datenbank liegt unter %%LOCALAPPDATA%%\Eckl Eco Technics - Materialverwaltung\Daten
>>"!SERVER_OUT!\README_SERVER.txt" echo Port: 4170

>"!CLIENT_OUT!\README_CLIENT.txt" echo Client-Version ohne Node.js auf dem Client-PC.
>>"!CLIENT_OUT!\README_CLIENT.txt" echo Diesen kompletten Ordner auf den Client-PC kopieren.
>>"!CLIENT_OUT!\README_CLIENT.txt" echo Start: CLIENT_STARTEN.bat oder EXE direkt.
>>"!CLIENT_OUT!\README_CLIENT.txt" echo Beim ersten Start Server-IP eingeben, z. B. 192.168.178.50
>>"!CLIENT_OUT!\README_CLIENT.txt" echo Der Client speichert nur die Server-Adresse, keine eigene Materialdatenbank.

echo.
echo FERTIG.
echo Server-Ordner:
echo !SERVER_OUT!
echo.
echo Client-Ordner:
echo !CLIENT_OUT!
echo.
echo Diese beiden Ordner brauchen auf den Ziel-PCs kein Node.js und kein Electron.
echo Wichtig: Immer den kompletten Ordner kopieren, nicht nur die EXE.
explorer "%USERPROFILE%\Desktop"
pause
