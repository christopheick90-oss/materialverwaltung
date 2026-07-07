# Eckl Lagerverwaltung v0.7.5 - Master-Design wiederhergestellt

Diese ZIP ist Render/GitHub-ready. Wichtig: ZIP entpacken und den Inhalt direkt in dein GitHub-Repository kopieren.

Direkt im Repository-Hauptordner müssen sichtbar sein:

- package.json
- server.js
- public

Im Ordner public muss liegen:

- index.html

Nicht den kompletten entpackten Ordner als Unterordner hochladen.

## Änderung in v0.7.5

- Master-/Probelauf-Design mit Eckl-Logo wiederhergestellt.
- Benutzer/Profile sind wieder als eigener Bereich vorhanden.
- Benutzerliste ist sichtbar; Benutzer hinzufügen/löschen nur Admin.
- Konsi-Lager ist für alle sichtbar.
- Konsi-Tabelleneinfügung, Duplizieren und Löschen nur Admin.
- Materialkarten zeigen das Format an.
- Speicher-Key bleibt `eckl_lagerverwaltung_v073`, damit vorhandene Browser-Daten möglichst erhalten bleiben.

## Hochladen

1. ZIP entpacken.
2. GitHub Desktop -> Repository -> Show in Explorer.
3. Den Inhalt dieser ZIP in genau diesen Ordner kopieren.
4. In GitHub Desktop Summary: `v0.7.5 Master-Design wiederhergestellt`.
5. Commit to main.
6. Push origin.
7. Render -> Manual Deploy -> Deploy latest commit.

## Test

Auf Render prüfen:

/debug/render

Danach die normale App öffnen und mit Strg + F5 hart aktualisieren.
