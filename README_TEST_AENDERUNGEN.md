# Lokale Test-Version 0.7.2-test.2

Diese ZIP basiert auf der funktionierenden 0.7.2-test.1 und ändert nur die gewünschten Punkte:

- Konsi-Lager bleibt für alle sichtbar.
- Konsi-Tabelle einfügen bleibt nur für Admin.
- Konsi-Paketnummern dürfen jetzt mehrfach gleich vorkommen.
- Bei Entnahme einer doppelten Paketnummer wird nur ein Paket entfernt, nicht alle gleichen Nummern.
- Gelieferte Positionen werden im Bereich Material immer direkt mit angezeigt.
- Der Geliefert-Block ist kompakter/kleiner dargestellt.
- Die bestehende Render-/GitHub-Struktur bleibt erhalten.

## Lokal testen

1. ZIP entpacken.
2. `1_PAKETE_INSTALLIEREN.bat` nur falls nötig starten.
3. `3_BROWSER_SERVER_TESTEN.bat` starten.
4. Browser öffnen: http://localhost:4170

Erst wenn lokal alles passt: Dateien in GitHub Desktop übernehmen, committen, pushen und danach Render neu deployen.
