# Kalorien-Tracker – Bauplan

Web-App fürs iPhone (Safari, zum Home-Bildschirm hinzufügen). Daten bleiben lokal auf dem Gerät.

## Stand
- [x] `data/bls.json`: BLS 4.0 (7.140 Lebensmittel), Felder: code, name, kcal, protein, fat, carbs, fiber, sugar, salt, satfat (je 100 g)
  - Quelle muss in der App genannt werden (CC BY 4.0): „Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0“
  - Roh- und Gar-Varianten haben dieselben ersten 5 Zeichen im Code (z. B. C352000 Reis roh ↔ C352032 Reis gekocht)
- [x] App v1.0.0 gebaut und im Browser (iPhone-14-Ansicht) getestet: Suche, Roh/Gar, Barcode→OFF, eigenes Produkt, Rezept/Topf, Woche, Einstellungen, Dark Mode
- [x] Claude-SDK lädt im Browser (Aufruf mit echtem Key noch nicht getestet)
- [x] Online: https://4rc9cj8c88-design.github.io/kalorien-tracker/ (öffentliches Repo, nur Code)
- [x] v1.1.0: 14 Rezeptvorlagen (`vorlagen.js`: Hähnchen, Hack, Shakes) mit geschätztem Kochgewicht und Portionen; Obst-&-Gemüse-Zähler (Ziel 650 g, BLS-Gruppen F/G/H7/K7/R161)
- [x] v1.2.0: Einheiten im Mengen-Dialog (g, ml, Stück, Portion, Packung, Anteil vom Topf, EL, TL; Stückgewichte merkbar), „Gekocht“-Knopf: Zutaten einzeln scannen/suchen, dann Anteil oder Gramm eintragen, optional als Rezept speichern
- [ ] Test auf echtem iPhone (Kamera-Scan, Foto)
- [ ] Idee: Gewichts-Tracking mit Wochenschnitt und kcal-Anpassung im Bulk

Lokal testen: `cd ~/Desktop/Apps/kalorien-tracker && python3 -m http.server 8765` → http://localhost:8765 (Kamera nur über HTTPS bzw. localhost)

## Dateien
index.html, app.css, app.js (ES-Modul), vorlagen.js, sw.js (offline, Cache-Version bei Änderungen erhöhen), manifest.webmanifest, icon-*.png

## Funktionen
1. **Tagesansicht:** kcal-Ziel, Summe, Protein/Fett/KH, Mahlzeiten (Frühstück/Mittag/Abend/Snacks), Datum wechseln. Keine Übergangsanimationen.
2. **Hinzufügen:** eine Suche über Zuletzt/Favoriten, eigene Produkte, Rezepte, BLS und die Online-Suche von Open Food Facts.
3. **Mengen-Dialog:** Eingabe in Gramm, Schnellwahl (letzte Menge, Packungsgröße), Umschalter roh/gekocht über die BLS-Varianten, kcal-Vorschau.
4. **Barcode:** `barcode-detector@3.2.2` (zxing-wasm) per jsDelivr, dann `world.openfoodfacts.org/api/v2/product/{ean}.json`.
   - Plausibilitätscheck: kcal ≈ 4·P + 9·F + 4·KH + 2·Ballaststoffe; bei mehr als 15 % Abweichung warnen und Korrektur anbieten.
   - Korrigierte oder unbekannte Produkte lokal pro Barcode speichern (Werte von der Packung abtippen).
5. **Rezepte / Topf-Methode:** Zutaten roh wiegen, Gesamtgewicht nach dem Kochen eingeben (Leergewicht des Topfs gespeichert), daraus kcal pro 100 g gegart. Gegessene Portion wiegen.
6. **Foto (optional):** eigener API-Key in den Einstellungen. `@anthropic-ai/sdk@1.2.0` (+esm, `dangerouslyAllowBrowser: true`), Modell `claude-opus-5-5`,
   `output_config: { format: { type: 'json_schema', schema } }` → Liste aus {Lebensmittel, geschätzte Gramm, Suchbegriff}. Danach BLS-Treffer zuordnen, als „geschätzt“ markieren, Nutzer korrigiert. Funktioniert auch für Fotos der Nährwerttabelle.
7. **Einstellungen:** Ziele, API-Key, Export/Import als JSON, Quellenangaben.

## Speicherung & Hosting
- localStorage plus `navigator.storage.persist()`, Backup per Export
- Die Kamera braucht HTTPS, deshalb zum Testen GitHub Pages (vorher fragen, öffentliches Repo). Persönliche Daten bleiben nur im Browser.
