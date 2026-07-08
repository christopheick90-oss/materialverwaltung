# Eckl Eco Technics - Materialverwaltung V0.9.5

Basis: v0.9.4 im Master-Design, weitergeführt als v0.9.5.

## Neu in v0.9.5

- Beim Material anlegen gibt es jetzt ein Feld **Sonderformat**.
- Beim Admin-Korrekturfenster gibt es ebenfalls **Sonderformat**.
- Beispiel-Eingaben wie `1000 x 1000`, `1000x1000` oder `1000*1000` werden als `1000x1000` gespeichert.
- Zusätzlich gibt es das Feld **Teilenr.** bei Material anlegen und bei Admin-Korrektur.
- Die Teilenummer wird in der Materialkarte und in der Admin-Materialpflege angezeigt.
- Teilenummern sind über die Materialsuche auffindbar.
- Stärken-Normierung aus v0.9.3 bleibt erhalten, z. B. `2,5` → `2,50 mm`.
- Löschfenster aus v0.9.4 bleibt im Master-Design.

## Test

1. `3_BROWSER_SERVER_TESTEN.bat` starten.
2. Als Admin anmelden.
3. Material anlegen öffnen.
4. Bei Format **Sonderformat** auswählen.
5. Zum Beispiel `1000 x 1000` eintragen.
6. Eine Teilenr. eintragen, z. B. `T-1000-001`.
7. Speichern und anschließend Materialkarte / Admin-Materialpflege prüfen.

## Wichtig

Das Master-Design bleibt die Grundlage. Es wurden keine Extras, keine neue Bibliothek und kein neues Framework ergänzt.
