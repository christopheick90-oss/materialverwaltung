# Eckl Lagerverwaltung v2.9

Änderung: Der Material-CSV-Export wurde wieder auf das Wesentliche reduziert.

Exportiert werden nur noch:
- Material
- Bestand
- KG-Preis €/kg

Der Export bleibt nur für Büro/Chef/Admin verfügbar. Laser sieht weiterhin keine KG-Preise.

Master-Design bleibt unverändert.

### v2.9 CSV-Export
- Keine großen Kopfbereiche mehr.
- Keine Zusatzspalten mehr.
- Excel-Trennzeichen `sep=;` bleibt erhalten, damit Excel die Spalten sauber trennt.
- Material enthält Materialname und Stärke, damit die Zeile eindeutig bleibt.
