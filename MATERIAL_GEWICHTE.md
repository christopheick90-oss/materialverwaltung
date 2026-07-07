# Materialgewichte 0.8.10

Die Software berechnet das Gewicht je Tafel automatisch aus:

```text
Länge in m × Breite in m × Stärke in mm × Dichte kg/dm³ = kg pro Tafel
```

## Verwendete Dichtewerte

| Erkennung im Materialnamen | Verwendete Dichte | Hinweis |
|---|---:|---|
| AlMg3, EN AW-5754, 5754 | 2,68 kg/dm³ | genauer Wert für AlMg3 / EN AW-5754 |
| Alu, Aluminium, andere AlMg-Bezeichnungen | 2,70 kg/dm³ | allgemeiner Aluminiumwert |
| 1.4301, V2A, X5CrNi18-10, 304 | 7,90 kg/dm³ | Edelstahl V2A / 1.4301 |
| V4A, 1.4404, 1.4571, 316L | 8,00 kg/dm³ | Edelstahl V4A allgemein |
| Edelstahl, Niro, Inox, rostfrei, VA | 7,90 kg/dm³ | allgemeiner Edelstahlwert |
| DC01, S235, S355, Stahl, verzinkt | 7,85 kg/dm³ | Stahl allgemein |
| Kupfer, CU | 8,96 kg/dm³ | Kupfer allgemein |
| Messing, MS, Brass | 8,50 kg/dm³ | Messing allgemein |
| unbekannt | 7,85 kg/dm³ | Sicherheitswert Stahl |

## Beispielgewichte aus den Demo-Materialien

| Material | Format | Stärke | Gewicht je Tafel |
|---|---|---:|---:|
| Aluminium | 2000 × 1000 mm | 1,5 mm | ca. 8,1 kg |
| Aluminium | 3000 × 1500 mm | 2,0 mm | ca. 24,3 kg |
| Stahl DC01 | 2500 × 1250 mm | 1,0 mm | ca. 24,5 kg |
| Stahl S235 | 3000 × 1500 mm | 3,0 mm | ca. 106,0 kg |
| Edelstahl V2A / 1.4301 | 2500 × 1250 mm | 1,5 mm | ca. 37,0 kg |

Hinweis: Folierung, Schutzfolie, Ölung und Walztoleranzen können das reale Paketgewicht leicht verändern. Für den Wareneingang kann deshalb die berechnete Tafelanzahl weiterhin überschrieben werden.
