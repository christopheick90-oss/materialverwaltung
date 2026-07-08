# Eckl Eco Technics - Materialverwaltung V0.9.8

Basis: v0.9.7 im Master-Design, weitergeführt als v0.9.8.

## Neu in v0.9.8

- Werkstoffnummern werden noch robuster gespeichert.
- Auch Zahlen ohne Punkt werden erkannt, z. B. `14571` → `1.4571`.
- Beispiele: `1,4404` → `1.4404`, `1,4571` → `1.4571`, `1,4301` → `1.4301`, `14571` → `1.4571`.
- Materialsuche kennt jetzt die Varianten `1.4404` / `14404` und `1.4571` / `14571`.
- In der Historie gibt es einen eigenen Bereich **Entnahmen suchen**.
- Dort werden nur Entnahmen angezeigt und nach Material, Teilenr., Stärke, Format, Benutzer oder Datum gefiltert.
- Die normale Materialsuche bleibt unverändert.

## Weiterhin enthalten

- Automatische Groß-/Kleinschreibung bei Material anlegen und Admin-Korrektur.
- Stärken werden automatisch als `2,00 mm` / `2,50 mm` gespeichert.
- Sonderformate wie `1000 x 1000` werden als `1000x1000` gespeichert.
- Teilenr. ist bei Materialanlage, Korrektur, Materialkarte, Suche und Admin-Materialpflege enthalten.

## Start

1. ZIP entpacken.
2. `3_BROWSER_SERVER_TESTEN.bat` starten.
3. Im Browser anmelden und testen.

Master-Design bleibt unverändert.
