# Teständerungen 0.9.0

Basis: v0.8.11 im Master-Design, weitergeführt als v0.9.0.

Geändert:

- Neue Admin-Korrektur in `Admin > Materialpflege`.
- Admin kann vorhandene Materialien suchen und Materialdaten bearbeiten.
- Korrigierbar sind Materialname, Stärke, Format, Lagerbereich, Lagerplatz und Resttafel-Kennzeichnung.
- Bestand, Pakete und Tafeln bleiben unverändert.
- Optionaler Grund/Hinweis wird in der Historie gespeichert.
- Auf Materialkarten sieht Admin zusätzlich den Button `Korrigieren`.

Lokal testen:

1. ZIP entpacken.
2. `3_BROWSER_SERVER_TESTEN.bat` starten.
3. Im Browser `http://localhost:4170` öffnen.
4. Mit Admin anmelden.
5. `Admin > Materialpflege` öffnen.
6. Material suchen, `Korrigieren` anklicken und z. B. Format ändern.
7. Speichern und prüfen, ob Bestand gleich bleibt und die Historie die Korrektur zeigt.

---

# Teständerungen 0.8.11

Basis: letzte funktionierende 0.7.2-Testversion im Master-Design, jetzt als Version 0.8.11 geführt.

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


## Ergänzung 0.8.11

- Konsi-Lager → Tabelle einfügen nutzt jetzt das gewünschte Format:

```text
Material ID	Material	Format	Stärke
```

- `Material ID` wird als Konsi-/Paketnummer gespeichert.
- Gleiche `Material ID` darf mehrfach vorkommen und wird mehrfach als eigenes Paket übernommen.
- Der Import bleibt nur für Admin sichtbar/freigegeben.


## Änderung 0.8.11

- Fester Mindestbestand nur für normale Tafeln: 2 Tafeln.
- Pakete, Konsi und Resttafeln bleiben ausgenommen und lösen keine Mindestbestand-Warnung aus.
- Neue, importierte und bestehende Materialien werden serverseitig so normalisiert, dass nur Tafelbestand für die Warnung zählt.


## Version 0.8.11

Diese Version bündelt die bisherigen Teständerungen als neuer Stand 0.8.11.


## Änderung 0.8.11

- Manuelle Wareneingänge können erst gebucht werden, wenn die Stärke eingetragen ist.
- Admin kann Wareneingänge ohne Bestellung nachträglich korrigieren.
- Die Suche findet Material auch zusammenhängend/kompakt, z. B. `AlmG3` findet auch `Alm G3 foliert`.


## Änderung 0.8.11

- Admin-Untermenüs werden nicht mehr einzeln in der linken Hauptnavigation angezeigt.
- Der Admin-Bereich ist in Gruppen sortiert: Benutzer & Rechte, Material & Listen, Sicherung & Kontrolle, tägliche Kontrolle.
- Jede Admin-Unterseite hat oben eine kompakte Admin-Navigation mit Rücksprung zur Admin-Übersicht.
- Master-Design, Farben und Grundlayout bleiben erhalten.


## Änderung 0.8.11

- In der Bestellübersicht wird die Stärke direkt unter dem Material deutlich angezeigt.
- Die Stärke wird auch in der Bestellungssuche berücksichtigt.
- In den Dialogen „Bestellt“ und „Lieferung annehmen“ wird die Stärke ebenfalls direkt beim Material angezeigt.
