# Teständerungen 0.8.0

Basis: letzte funktionierende 0.7.2-Testversion im Master-Design, jetzt als Version 0.8.0 geführt.

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


## Ergänzung 0.8.0

- Konsi-Lager → Tabelle einfügen nutzt jetzt das gewünschte Format:

```text
Material ID	Material	Format	Stärke
```

- `Material ID` wird als Konsi-/Paketnummer gespeichert.
- Gleiche `Material ID` darf mehrfach vorkommen und wird mehrfach als eigenes Paket übernommen.
- Der Import bleibt nur für Admin sichtbar/freigegeben.


## Änderung 0.8.0

- Fester Mindestbestand für alle normalen Materialien: 2 Tafeln.
- Resttafeln bleiben ausgenommen und lösen keine Mindestbestand-Warnung aus.
- Neue, importierte und bestehende Materialien werden serverseitig auf diesen Mindestbestand normalisiert.


## Version 0.8.0

Diese Version bündelt die bisherigen Teständerungen als neuer Stand 0.8.0.
