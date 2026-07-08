# Eckl Eco Technics - Materialverwaltung V0.9.0

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


## Test 0.9.0

Nur normale Tafeln verwenden den festen Mindestbestand 2 Tafeln. Pakete, Konsi und Resttafeln sind ausgenommen.


## Änderung 0.9.0

- Manuelle Wareneingänge können erst gebucht werden, wenn die Stärke eingetragen ist.
- Admin kann Wareneingänge ohne Bestellung nachträglich korrigieren.
- Die Suche findet Material auch zusammenhängend/kompakt, z. B. `AlmG3` findet auch `Alm G3 foliert`.


## Änderung 0.9.0

Admin-Bereich wurde übersichtlicher gruppiert. Die Seitenleiste zeigt für Admin nur noch den Hauptpunkt Admin, die Untermenüs liegen geordnet im Admin-Bereich.


## Änderung 0.9.0

In Bestellungen wird die Stärke jetzt direkt und gut sichtbar beim Material angezeigt.


Weitere Details zur Gewichtsberechnung stehen in `MATERIAL_GEWICHTE.md`.


## Änderung 0.9.0

- Admin-Materialpflege erweitert: Materialdaten können gezielt korrigiert werden.
- Admin kann Materialname, Stärke, Format, Lagerbereich, Lagerplatz und Resttafel-Kennzeichnung bearbeiten.
- Bestand bleibt bei dieser Korrektur unverändert.
- Änderungen werden mit Grund/Hinweis in der Historie protokolliert.
