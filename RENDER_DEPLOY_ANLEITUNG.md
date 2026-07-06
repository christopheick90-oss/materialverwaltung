# Render Online-Probeserver · Eckl Materialverwaltung V0.6.9

Diese Version ist für einen kostenlosen Online-Probelauf auf Render vorbereitet.

## Wichtig

Die App braucht online eine Datenbank. Ohne `DATABASE_URL` würde Render nur eine Datei im Container schreiben. Das ist auf Render Free nicht dauerhaft sicher.

Empfohlen für den kostenlosen Probelauf:

- Render Web Service Free für den Server
- Supabase Free oder Render Postgres als Postgres-Datenbank

Hinweis: Render Free Web Services schlafen nach Inaktivität ein. Beim ersten Aufruf kann das Aufwachen ca. eine Minute dauern.

## Dateien

- `render.yaml` = Render Blueprint / automatische Render-Einstellung
- `server.js` = nutzt online automatisch `process.env.PORT`
- `DATABASE_URL` = Postgres-Verbindung für zentrale Online-Datenbank
- `/healthz` = Health Check für Render

## Render-Webservice erstellen

1. Diesen Ordner in ein GitHub-Repository hochladen.
2. Bei Render anmelden.
3. `New` → `Web Service` wählen.
4. GitHub-Repository verbinden.
5. Einstellungen:

```text
Runtime: Node
Build Command: npm install --omit=dev
Start Command: node server.js
Plan: Free
Health Check Path: /healthz
```

6. Environment Variables setzen:

```text
NODE_VERSION=22
ECKL_APP_MODE=render
DATABASE_URL=<Postgres-Verbindungsadresse>
```

7. Deploy starten.
8. Nach dem Deploy bekommt ihr eine Adresse wie:

```text
https://eckl-materialverwaltung.onrender.com
```

Diese Adresse kann direkt im Browser geöffnet werden.

## Client-EXE nutzen

Die Client-EXE kann weiterhin genutzt werden. Beim ersten Start als Server-Adresse die Render-Adresse eingeben, z. B.:

```text
https://eckl-materialverwaltung.onrender.com
```

Nicht `localhost` verwenden.

## Daten aus alter Version übernehmen

1. In der alten lokalen Version als Admin ein Backup erstellen.
2. In der Online-Version als Admin einloggen.
3. Backup wiederherstellen.

## Standard-Login

```text
admin / admin123
laser / laser123
buero / buero123
chef / chef123
```

Passwörter danach ändern.
