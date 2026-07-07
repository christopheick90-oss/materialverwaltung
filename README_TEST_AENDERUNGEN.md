# Teständerungen 0.8.2

Basis: letzte funktionierende 0.7.2-Testversion im Master-Design, jetzt als Version 0.8.2 geführt.

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


## Ergänzung 0.8.2

- Konsi-Lager → Tabelle einfügen nutzt jetzt das gewünschte Format:

```text
Material ID	Material	Format	Stärke
```

- `Material ID` wird als Konsi-/Paketnummer gespeichert.
- Gleiche `Material ID` darf mehrfach vorkommen und wird mehrfach als eigenes Paket übernommen.
- Der Import bleibt nur für Admin sichtbar/freigegeben.


## Änderung 0.8.2

- Fester Mindestbestand nur für normale Tafeln: 2 Tafeln.
- Pakete, Konsi und Resttafeln bleiben ausgenommen und lösen keine Mindestbestand-Warnung aus.
- Neue, importierte und bestehende Materialien werden serverseitig so normalisiert, dass nur Tafelbestand für die Warnung zählt.


## Version 0.8.2

Diese Version bündelt die bisherigen Teständerungen als neuer Stand 0.8.2.


## Änderung 0.8.2

- Manuelle Wareneingänge können erst gebucht werden, wenn die Stärke eingetragen ist.
- Admin kann Wareneingänge ohne Bestellung nachträglich korrigieren.
- Die Suche findet Material auch zusammenhängend/kompakt, z. B. `AlmG3` findet auch `Alm G3 foliert`.
