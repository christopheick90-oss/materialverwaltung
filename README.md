# Eckl Eco Technics - Materialverwaltung V0.7.0

Render Online-Probeserver Build-Fix.

Wichtig für Render:

- `package-lock.json` wurde entfernt, weil die alte Datei falsche interne Paket-URLs enthalten konnte.
- `.npmrc` erzwingt die öffentliche npm Registry.
- Render Build Command:

```text
rm -f package-lock.json && npm install --omit=dev --no-audit --no-fund
```

Start Command:

```text
node server.js
```

Health Check:

```text
/healthz
```

Environment Variables:

```text
NODE_VERSION=22
ECKL_APP_MODE=render
DATABASE_URL=<Supabase Connection String>
```
