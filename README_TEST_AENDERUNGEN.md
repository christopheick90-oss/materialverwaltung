# Teständerungen 0.9.6

Basis: v0.9.5 im Master-Design, weitergeführt als v0.9.6.

## Neu in v0.9.6

- Materialnamen werden automatisch in eine saubere Schreibweise gebracht.
- Beispiele:
  - `almg3` wird `AlMg3`
  - `almg 3` wird `AlMg3`
  - `v2a` wird `V2A`
  - `dc01` wird `DC01`
  - `s235` wird `S235`
  - `aluminium` wird `Aluminium`
- Teilenr. wird automatisch großgeschrieben.
- Die Korrektur wird beim Verlassen des Feldes und beim Speichern angewendet.
- Server prüft die Schreibweise zusätzlich, damit Daten auch bei Import oder späterer Bearbeitung einheitlich bleiben.

## Unverändert aus v0.9.5

- Sonderformate wie `1000 x 1000` werden als `1000x1000` gespeichert.
- Feld Teilenr. ist bei Materialanlage, Korrektur, Materialkarte, Suche und Admin-Materialpflege enthalten.
- Master-Design bleibt Grundlage.
