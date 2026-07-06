# Render Deploy Anleitung V0.7.0

## 1. Dateien in GitHub aktualisieren

Den Inhalt dieses Ordners in dein GitHub Repository hochladen.

Wichtig: Falls im Repository noch `package-lock.json` liegt, bitte löschen oder den Render Build Command unten verwenden. Die alte Lock-Datei kann Render blockieren.

## 2. Render Build Command ändern

In Render:

```text
Dashboard → dein Web Service → Settings → Build & Deploy
```

Build Command auf diesen Wert setzen:

```text
rm -f package-lock.json && npm install --omit=dev --no-audit --no-fund
```

Start Command:

```text
node server.js
```

Health Check Path:

```text
/healthz
```

## 3. Environment Variables

```text
NODE_VERSION=22
ECKL_APP_MODE=render
DATABASE_URL=<deine Supabase-Datenbankadresse>
```

## 4. Danach

Auf **Manual Deploy → Clear build cache & deploy** klicken.
