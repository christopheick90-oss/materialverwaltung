# Teständerungen 0.7.2-test.3

Basis: letzte funktionierende 0.7.2-Testversion im Master-Design.

Geändert:

- Konsi-Lager bleibt für alle sichtbar.
- Konsi-Tabellenimport bleibt nur Admin.
- Mehrere Konsi-Pakete dürfen dieselbe Paketnummer haben.
- Geliefert bleibt kompakt direkt im Bereich Material sichtbar.
- Beim Wareneingang werden jetzt zusätzlich die Maße / das Format angezeigt:
  - in der Bestell-/Wareneingangsübersicht beim Material
  - in der Menge-Spalte beim Wareneingang
  - im kompakten Geliefert-Block im Bereich Material
  - in der Historie bei Wareneingang ohne Bestellung

Lokal testen:

1. ZIP entpacken.
2. `3_BROWSER_SERVER_TESTEN.bat` starten.
3. Im Browser `http://localhost:4170` öffnen.
4. Wareneingang ohne Bestellung buchen und prüfen, ob das Format angezeigt wird.

Erst nach erfolgreichem Test in GitHub Desktop committen/pushen und Render neu deployen.
