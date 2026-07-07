# Eckl Lagerverwaltung v0.7.4 - Render/GitHub Upload

Wichtig: Diese ZIP so entpacken, dass im GitHub-Repository direkt sichtbar sind:

- package.json
- server.js
- public

Im Ordner public muss direkt liegen:

- index.html

Nicht den kompletten entpackten Ordner als Unterordner hochladen. Render sucht den public-Ordner direkt im Repository-Hauptverzeichnis.

## GitHub Desktop

1. GitHub Desktop öffnen.
2. Repository -> Show in Explorer.
3. Den Inhalt dieser ZIP in genau diesen Ordner kopieren.
4. In GitHub Desktop Summary eintragen: `Version 0.7.4 Konsi sichtbar Einfügen nur Admin`.
5. Commit to main.
6. Push origin.

## Render

Danach in Render:

Manual Deploy -> Deploy latest commit

Test:

/debug/render

Normale App:

/

## Änderung in v0.7.4

- Konsi-Lager ist für alle Profile sichtbar.
- Konsi-Tabelleneinfügung, Duplizieren und Löschen ist nur im Admin-Profil möglich.
- Speicher-Key bleibt gleich wie v0.7.3, damit vorhandene Browser-Daten möglichst erhalten bleiben.
