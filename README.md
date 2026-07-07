# Eckl Eco Technics - Materialverwaltung V0.8.1

Render Online-Version mit Not-Found-Fix.

## Wichtig für Render

Build Command:

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

Environment Variables:

```text
NODE_VERSION=22
ECKL_APP_MODE=render
DATABASE_URL=<Render PostgreSQL External Database URL oder funktionierende Postgres URL>
```

## Prüfen

Nach dem Deploy testen:

```text
https://deine-render-adresse.onrender.com/healthz
https://deine-render-adresse.onrender.com/debug/public
https://deine-render-adresse.onrender.com/
```


## Test 0.8.1

Nur normale Tafeln verwenden den festen Mindestbestand 2 Tafeln. Pakete, Konsi und Resttafeln sind ausgenommen.
