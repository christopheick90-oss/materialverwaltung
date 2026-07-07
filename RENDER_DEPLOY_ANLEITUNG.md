# Render Deploy Anleitung V0.8.10

1. ZIP entpacken.
2. Inhalt des Ordners in GitHub hochladen, nicht die ZIP selbst.
3. In Render Web Service öffnen.
4. Settings → Build & Deploy:

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

5. Environment Variables:

```text
NODE_VERSION=22
ECKL_APP_MODE=render
DATABASE_URL=<deine Postgres URL>
```

6. Manual Deploy → Clear build cache & deploy.

Wenn die Hauptadresse „Not Found“ zeigt, zuerst diese Links testen:

```text
/healthz
/debug/public
```

`/debug/public` muss mindestens `index.html`, `app.js`, `styles.css` und `logo.png` anzeigen.


## Änderung 0.8.10

- Fester Mindestbestand für alle normalen Materialien: 2 Tafeln.
- Resttafeln bleiben ausgenommen und lösen keine Mindestbestand-Warnung aus.
- Neue, importierte und bestehende Materialien werden serverseitig auf diesen Mindestbestand normalisiert.


## Änderung 0.8.10

- Manuelle Wareneingänge können erst gebucht werden, wenn die Stärke eingetragen ist.
- Admin kann Wareneingänge ohne Bestellung nachträglich korrigieren.
- Die Suche findet Material auch zusammenhängend/kompakt, z. B. `AlmG3` findet auch `Alm G3 foliert`.


## Änderung 0.8.10

Bestellübersicht zeigt Stärke deutlich direkt beim Material.
