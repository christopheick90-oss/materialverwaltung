# Teständerungen 0.9.8

Basis: v0.9.7 im Master-Design, weitergeführt als v0.9.8.

## Neu in v0.9.8

### Werkstoffnummern

- Werkstoffnummern werden automatisch mit Punkt gespeichert.
- Auch falsch gespeicherte Kurzformen werden beim Laden/Speichern wieder korrigiert.
- Beispiele:
  - `1,4404` wird `1.4404`
  - `1,4571` wird `1.4571`
  - `1,4301` wird `1.4301`
  - `14571` wird `1.4571`
  - `14404` wird `1.4404`
  - `14301` wird `1.4301`

### Entnahmen suchen

- In **Historie** gibt es jetzt einen eigenen Block **Entnahmen suchen**.
- Diese Suche ist getrennt von der normalen Materialsuche.
- Angezeigt werden nur Vorgänge, in denen Material entnommen wurde.
- Suchbar nach Material, Werkstoffnummer, Teilenr., Stärke, Format, Benutzer und Datum.

## Unverändert

- Stärken bleiben im Format `2,00 mm` / `2,50 mm`.
- Sonderformate bleiben erhalten.
- Teilenr. bleibt bei Materialanlage und Korrektur enthalten.
- Master-Design bleibt Grundlage.
