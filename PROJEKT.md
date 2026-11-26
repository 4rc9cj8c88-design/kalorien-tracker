# Kalorien-Tracker
Stand: 23.11.2026 · Status: ⏸️ pausiert (bis Buchhaltung, Brüll-Software und mb Luft lassen)

## 🎯 Ziel
Ein grammgenauer Kalorienzähler als iPhone-Web-App (Safari → Home-Bildschirm), der im Alltag schneller und genauer ist als fertige Apps: BLS-Daten, Barcode, Rezepte nach Topf-Methode, Foto-Erkennung. Daten bleiben auf dem Gerät. Später als Modul unter „Gesundheit“ im MB OS (App „mb“).
Fertig, wenn: die App auf dem echten iPhone im Alltag läuft (Scan und Foto getestet) und täglich genutzt wird.

## 📍 Stand
v1.3.0 plus feste Tagesziele (3.050 kcal / 160 g Protein / 80 g Fett / 425 g KH) ist online auf GitHub Pages. Alle Kernfunktionen sind im Browser (iPhone-14-Ansicht) getestet. Der Test auf dem echten iPhone (Kamera-Scan, Foto mit echtem API-Key) fehlt noch.

## ✅ Offene Aufgaben
### Jetzt
- [ ] Test auf echtem iPhone: Barcode-Scan mit Kamera, Foto-Erkennung mit echtem API-Key
### Danach
- [ ] Gefundene Fehler aus dem iPhone-Test beheben
### Später / Ideen
- [ ] Gewichts-Tracking mit Wochenschnitt und kcal-Anpassung im Bulk

## ✔️ Erledigt
- 24.11.2026 – Als Modul „Gesundheit → Ernährung“ in die App „mb“ übernommen (Kopie im mb-Repo unter `ernaehrung/`, Daten dort auf dem eigenen Server, Import der Export-Datei von hier). Diese iPhone-Version bleibt bestehen, bis mb vom Handy erreichbar ist.
- 23.11.2026 – PLAN.md zu PROJEKT.md umgebaut (Ziel, Stand, Aufgaben, Entscheidungen)
- 08.11.2026 – Feste Tagesziele 3.050 kcal / 160 / 80 / 425 g statt Rechner
- 07.11.2026 – v1.3.0: Ziel-Rechner aus Körperdaten (Daten bleiben auf dem Gerät)
- 07.11.2026 – v1.2.0: Einheiten im Mengen-Dialog (g, ml, Stück, Portion, Packung, Anteil vom Topf, EL, TL; Stückgewichte merkbar), „Gekocht“-Knopf (Zutaten einzeln scannen/suchen, Anteil oder Gramm, optional als Rezept speichern)
- 07.11.2026 – v1.1.0: 14 Rezeptvorlagen (`vorlagen.js`: Hähnchen, Hack, Shakes) mit geschätztem Kochgewicht und Portionen; Obst-&-Gemüse-Zähler (Ziel 650 g, BLS-Gruppen F/G/H7/K7/R161)
- 07.11.2026 – v1.0.0 gebaut und im Browser getestet: Suche, Roh/Gar, Barcode→OFF, eigenes Produkt, Rezept/Topf, Woche, Einstellungen, Dark Mode; online auf GitHub Pages
- 07.11.2026 – `data/bls.json`: BLS 4.0 (7.140 Lebensmittel) eingebunden

## 🧭 Entscheidungen
- Daten nur lokal im Browser (localStorage + `navigator.storage.persist()`), Backup per Export – keine Cloud, keine Konten.
- Öffentliches Repo nur für Code; GitHub Pages, weil die Kamera HTTPS braucht. **In diesem Repo nichts Persönliches ablegen – es ist öffentlich.**
- Keine Übergangsanimationen (Seitenwechsel sofort).
- 08.11.2026 – Feste Tagesziele statt Rechner aus Körperdaten.
- Foto-Erkennung nur mit eigenem API-Key in den Einstellungen (optional).

## ❓ Offene Fragen an Miko
- (keine)

## 🗺️ Wo liegt was
- **Lokal:** `~/Desktop/Privat/Projekte/kalorien-tracker` · **Repo:** `4rc9cj8c88-design/kalorien-tracker` (öffentlich)
- **Online:** https://4rc9cj8c88-design.github.io/kalorien-tracker/
- **Lokal testen:** `cd ~/Desktop/Privat/Projekte/kalorien-tracker && python3 -m http.server 8765` → http://localhost:8765 (Kamera nur über HTTPS bzw. localhost)
- **Dateien:** index.html, app.css, app.js (ES-Modul), vorlagen.js, sw.js (offline – **Cache-Version bei Änderungen erhöhen**), manifest.webmanifest, icon-*.png, `data/bls.json`

### Funktionen
1. **Tagesansicht:** kcal-Ziel, Summe, Protein/Fett/KH, Mahlzeiten (Frühstück/Mittag/Abend/Snacks), Datum wechseln.
2. **Hinzufügen:** eine Suche über Zuletzt/Favoriten, eigene Produkte, Rezepte, BLS und die Online-Suche von Open Food Facts.
3. **Mengen-Dialog:** Gramm und Einheiten, Schnellwahl (letzte Menge, Packungsgröße), Umschalter roh/gekocht über die BLS-Varianten, kcal-Vorschau.
4. **Barcode:** `barcode-detector@3.2.2` (zxing-wasm) per jsDelivr, dann `world.openfoodfacts.org/api/v2/product/{ean}.json`.
   - Plausibilitätscheck: kcal ≈ 4·P + 9·F + 4·KH + 2·Ballaststoffe; bei mehr als 15 % Abweichung warnen und Korrektur anbieten.
   - Korrigierte oder unbekannte Produkte lokal pro Barcode speichern.
5. **Rezepte / Topf-Methode:** Zutaten roh wiegen, Gesamtgewicht nach dem Kochen eingeben (Leergewicht des Topfs gespeichert), daraus kcal pro 100 g gegart.
6. **Foto (optional):** `@anthropic-ai/sdk@1.2.0` (+esm, `dangerouslyAllowBrowser: true`), Modell `claude-opus-5-5`, `output_config: { format: { type: 'json_schema', schema } }` → Liste aus {Lebensmittel, geschätzte Gramm, Suchbegriff}; danach BLS-Treffer zuordnen, als „geschätzt“ markieren. Klappt auch für Fotos der Nährwerttabelle.
7. **Einstellungen:** Ziele, API-Key, Export/Import als JSON, Quellenangaben.

### Daten-Hinweise
- BLS-Quelle muss in der App genannt werden (CC BY 4.0): „Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0“.
- Roh- und Gar-Varianten haben dieselben ersten 5 Zeichen im Code (z. B. C352000 Reis roh ↔ C352032 Reis gekocht).
