// Kalorien-Tracker – läuft komplett im Browser, Daten bleiben auf dem Gerät.
import { VORLAGEN, CUSTOM } from './vorlagen.js';
const VERSION = '1.2.0';
const FV_GOAL = 650; // DGE: 400 g Gemüse + 250 g Obst pro Tag
const STORE_KEY = 'kt.v1';
const BARCODE_LIB = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/es/ponyfill.js/+esm';
const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.2.0/+esm';
const CLAUDE_MODEL = 'claude-opus-5-5';
const OFF_FIELDS = 'code,product_name,product_name_de,brands,nutriments,serving_quantity,product_quantity,quantity';

const MEALS = [
  { id: 'fruehstueck', label: 'Frühstück' },
  { id: 'mittag', label: 'Mittagessen' },
  { id: 'abend', label: 'Abendessen' },
  { id: 'snacks', label: 'Snacks' },
];
const NUTS = [
  ['kcal', 'Energie', 'kcal'],
  ['protein', 'Eiweiß', 'g'],
  ['fat', 'Fett', 'g'],
  ['satfat', '  davon gesättigt', 'g'],
  ['carbs', 'Kohlenhydrate', 'g'],
  ['sugar', '  davon Zucker', 'g'],
  ['fiber', 'Ballaststoffe', 'g'],
  ['salt', 'Salz', 'g'],
];

/* ---------- Speicher ---------- */
const defaults = () => ({
  settings: { kcal: 2200, protein: 150, fat: 75, carbs: 230, apiKey: '' },
  days: {},          // 'YYYY-MM-DD' -> [entry]
  products: {},      // eigene / korrigierte Produkte, Schlüssel = EAN oder id
  recipes: [],
  recent: [],        // zuletzt benutzte Lebensmittel (Snapshots)
  lastGrams: {},     // key -> zuletzt gegessene Menge
  lastUnit: {},      // key -> { u, q } zuletzt benutzte Einheit
  pieceW: {},        // key -> Gramm pro Stück (vom Nutzer)
  pots: [],          // { id, name, tare }
});
let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaults(), JSON.parse(raw));
  } catch (e) { console.warn(e); }
  return defaults();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen – bitte Backup exportieren'); }
}
try { navigator.storage?.persist?.(); } catch {}

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (n, d = 0) => (Number.isFinite(n) ? n : 0).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
// Für Eingabefelder: ohne Tausenderpunkt, sonst wird 1.200 als 1,2 gelesen.
const fmtIn = (n, d = 1) => (Number.isFinite(n) ? n : 0).toLocaleString('de-DE', { maximumFractionDigits: d, useGrouping: false });
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const norm = (s) => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function defaultMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'fruehstueck';
  if (h < 15) return 'mittag';
  if (h >= 17.5 && h < 21.5) return 'abend';
  return 'snacks';
}

/* ---------- Nährwerte ---------- */
function calc(per100, grams) {
  const f = (grams || 0) / 100;
  const out = {};
  for (const [k] of NUTS) out[k] = (per100?.[k] || 0) * f;
  return out;
}
// BLS: F = Obst, G = Gemüse, H7 = Hülsenfrüchte, K7 = Pilze, R161 = passierte Tomaten
const isFV = (code) => !!code && /^(F|G|H7|K7|R161)/.test(code);
function fvOf(food) {
  if (food.fv != null) return food.fv;
  return isFV(food.code) ? 100 : 0;
}
function sumFV(entries) { return entries.reduce((a, e) => a + (fvOf(e) * (e.grams || 0)) / 100, 0); }
function sumEntries(entries) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, salt: 0, satfat: 0 };
  for (const e of entries) {
    const n = calc(e.per100, e.grams);
    for (const k in t) t[k] += n[k];
  }
  return t;
}
// Prüft, ob die kcal-Angabe zu den Makros passt (Atwater: 4/9/4, Ballaststoffe 2).
function plausibility(p) {
  if (!p || p.kcal == null) return { level: 'warn', text: 'Keine Kalorienangabe vorhanden.' };
  const fiber = p.fiber || 0;
  const calcK = 4 * (p.protein || 0) + 9 * (p.fat || 0) + 4 * (p.carbs || 0) + 2 * fiber;
  const mass = (p.protein || 0) + (p.fat || 0) + (p.carbs || 0) + fiber;
  if (mass > 102) return { level: 'warn', text: `Unmöglich: ${fmt(mass, 1)} g Nährstoffe pro 100 g. Die Daten sind fehlerhaft.` };
  if (p.protein == null || p.fat == null || p.carbs == null) return { level: 'warn', text: 'Makronährstoffe unvollständig – Werte bitte mit der Packung vergleichen.' };
  const diff = Math.abs(p.kcal - calcK);
  if (diff > 15 && diff / Math.max(p.kcal, calcK, 1) > 0.15) {
    return { level: 'warn', text: `Angabe ${fmt(p.kcal)} kcal, aus den Makros berechnet ${fmt(calcK)} kcal. Bitte mit der Packung vergleichen.`, calcK };
  }
  return { level: 'ok', text: 'Kalorien passen zu den Makros.' };
}

/* ---------- Bundeslebensmittelschlüssel ---------- */
let bls = null;      // { foods: [...], index: [...] }
let blsLoading = null;
function loadBLS() {
  if (bls) return Promise.resolve(bls);
  if (!blsLoading) {
    blsLoading = fetch('data/bls.json').then((r) => r.json()).then((d) => {
      const foods = d.foods.map((r) => ({
        code: r[0], name: r[1],
        per100: { kcal: r[2], protein: r[3], fat: r[4], carbs: r[5], fiber: r[6], sugar: r[7], salt: r[8], satfat: r[9] },
      }));
      const index = foods.map((f) => norm(f.name));
      bls = { foods, index, compact: index.map((n) => n.replace(/[^a-z0-9]/g, '')), byCode: new Map(foods.map((f) => [f.code, f])) };
      return bls;
    }).catch((e) => { blsLoading = null; throw e; });
  }
  return blsLoading;
}
const blsFood = (f) => ({ key: 'bls:' + f.code, src: 'bls', code: f.code, name: f.name, per100: { ...f.per100 } });

// Alltagswörter -> Begriffe, wie sie im BLS stehen
const SYNONYMS = {
  nudeln: ['teigwaren'], pasta: ['teigwaren'], spaghetti: ['teigwaren'], penne: ['teigwaren'],
  ei: ['huhnerei'], eier: ['huhnerei'], truthahn: ['pute'], puten: ['pute'],
  hahnchen: ['hahnchen', 'huhn'], hendl: ['hahnchen'], kartoffeln: ['kartoffel'], tomaten: ['tomate'],
  mohren: ['mohre', 'karotte'], karotten: ['karotte', 'mohre'], gurke: ['gurke', 'salatgurke'],
};
function searchBLS(q, limit = 25) {
  if (!bls) return [];
  const toks = norm(q).split(/[\s,]+/).filter(Boolean);
  if (!toks.length) return [];
  const alts = toks.map((t) => [t, ...(SYNONYMS[t] || [])]);
  const qCompact = toks.join('');
  const res = [];
  for (let i = 0; i < bls.foods.length; i++) {
    const n = bls.index[i];
    const c = bls.compact[i];
    if (!alts.every((a) => a.some((t) => n.includes(t) || c.includes(t)))) continue;
    let s = 0;
    if (c === qCompact) s += 80;
    if (alts[0].some((t) => n.startsWith(t) || c.startsWith(t))) s += 40;
    for (const a of alts) if (a.some((t) => new RegExp('(^|[\\s,(/-])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n))) s += 10;
    if (/\broh\b/.test(n)) s += 6;
    const g = bls.foods[i].code[0];
    if (g === 'X' || g === 'Y') s -= 8; // zusammengesetzte Gerichte nach hinten
    s -= n.length / 8;
    res.push([s, bls.foods[i]]);
  }
  return res.sort((a, b) => b[0] - a[0]).slice(0, limit).map((r) => r[1]);
}
// Roh-/Gar-Varianten teilen sich die ersten 5 Zeichen des BLS-Codes.
function blsVariants(code) {
  if (!bls || !code) return [];
  const pre = code.slice(0, 5);
  return bls.foods.filter((f) => f.code.startsWith(pre));
}

/* ---------- Open Food Facts ---------- */
function mapOFF(p) {
  const n = p.nutriments || {};
  const g = (k) => (n[k] === undefined || n[k] === '' ? null : Number(n[k]));
  let kcal = g('energy-kcal_100g');
  if (kcal == null && g('energy_100g') != null) kcal = g('energy_100g') / 4.184;
  return {
    key: 'off:' + p.code, src: 'off', ean: p.code,
    name: p.product_name_de || p.product_name || 'Unbenanntes Produkt',
    brand: (p.brands || '').split(',')[0].trim(),
    per100: { kcal, protein: g('proteins_100g'), fat: g('fat_100g'), carbs: g('carbohydrates_100g'), fiber: g('fiber_100g'), sugar: g('sugars_100g'), salt: g('salt_100g'), satfat: g('saturated-fat_100g') },
    serving: num(p.serving_quantity),
    pkg: num(p.product_quantity),
  };
}
async function fetchOFF(ean) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${OFF_FIELDS}`);
  if (!r.ok && r.status !== 404) throw new Error('Open Food Facts nicht erreichbar');
  const d = await r.json();
  return d.status === 1 && d.product ? mapOFF({ ...d.product, code: d.product.code || ean }) : null;
}
async function searchOFF(q) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&lc=de&tagtype_0=countries&tag_contains_0=contains&tag_0=germany&fields=${OFF_FIELDS}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Suche fehlgeschlagen');
  const d = await r.json();
  return (d.products || []).filter((p) => p.code && p.nutriments).map(mapOFF);
}
function validEAN(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/* ---------- Lebensmittel auflösen ---------- */
function recipeFood(r) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, salt: 0, satfat: 0 };
  let raw = 0, fv = 0;
  for (const it of r.items) {
    const n = calc(it.food.per100, it.grams);
    for (const k in t) t[k] += n[k];
    raw += it.grams;
    fv += (fvOf(it.food) * it.grams) / 100;
  }
  const weight = r.cooked || raw || 1;
  const per100 = {};
  for (const k in t) per100[k] = (t[k] / weight) * 100;
  const serving = r.portions > 0 ? Math.round(weight / r.portions) : undefined;
  return { key: 'rec:' + r.id, src: 'recipe', recipeId: r.id, name: r.name, per100, total: t, raw, weight, serving, fv: (fv / weight) * 100 };
}
function ownProductFor(ean) { return ean && state.products[ean] ? { ...state.products[ean] } : null; }
function srcLabel(f) {
  return { bls: 'BLS', off: 'Open Food Facts', own: 'Eigenes', recipe: 'Rezept', est: 'Geschätzt' }[f.src] || f.src;
}

/* ---------- Einheiten ---------- */
// Gramm pro ml nach BLS-Gruppe (Öle leichter, Honig schwerer als Wasser)
function density(f) {
  const c = f.code || '';
  if (/^Q/.test(c)) return 0.92;
  if (/^M1/.test(c)) return 1.03;
  if (/^S12/.test(c)) return 1.4;
  return 1;
}
// Typische Stückgewichte (essbarer Anteil), Schlüssel = erste 5 Zeichen des BLS-Codes
const PIECE = {
  E1111: 60, F5031: 120, F1101: 150, F1201: 140, F6011: 80, F5161: 300, B7830: 62, K1101: 100, K1201: 100,
  K4201: 250, G4801: 80, G4901: 4, G5611: 80, G5431: 160, G5411: 160, G5421: 160, G6201: 80, G5201: 400,
  G5821: 250, G3121: 400, K7011: 20,
};
const pieceWeight = (f) => state.pieceW[f.key] || (f.code && PIECE[f.code.slice(0, 5)]) || null;
function unitsFor(f) {
  const d = density(f);
  const u = [{ id: 'g', label: 'g', g: 1 }, { id: 'ml', label: 'ml', g: d }, { id: 'stk', label: 'Stück', g: pieceWeight(f) }];
  if (f.serving) u.push({ id: 'port', label: 'Portion', g: f.serving });
  if (f.pkg) u.push({ id: 'pack', label: 'Packung', g: f.pkg });
  if (f.src === 'recipe' && f.weight) u.push({ id: 'anteil', label: 'Anteil vom Topf', g: f.weight });
  u.push({ id: 'el', label: 'EL', g: 15 * d }, { id: 'tl', label: 'TL', g: 5 * d });
  return u;
}
// "1/3", "1 1/2", "½", "0,5" -> Zahl
const FRAC = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5' };
function qtyNum(v) {
  let t = String(v ?? '').trim().replace(/[½⅓⅔¼¾⅕]/g, (c) => ' ' + FRAC[c]).trim().replace(',', '.');
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  return num(t);
}
function qtyLabel(q) {
  for (const [sym, fr] of Object.entries(FRAC)) { const [a, b] = fr.split('/'); if (Math.abs(q - a / b) < 0.002) return sym; }
  return fmt(q, 2);
}
const UNIT_TXT = { ml: 'ml', stk: 'Stück', port: 'Portion', pack: 'Packung', anteil: 'vom Topf', el: 'EL', tl: 'TL' };
// "2 Stück · 120 g" oder "120 g"
function amountText(x) {
  if (!x.u || x.u === 'g' || !x.q) return `${fmt(x.grams)} g`;
  return `${qtyLabel(x.q)} ${UNIT_TXT[x.u] || x.u} · ${fmt(x.grams)} g`;
}

function remember(food, grams) {
  const snap = { key: food.key, src: food.src, code: food.code, fv: food.fv, ean: food.ean, recipeId: food.recipeId, name: food.name, brand: food.brand, per100: food.per100, serving: food.serving, pkg: food.pkg };
  state.recent = [snap, ...state.recent.filter((f) => f.key !== food.key)].slice(0, 40);
  if (grams) state.lastGrams[food.key] = grams;
}
function logFood(food, grams, meal, est = false, uq = null) {
  const day = (state.days[currentDate] ||= []);
  day.push({ id: uid(), key: food.key, src: food.src, code: food.code, ean: food.ean, recipeId: food.recipeId, name: food.name, brand: food.brand, per100: { ...food.per100 }, fv: fvOf(food),
    serving: food.serving, pkg: food.pkg, weight: food.weight, grams, meal, est, ...(uq && uq.u !== 'g' ? uq : {}), t: Date.now() });
  if (!est) remember(food, grams);
  save();
}

/* ---------- Ansichten ---------- */
let currentDate = todayKey();
let tab = 'tag';

function renderHeader() {
  const t = todayKey();
  const label = currentDate === t ? 'Heute' : currentDate === addDays(t, -1) ? 'Gestern' : currentDate === addDays(t, 1) ? 'Morgen'
    : parseKey(currentDate).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#dateLabel').textContent = label;
  $('#datePicker').value = currentDate;
}

function render() {
  renderHeader();
  $$('.tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view');
  if (tab === 'tag') v.innerHTML = viewTag();
  if (tab === 'woche') v.innerHTML = viewWoche();
  if (tab === 'rezepte') v.innerHTML = viewRezepte();
  if (tab === 'einstellungen') v.innerHTML = viewSettings();
  bindView(v);
}

function macroBox(label, val, goal, color) {
  const pct = goal ? Math.min(100, (val / goal) * 100) : 0;
  return `<div class="macro"><div class="label">${label}</div><div class="val num">${fmt(val)}<span class="muted small"> / ${fmt(goal)} g</span></div><div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}

function viewTag() {
  const entries = state.days[currentDate] || [];
  const t = sumEntries(entries);
  const s = state.settings;
  const left = s.kcal - t.kcal;
  const pct = Math.min(100, (t.kcal / s.kcal) * 100);
  let html = currentDate !== todayKey() ? '<button class="chip" data-today style="margin-bottom:10px">← Zurück zu heute</button>' : '';
  html += `<section class="card">
    <div class="row between">
      <div class="summary-kcal"><span class="big num">${fmt(t.kcal)}</span><span class="muted">/ ${fmt(s.kcal)} kcal</span></div>
      <div class="num ${left < 0 ? '' : 'muted'}" style="${left < 0 ? 'color:var(--danger);font-weight:600' : ''}">${left < 0 ? fmt(-left) + ' zu viel' : 'noch ' + fmt(left)}</div>
    </div>
    <div class="bar ${left < 0 ? 'over' : ''}"><i style="width:${pct}%"></i></div>
    <div class="macros">
      ${macroBox('Eiweiß', t.protein, s.protein, 'var(--p)')}
      ${macroBox('Fett', t.fat, s.fat, 'var(--f)')}
      ${macroBox('Kohlenhydrate', t.carbs, s.carbs, 'var(--c)')}
    </div>
    <div class="macros" style="grid-template-columns:1fr">${macroBox('Obst & Gemüse', sumFV(entries), s.fvGoal || FV_GOAL, 'var(--accent)')}</div>
    <div class="small muted" style="margin-top:10px">Ballaststoffe ${fmt(t.fiber, 1)} g · Zucker ${fmt(t.sugar, 1)} g · Salz ${fmt(t.salt, 1)} g</div>
  </section>`;
  for (const m of MEALS) {
    const list = entries.filter((e) => e.meal === m.id);
    const mk = list.reduce((a, e) => a + calc(e.per100, e.grams).kcal, 0);
    html += `<section class="card">
      <div class="meal-head"><h2>${m.label} <span class="muted num" style="font-weight:400">${list.length ? fmt(mk) + ' kcal' : ''}</span></h2>
      <button class="meal-add" data-add="${m.id}">+ Hinzufügen</button></div>
      ${list.length ? list.map(entryRow).join('') : '<div class="empty">Noch nichts eingetragen</div>'}
    </section>`;
  }
  return html;
}
function entryRow(e) {
  const k = calc(e.per100, e.grams).kcal;
  return `<button class="entry" data-entry="${e.id}">
    <div class="grow"><div class="name">${esc(e.name)}</div>
    <div class="sub num">${amountText(e)}${e.brand ? ' · ' + esc(e.brand) : ''} ${e.est ? '<span class="badge est">geschätzt</span>' : ''}</div></div>
    <div class="kcal num">${fmt(k)} kcal</div></button>`;
}

function viewWoche() {
  const s = state.settings;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const k = addDays(currentDate, -i);
    const list = state.days[k] || [];
    days.push({ k, t: { ...sumEntries(list), fv: sumFV(list) } });
  }
  const max = Math.max(s.kcal * 1.2, ...days.map((d) => d.t.kcal));
  const logged = days.filter((d) => d.t.kcal > 0);
  const avg = (f) => (logged.length ? logged.reduce((a, d) => a + d.t[f], 0) / logged.length : 0);
  return `<section class="card"><h2>Letzte 7 Tage</h2>
    <div class="week">${days.map((d) => `<div class="col"><span class="small num">${d.t.kcal ? fmt(d.t.kcal) : ''}</span><i class="${d.t.kcal > s.kcal ? 'over' : ''}" style="height:${(d.t.kcal / max) * 100}%"></i><small>${parseKey(d.k).toLocaleDateString('de-DE', { weekday: 'short' })}</small></div>`).join('')}</div>
    <div class="small muted">Ziel ${fmt(s.kcal)} kcal pro Tag</div></section>
    <section class="card"><h2>Durchschnitt (${logged.length} Tage mit Einträgen)</h2>
    <table class="nut-table">
      <tr><td>Energie</td><td class="num">${fmt(avg('kcal'))} kcal</td></tr>
      <tr><td>Eiweiß</td><td class="num">${fmt(avg('protein'))} g</td></tr>
      <tr><td>Fett</td><td class="num">${fmt(avg('fat'))} g</td></tr>
      <tr><td>Kohlenhydrate</td><td class="num">${fmt(avg('carbs'))} g</td></tr>
      <tr><td>Ballaststoffe</td><td class="num">${fmt(avg('fiber'), 1)} g</td></tr>
      <tr><td>Obst & Gemüse</td><td class="num">${fmt(avg('fv'))} g <span class="muted">/ ${fmt(s.fvGoal || FV_GOAL)} g</span></td></tr>
    </table></section>`;
}

function viewRezepte() {
  return `<section class="card"><h2>Rezepte & Topf-Methode</h2>
    <p class="small muted" style="margin:0 0 12px">Zutaten roh wiegen, nach dem Kochen das Gesamtgewicht wiegen – dann nur noch deine Portion auf dem Teller wiegen. So stimmen die Kalorien auch bei Nudeln, Reis und Fleisch, die beim Kochen Wasser aufnehmen oder verlieren.</p>
    <button class="btn primary block" data-new-recipe>+ Neues Rezept</button></section>
    ${state.recipes.length ? `<div class="list">${state.recipes.map((r) => {
      const f = recipeFood(r);
      return `<button class="item" data-recipe="${r.id}"><div class="grow"><div class="name">${esc(r.name)}</div>
        <div class="sub num">${r.items.length} Zutaten · ${fmt(f.weight)} g ${r.cooked ? (r.estCooked ? 'gekocht (geschätzt)' : 'gekocht') : 'roh (Kochgewicht fehlt)'}</div></div>
        <div class="num">${fmt(f.per100.kcal)} <span class="small muted">kcal/100 g</span></div></button>`;
    }).join('')}</div>` : ''}
    ${viewVorlagen()}`;
}
function viewVorlagen() {
  if (!bls) { loadBLS().then(() => { if (tab === 'rezepte') render(); }).catch(() => {}); return '<p class="small muted">Vorlagen werden geladen …</p>'; }
  const cats = [...new Set(VORLAGEN.map((t) => t.cat))];
  return `<div class="list-title" style="margin-top:18px">Vorlagen</div>
    <p class="small muted" style="margin:0 0 10px">Antippen, Mengen anpassen und sichern. Das Kochgewicht ist erst geschätzt – nach dem Kochen einmal den Topf wiegen.</p>
    ${cats.map((c) => `<div class="list-title">${esc(c)}</div><div class="list">${VORLAGEN.filter((t) => t.cat === c).map((t) => {
      const f = recipeFood(tplRecipe(t));
      const n = calc(f.per100, f.serving);
      return `<button class="item" data-tpl="${t.id}"><div class="grow"><div class="name">${esc(t.name)}</div>
        <div class="sub num">${t.portions} ${t.portions === 1 ? 'Portion' : 'Portionen'} · je ${fmt(n.protein)} g Eiweiß · ${fmt((f.fv * f.serving) / 100)} g Obst & Gemüse</div></div>
        <div class="num">${fmt(n.kcal)} <span class="small muted">kcal/Port.</span></div></button>`;
    }).join('')}</div>`).join('')}`;
}
// Vorlage -> neues (noch nicht gespeichertes) Rezept. Braucht geladenen BLS.
function tplRecipe(t) {
  const items = [];
  let cooked = 0, allRaw = true;
  for (const [code, grams, cf] of t.items) {
    const food = CUSTOM[code] ? { ...CUSTOM[code], per100: { ...CUSTOM[code].per100 } } : bls.byCode.get(code) && blsFood(bls.byCode.get(code));
    if (!food) continue;
    items.push({ food, grams });
    cooked += grams * cf;
    if (cf !== 1) allRaw = false;
  }
  return { id: uid(), name: t.name, items, portions: t.portions, note: t.note || '', cooked: allRaw ? null : Math.round(cooked / 10) * 10, estCooked: !allRaw };
}

function viewSettings() {
  const s = state.settings;
  return `<section class="card"><h2>Tagesziele</h2>
    <div class="grid2">
      <label class="field"><span>Kalorien (kcal)</span><input class="input num" inputmode="numeric" data-set="kcal" value="${s.kcal}"></label>
      <label class="field"><span>Eiweiß (g)</span><input class="input num" inputmode="numeric" data-set="protein" value="${s.protein}"></label>
      <label class="field"><span>Fett (g)</span><input class="input num" inputmode="numeric" data-set="fat" value="${s.fat}"></label>
      <label class="field"><span>Kohlenhydrate (g)</span><input class="input num" inputmode="numeric" data-set="carbs" value="${s.carbs}"></label>
      <label class="field"><span>Obst & Gemüse (g)</span><input class="input num" inputmode="numeric" data-set="fvGoal" value="${s.fvGoal || FV_GOAL}"></label>
    </div></section>

    <section class="card"><h2>Töpfe & Schüsseln (Leergewicht)</h2>
    <p class="small muted" style="margin:0 0 10px">Damit du bei Rezepten einfach den vollen Topf wiegen kannst.</p>
    ${state.pots.map((p) => `<div class="row" style="margin-bottom:8px"><div class="grow">${esc(p.name)}</div><div class="num">${fmt(p.tare)} g</div><button class="btn danger" data-del-pot="${p.id}">Löschen</button></div>`).join('')}
    <div class="row"><input class="input grow" id="potName" placeholder="z. B. Großer Topf"><input class="input num" id="potTare" inputmode="decimal" placeholder="g" style="width:90px"><button class="btn" id="addPot">+</button></div>
    </section>

    <section class="card"><h2>Foto-Erkennung (Claude)</h2>
    <p class="small muted" style="margin:0 0 10px">Für Fotos von Mahlzeiten und Nährwerttabellen brauchst du einen eigenen API-Key von <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. Der Key bleibt nur auf diesem Gerät. Ein Foto kostet etwa 1–2 Cent.</p>
    <label class="field"><span>API-Key</span><input class="input" type="password" autocomplete="off" data-set="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…"></label>
    </section>

    <section class="card"><h2>Daten</h2>
    <p class="small muted" style="margin:0 0 10px">Alles ist nur auf diesem Gerät gespeichert. Mach ab und zu ein Backup.</p>
    <div class="grid2"><button class="btn" id="exportBtn">Backup exportieren</button><button class="btn" id="importBtn">Backup laden</button></div>
    <input type="file" id="importFile" accept="application/json" class="visually-hidden">
    </section>

    <section class="card small muted"><h2 style="color:var(--text)">Quellen</h2>
    Nährwerte frischer Lebensmittel: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0, Lizenz CC BY 4.0.<br><br>
    Markenprodukte: Open Food Facts (openfoodfacts.org), Lizenz ODbL.<br><br>Version ${VERSION}</section>`;
}

function bindView(v) {
  $$('[data-add]', v).forEach((b) => b.onclick = () => openAdd({ mode: 'log', meal: b.dataset.add }));
  $$('[data-entry]', v).forEach((b) => b.onclick = () => {
    const e = (state.days[currentDate] || []).find((x) => x.id === b.dataset.entry);
    if (e) openAmount({ ...e }, { mode: 'edit', entry: e });
  });
  $$('[data-today]', v).forEach((b) => b.onclick = () => { currentDate = todayKey(); render(); });
  $$('[data-new-recipe]', v).forEach((b) => b.onclick = () => openRecipe(null));
  $$('[data-recipe]', v).forEach((b) => b.onclick = () => openRecipe(state.recipes.find((r) => r.id === b.dataset.recipe)));
  $$('[data-tpl]', v).forEach((b) => b.onclick = () => openRecipe(tplRecipe(VORLAGEN.find((t) => t.id === b.dataset.tpl))));
  $$('[data-set]', v).forEach((inp) => inp.onchange = () => {
    const k = inp.dataset.set;
    state.settings[k] = k === 'apiKey' ? inp.value.trim() : (num(inp.value) || state.settings[k]);
    save();
    toast('Gespeichert');
  });
  $$('[data-del-pot]', v).forEach((b) => b.onclick = () => { state.pots = state.pots.filter((p) => p.id !== b.dataset.delPot); save(); render(); });
  const addPot = $('#addPot', v);
  if (addPot) addPot.onclick = () => {
    const name = $('#potName', v).value.trim(); const tare = num($('#potTare', v).value);
    if (!name || !tare) return toast('Name und Gewicht eingeben');
    state.pots.push({ id: uid(), name, tare }); save(); render();
  };
  const ex = $('#exportBtn', v);
  if (ex) ex.onclick = exportData;
  const im = $('#importBtn', v);
  if (im) { im.onclick = () => $('#importFile', v).click(); $('#importFile', v).onchange = (ev) => importData(ev.target.files[0]); }
}

function exportData() {
  const copy = { ...state, settings: { ...state.settings, apiKey: '' } };
  const blob = new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kalorien-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.days || !data.settings) throw new Error();
    if (!confirm('Backup laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return;
    const key = state.settings.apiKey;
    state = Object.assign(defaults(), data);
    if (!state.settings.apiKey) state.settings.apiKey = key;
    save(); render(); toast('Backup geladen');
  } catch { toast('Datei ist kein gültiges Backup'); }
}

/* ---------- Sheets (Vollbild-Ebenen) ---------- */
const sheetStack = [];
function pushSheet({ title, left = 'Abbrechen', right, body, mount, onClose }) {
  const el = document.createElement('section');
  el.className = 'sheet';
  el.innerHTML = `<div class="sheet-head"><button class="link" data-close>${esc(left)}</button><h1>${esc(title)}</h1>
    ${right ? `<button class="link right" data-right>${esc(right.label)}</button>` : '<span class="link"></span>'}</div>
    <div class="sheet-body"><div class="inner">${body}</div></div>`;
  $('#sheets').appendChild(el);
  const entry = { el, onClose };
  sheetStack.push(entry);
  $('[data-close]', el).onclick = () => popSheet();
  if (right) $('[data-right]', el).onclick = () => right.onClick(el);
  document.body.style.overflow = 'hidden';
  mount?.(el);
  return el;
}
function popSheet(count = 1) {
  for (let i = 0; i < count; i++) {
    const s = sheetStack.pop();
    if (!s) break;
    s.onClose?.();
    s.el.remove();
  }
  if (!sheetStack.length) document.body.style.overflow = '';
}
function closeAllSheets() { popSheet(sheetStack.length); }

/* ---------- Hinzufügen / Suche ---------- */
function openAdd(target) {
  const isPick = target.mode === 'pick';
  const body = `
    <div class="search-wrap"><input class="input" id="q" type="search" placeholder="Lebensmittel suchen, z. B. Haferflocken" autocomplete="off" enterkeyhint="search"></div>
    ${isPick ? '' : `<div class="quick">
      <button id="qScan"><b>▥</b>Barcode</button>
      <button id="qPhoto"><b>◉</b>Foto</button>
      <button id="qCook"><b>♨</b>Gekocht</button>
      <button id="qOwn"><b>✎</b>Eigenes</button>
    </div>`}
    ${isPick ? `<div class="quick" style="grid-template-columns:1fr 1fr"><button id="qScan"><b>▥</b>Barcode</button><button id="qOwn"><b>✎</b>Eigenes</button></div>` : ''}
    <div id="results"></div>`;
  const el = pushSheet({
    title: isPick ? 'Zutat hinzufügen' : 'Hinzufügen · ' + MEALS.find((m) => m.id === target.meal).label,
    body,
    mount(el) {
      const q = $('#q', el);
      const results = $('#results', el);
      let timer;
      const run = () => renderResults(results, q.value, target);
      q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 120); };
      $('#qScan', el).onclick = () => openScanner(target);
      $('#qOwn', el).onclick = () => openProductForm({}, target);
      const ph = $('#qPhoto', el);
      if (ph) ph.onclick = () => openPhoto('meal', target);
      const ck = $('#qCook', el);
      if (ck) ck.onclick = () => openRecipe(null, { quick: true, meal: target.meal });
      run();
      loadBLS().then(() => { if (q.value) run(); }).catch(() => toast('Lebensmittel-Datenbank konnte nicht geladen werden'));
    },
  });
  return el;
}

function foodItem(f, i, extra = '') {
  const k = f.per100?.kcal;
  const last = state.lastGrams[f.key];
  return `<button class="item" data-i="${i}"><div class="grow"><div class="name">${esc(f.name)}</div>
    <div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}${srcLabel(f)}${last ? ' · zuletzt ' + fmt(last) + ' g' : ''}${extra}</div></div>
    <div class="num">${k == null ? '–' : fmt(k)} <span class="small muted">kcal</span></div></button>`;
}

function renderResults(box, query, target) {
  const q = norm(query.trim());
  const pool = [];
  const sections = [];
  const add = (title, foods, extraHtml = '') => {
    if (!foods.length && !extraHtml) return;
    const start = pool.length;
    pool.push(...foods);
    sections.push(`<div class="list-title">${title}</div>${foods.length ? `<div class="list">${foods.map((f, j) => foodItem(f, start + j)).join('')}</div>` : ''}${extraHtml}`);
  };
  if (!q) {
    add('Zuletzt verwendet', state.recent.slice(0, 20));
    if (!state.recent.length) sections.push('<p class="muted small">Tipp: Wiege alles mit einer Küchenwaage und gib Gramm ein – das ist der größte Hebel für genaue Werte.</p>');
  } else {
    const match = (f) => q.split(/\s+/).every((t) => norm(f.name + ' ' + (f.brand || '')).includes(t));
    const recipes = state.recipes.map(recipeFood).filter(match);
    const own = Object.values(state.products).filter(match);
    const recent = state.recent.filter(match).filter((f) => !own.some((o) => o.key === f.key));
    add('Meine Rezepte', recipes);
    add('Meine Produkte', own);
    add('Zuletzt verwendet', recent.slice(0, 8));
    if (bls) add('Frische Lebensmittel (BLS)', searchBLS(query).map(blsFood));
    else sections.push('<p class="muted small"><span class="spinner"></span> Datenbank wird geladen…</p>');
    sections.push(`<div class="list-title">Markenprodukte</div><div id="offBox"><button class="btn block" id="offBtn">Online bei Open Food Facts suchen</button></div>`);
  }
  box.innerHTML = sections.join('');
  const bindItems = (root) => $$('[data-i]', root).forEach((b) => b.onclick = () => pickFood(pool[Number(b.dataset.i)], target));
  bindItems(box);
  const offBtn = $('#offBtn', box);
  if (offBtn) offBtn.onclick = async () => {
    const ob = $('#offBox', box);
    ob.innerHTML = '<p class="muted small"><span class="spinner"></span> Suche läuft…</p>';
    try {
      const found = await searchOFF(query.trim());
      if (!found.length) { ob.innerHTML = '<p class="muted small">Nichts gefunden. Scanne den Barcode oder lege das Produkt selbst an.</p>'; return; }
      const start = pool.length;
      pool.push(...found);
      ob.innerHTML = `<div class="list">${found.map((f, j) => foodItem(f, start + j, plausibility(f.per100).level === 'warn' ? ' · <span class="badge est">prüfen</span>' : '')).join('')}</div>`;
      bindItems(ob);
    } catch { ob.innerHTML = '<p class="muted small">Open Food Facts ist gerade nicht erreichbar.</p>'; }
  };
}

function pickFood(food, target) {
  // Eigene Korrektur eines Barcode-Produkts hat Vorrang.
  const own = food.src === 'off' ? ownProductFor(food.ean) : null;
  const f = own || food;
  if (f.src === 'recipe') {
    const r = state.recipes.find((x) => x.id === f.recipeId);
    if (r) return openAmount(recipeFood(r), target);
  }
  openAmount(f, target);
}

/* ---------- Mengen-Dialog ---------- */
function openAmount(food, target) {
  let f = { ...food, per100: { ...food.per100 } };
  const editing = target.mode === 'edit';
  const isPick = target.mode === 'pick';
  let meal = editing ? target.entry.meal : (target.meal || defaultMeal());

  // Start-Einheit und -Menge
  let unit = 'g', qtyStr;
  const has = (id) => unitsFor(f).some((x) => x.id === id);
  const src = editing ? target.entry : target.unit ? { u: target.unit, q: target.q } : target.grams ? { u: target.u, q: target.q, grams: target.grams } : state.lastUnit[f.key];
  if (src?.u && src.u !== 'g' && src.q && has(src.u)) { unit = src.u; qtyStr = src.u === 'anteil' ? qtyLabel(src.q) : fmtIn(src.q, 2); }
  else if (!editing && !target.grams && !state.lastGrams[f.key] && f.src === 'recipe' && f.serving) { unit = 'port'; qtyStr = '1'; }
  else qtyStr = fmtIn(editing ? target.entry.grams : (target.grams || state.lastGrams[f.key] || f.serving || 100));

  const unitObj = () => unitsFor(f).find((x) => x.id === unit) || { id: 'g', g: 1 };
  const chips = () => {
    if (unit === 'g') {
      const opts = [];
      const last = state.lastGrams[f.key];
      if (last) opts.push([fmtIn(last), `${fmt(last)} g (zuletzt)`]);
      for (const g of [50, 100, 150, 200, 250]) if (!opts.some((o) => o[0] === String(g))) opts.push([String(g), `${g} g`]);
      return opts.slice(0, 6);
    }
    if (unit === 'ml') return [100, 200, 250, 330, 500].map((x) => [String(x), `${x} ml`]);
    if (unit === 'anteil') return [['1', 'Alles'], ['1/2', '½'], ['1/3', '⅓'], ['1/4', '¼'], ['1/5', '⅕'], ['2/3', '⅔']];
    if (unit === 'port' || unit === 'pack') return [['1/2', '½'], ['1', '1'], ['2', '2']];
    return [1, 2, 3, 4].map((x) => [String(x), String(x)]);
  };

  const body = () => {
    const pl = f.src === 'off' || f.src === 'own' ? plausibility(f.per100) : null;
    const variants = f.src === 'bls' ? blsVariants(f.code) : [];
    const rec = f.src === 'recipe' ? state.recipes.find((x) => x.id === f.recipeId) : null;
    const u = unitObj();
    return `
    <div class="row" style="margin-bottom:6px"><span class="badge">${srcLabel(f)}</span>${f.brand ? `<span class="small muted">${esc(f.brand)}</span>` : ''}${target.entry?.est ? '<span class="badge est">geschätzt</span>' : ''}</div>
    ${pl && pl.level === 'warn' ? `<div class="note warn">⚠︎ ${esc(pl.text)} <button class="btn" style="margin-top:8px;padding:6px 10px" id="fixBtn">Werte korrigieren</button></div>` : ''}
    ${variants.length > 1 ? `<label class="field"><span>So habe ich es gewogen</span><select class="input" id="variant">
      ${variants.map((v) => `<option value="${v.code}" ${v.code === f.code ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>` : ''}
    ${f.src === 'recipe' && f.weight ? `<div class="note">Im Topf: ${fmt(f.weight)} g ${rec?.cooked ? (rec.estCooked ? 'gekocht (geschätzt)' : 'gekocht') : 'roh gerechnet'}. ${rec?.cooked || (!rec && f.weight !== f.raw) ? 'Gib an, wie viel du gegessen hast – als Anteil (z. B. ⅓), in Portionen oder in Gramm vom fertigen Essen.' : 'Ohne Kochgewicht stimmt nur der Anteil (z. B. ⅓) – Gramm vom fertigen Essen nur, wenn du den Topf gewogen hast.'}${rec ? ' <button class="btn" style="margin-top:8px;padding:6px 10px" id="editRecipe">Rezept/Kochgewicht ändern</button>' : ''}</div>` : ''}
    <div class="chips units" style="justify-content:center">${unitsFor(f).map((x) => `<button class="chip ${x.id === unit ? 'on' : ''}" data-unit="${x.id}">${x.label}</button>`).join('')}</div>
    <div class="amount-big"><input id="qty" class="num" inputmode="${unit === 'anteil' ? 'text' : 'decimal'}" value="${esc(qtyStr)}" aria-label="Menge"><span>${esc(unit === 'g' ? 'g' : UNIT_TXT[unit])}</span></div>
    ${unit === 'stk' ? `<div class="row" style="justify-content:center;margin-bottom:6px"><span class="small muted">1 Stück wiegt</span><input class="input num" id="pieceW" inputmode="decimal" style="width:80px" value="${u.g ? fmtIn(u.g) : ''}" placeholder="g"><span class="small muted">g</span></div>` : ''}
    <div class="small muted" id="gramsInfo" style="text-align:center"></div>
    <div class="chips" style="justify-content:center">${chips().map(([q, l]) => `<button class="chip" data-q="${q}">${l}</button>`).join('')}</div>
    <div class="preview" id="preview"></div>
    ${isPick ? '' : `<div class="seg" id="mealSeg">${MEALS.map((m) => `<button data-meal="${m.id}" class="${m.id === meal ? 'on' : ''}">${m.label.replace('essen', '')}</button>`).join('')}</div>`}
    <details><summary class="small muted">Nährwerte pro 100 g</summary>
      <table class="nut-table">${NUTS.map(([k, l, uu]) => `<tr><td>${l.trim()}</td><td class="num">${f.per100[k] == null ? '–' : fmt(f.per100[k], 1) + ' ' + uu}</td></tr>`).join('')}</table>
      ${f.src === 'off' || f.src === 'own' ? '<button class="btn block" style="margin-top:10px" id="fixBtn2">Werte bearbeiten</button>' : ''}
    </details>
    ${editing ? '<button class="btn danger block" style="margin-top:16px" id="delBtn">Eintrag löschen</button>' : ''}`;
  };

  let el;
  pushSheet({
    title: f.name,
    right: { label: editing ? 'Sichern' : isPick ? 'Übernehmen' : 'Eintragen', onClick: () => submit() },
    body: body(),
    mount: (sheetEl) => { el = sheetEl; bind(sheetEl); },
  });

  function perUnit() {
    if (unit === 'stk') return num($('#pieceW', el)?.value) || 0;
    return unitObj().g || 0;
  }
  function qty() { return qtyNum($('#qty', el).value) || 0; }
  function grams() { return unit === 'g' ? qty() : qty() * perUnit(); }
  function updatePreview() {
    const gr = grams();
    const n = calc(f.per100, gr);
    $('#gramsInfo', el).textContent = unit === 'g' ? '' : unit === 'stk' && !perUnit() ? 'Gewicht pro Stück eingeben (einmal wiegen, wird gemerkt)' : `= ${fmt(gr)} g`;
    $('#preview', el).innerHTML = `<div><b class="num">${fmt(n.kcal)}</b><small>kcal</small></div><div><b class="num">${fmt(n.protein, 1)}</b><small>Eiweiß</small></div><div><b class="num">${fmt(n.fat, 1)}</b><small>Fett</small></div><div><b class="num">${fmt(n.carbs, 1)}</b><small>KH</small></div>`;
  }
  function rerender() {
    $('.sheet-head h1', el).textContent = f.name;
    $('.inner', el).innerHTML = body();
    bind(el);
  }
  function bind(el) {
    const q = $('#qty', el);
    q.oninput = () => { qtyStr = q.value; updatePreview(); };
    q.onfocus = () => q.select();
    $$('[data-q]', el).forEach((b) => b.onclick = () => { q.value = qtyStr = unit === 'anteil' ? qtyLabel(qtyNum(b.dataset.q)) : b.dataset.q; updatePreview(); });
    $$('[data-unit]', el).forEach((b) => b.onclick = () => {
      const gr = grams();
      unit = b.dataset.unit;
      // Menge umrechnen, damit die Grammzahl gleich bleibt
      const pu = unit === 'g' ? 1 : unitObj().g;
      qtyStr = gr && pu ? (unit === 'anteil' ? qtyLabel(gr / pu) : fmtIn(gr / pu, unit === 'g' || unit === 'ml' ? 0 : 2)) : (unit === 'g' ? '100' : '1');
      rerender();
    });
    const pw = $('#pieceW', el);
    if (pw) pw.oninput = updatePreview;
    $$('[data-meal]', el).forEach((b) => b.onclick = () => { meal = b.dataset.meal; $$('[data-meal]', el).forEach((x) => x.classList.toggle('on', x === b)); });
    const v = $('#variant', el);
    if (v) v.onchange = () => { f = blsFood(bls.byCode.get(v.value)); if (!has(unit)) unit = 'g'; rerender(); };
    for (const id of ['#fixBtn', '#fixBtn2']) {
      const b = $(id, el);
      if (b) b.onclick = () => openProductForm(f, target, (nf) => { popSheet(); openAmount(nf, target); });
    }
    const er = $('#editRecipe', el);
    if (er) er.onclick = () => { popSheet(); openRecipe(state.recipes.find((r) => r.id === f.recipeId)); };
    const d = $('#delBtn', el);
    if (d) d.onclick = () => {
      state.days[currentDate] = (state.days[currentDate] || []).filter((x) => x.id !== target.entry.id);
      save(); closeAllSheets(); render(); toast('Gelöscht');
    };
    updatePreview();
    if (!editing) setTimeout(() => q.focus(), 50);
  }
  function submit() {
    const gr = Math.round(grams() * 10) / 10;
    if (gr <= 0) return toast(unit === 'stk' && !perUnit() ? 'Bitte das Gewicht pro Stück eingeben' : 'Bitte eine Menge eingeben');
    if (unit === 'stk') state.pieceW[f.key] = perUnit();
    const uq = { u: unit, q: unit === 'g' ? gr : qty() };
    state.lastUnit[f.key] = uq;
    if (isPick) { save(); target.onPick(f, gr, uq); return; }
    if (editing) {
      const e = target.entry;
      Object.assign(e, { grams: gr, meal, key: f.key, code: f.code, name: f.name, per100: { ...f.per100 } });
      delete e.u; delete e.q;
      if (unit !== 'g') Object.assign(e, uq);
      if (!e.est) remember(f, gr);
      save();
    } else {
      logFood(f, gr, meal, false, uq);
    }
    closeAllSheets();
    tab = 'tag';
    render();
    toast(`${fmt(calc(f.per100, gr).kcal)} kcal eingetragen`);
  }
}

/* ---------- Eigenes Produkt / Korrektur ---------- */
function openProductForm(food, target, onSaved, note = '') {
  const p = food.per100 || {};
  const v = (k) => (p[k] == null ? '' : fmtIn(p[k], 2));
  const body = `
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    <button class="btn block" id="labelPhoto" style="margin-bottom:14px">◉ Nährwerttabelle fotografieren</button>
    <label class="field"><span>Name</span><input class="input" id="pName" value="${esc(food.name || '')}"></label>
    <div class="grid2">
      <label class="field"><span>Marke</span><input class="input" id="pBrand" value="${esc(food.brand || '')}"></label>
      <label class="field"><span>Barcode</span><input class="input num" id="pEan" inputmode="numeric" value="${esc(food.ean || '')}"></label>
    </div>
    <div class="list-title">Nährwerte pro 100 g (von der Packung)</div>
    <div class="grid2">
      ${NUTS.map(([k, l, u]) => `<label class="field"><span>${l.trim()} (${u})</span><input class="input num" inputmode="decimal" data-n="${k}" value="${v(k)}"></label>`).join('')}
    </div>
    <div id="plaus"></div>
    <div class="grid2">
      <label class="field"><span>Portion (g)</span><input class="input num" id="pServing" inputmode="decimal" value="${food.serving ? fmtIn(food.serving) : ''}"></label>
      <label class="field"><span>Packung (g)</span><input class="input num" id="pPkg" inputmode="decimal" value="${food.pkg ? fmtIn(food.pkg) : ''}"></label>
    </div>`;
  pushSheet({
    title: food.name ? 'Produkt bearbeiten' : 'Eigenes Produkt',
    right: { label: 'Sichern', onClick: (el) => saveIt(el) },
    body,
    mount(el) {
      const check = () => {
        const per = readPer(el);
        const pl = plausibility(per);
        $('#plaus', el).innerHTML = per.kcal == null ? '' : `<div class="note ${pl.level}">${pl.level === 'ok' ? '✓' : '⚠︎'} ${esc(pl.text)}</div>`;
      };
      $$('[data-n]', el).forEach((i) => i.oninput = check);
      check();
      $('#labelPhoto', el).onclick = () => openPhoto('label', null, (res) => fillFromLabel(el, res, check));
    },
  });
  function readPer(el) {
    const per = {};
    $$('[data-n]', el).forEach((i) => per[i.dataset.n] = num(i.value));
    return per;
  }
  function saveIt(el) {
    const name = $('#pName', el).value.trim();
    const per = readPer(el);
    if (!name) return toast('Bitte einen Namen eingeben');
    if (per.kcal == null) return toast('Bitte mindestens die Kalorien eingeben');
    const ean = $('#pEan', el).value.trim();
    const id = ean || food.ownId || uid();
    const prod = {
      key: ean ? 'off:' + ean : 'own:' + id, ownId: id, src: 'own', ean: ean || undefined,
      name, brand: $('#pBrand', el).value.trim(), per100: per,
      serving: num($('#pServing', el).value), pkg: num($('#pPkg', el).value),
    };
    state.products[id] = prod;
    save();
    popSheet();
    toast('Produkt gespeichert');
    if (onSaved) onSaved(prod);
    else openAmount(prod, target);
  }
}
function fillFromLabel(el, r, check) {
  const set = (sel, val) => { if (val != null && val >= 0) $(sel, el).value = fmtIn(val, 2); };
  if (r.name && !$('#pName', el).value) $('#pName', el).value = r.name;
  if (r.brand && !$('#pBrand', el).value) $('#pBrand', el).value = r.brand;
  for (const [k] of NUTS) set(`[data-n="${k}"]`, r[k]);
  set('#pServing', r.serving_grams > 0 ? r.serving_grams : null);
  set('#pPkg', r.package_grams > 0 ? r.package_grams : null);
  check();
  toast('Werte übernommen – bitte kurz prüfen');
}

/* ---------- Barcode-Scanner ---------- */
let detectorPromise;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          if (supported.includes('ean_13')) return new window.BarcodeDetector({ formats: FORMATS });
        } catch {}
      }
      const m = await import(BARCODE_LIB);
      return new m.BarcodeDetector({ formats: FORMATS });
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}

function openScanner(target) {
  let stream = null;
  let stopped = false;
  const body = `
    <div class="scanner"><video id="vid" playsinline muted autoplay></video><div class="frame"></div><div class="status" id="scanStatus">Kamera wird gestartet…</div></div>
    <p class="small muted" style="text-align:center">Barcode in den Rahmen halten.</p>
    <div class="list-title">Oder Nummer eintippen</div>
    <div class="row"><input class="input grow num" id="eanIn" inputmode="numeric" placeholder="z. B. 4008400401621"><button class="btn primary" id="eanGo">Suchen</button></div>`;
  const el = pushSheet({
    title: 'Barcode scannen', left: 'Schließen', body,
    onClose: () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); },
    async mount(el) {
      $('#eanGo', el).onclick = () => { const v = $('#eanIn', el).value.trim(); if (v) handle(v); };
      const status = $('#scanStatus', el);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = $('#vid', el);
        video.srcObject = stream;
        await video.play();
        status.textContent = 'Lade Scanner…';
        const det = await getDetector();
        status.textContent = 'Suche Barcode…';
        let last = '', hits = 0;
        const loop = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const codes = await det.detect(video);
              const c = codes.map((x) => x.rawValue).find(validEAN);
              if (c) {
                hits = c === last ? hits + 1 : 1; last = c;
                if (hits >= 2) { navigator.vibrate?.(40); return handle(c); }
              }
            }
          } catch {}
          setTimeout(loop, 120);
        };
        loop();
      } catch (e) {
        status.textContent = e?.name === 'NotAllowedError' ? 'Kein Kamerazugriff – in den Safari-Einstellungen erlauben' : 'Kamera nicht verfügbar – Nummer unten eintippen';
      }
    },
  });

  async function handle(ean) {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    $('#scanStatus', el).textContent = 'Gefunden: ' + ean;
    const own = ownProductFor(ean);
    if (own) { popSheet(); return openAmount(own, target); }
    try {
      const p = await fetchOFF(ean);
      popSheet();
      if (p) openAmount(p, target);
      else openProductForm({ ean }, target, null, 'Dieses Produkt ist noch nicht in Open Food Facts. Trag die Werte von der Packung ein oder fotografiere die Nährwerttabelle – danach kennt die App es.');
    } catch {
      popSheet();
      openProductForm({ ean }, target, null, 'Keine Internetverbindung zu Open Food Facts. Du kannst die Werte von der Packung eintragen.');
    }
  }
}

/* ---------- Foto-Erkennung mit Claude ---------- */
const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          search_term: { type: 'string' },
          grams: { type: 'number' },
          confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
        },
        required: ['name', 'search_term', 'grams', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};
const LABEL_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries([
    ['name', { type: 'string' }], ['brand', { type: 'string' }],
    ...['kcal', 'protein', 'fat', 'satfat', 'carbs', 'sugar', 'fiber', 'salt', 'package_grams', 'serving_grams'].map((k) => [k, { type: 'number' }]),
  ]),
  required: ['name', 'brand', 'kcal', 'protein', 'fat', 'satfat', 'carbs', 'sugar', 'fiber', 'salt', 'package_grams', 'serving_grams'],
  additionalProperties: false,
};
const MEAL_PROMPT = `Du siehst ein Foto einer Mahlzeit. Zerlege sie in einzelne Komponenten und schätze für jede das Gewicht in Gramm so genau wie möglich. Nutze Teller, Besteck und Verpackungen als Größenmaßstab.
Regeln:
- Eine Komponente pro Zutat (z. B. Nudeln, Soße, Käse getrennt).
- Versteckte Fette wie Bratöl, Butter oder Dressing als eigene Komponente schätzen, wenn sie wahrscheinlich sind.
- search_term: kurzer deutscher Begriff im Stil des Bundeslebensmittelschlüssels, mit Zubereitungszustand, z. B. "Reis poliert, gekocht", "Hähnchenbrustfilet gebraten", "Teigwaren eifrei, gekocht", "Olivenöl".
- name: kurzer, verständlicher Name.
- grams: Gewicht im verzehrfertigen Zustand.`;
const LABEL_PROMPT = `Lies die Nährwerttabelle auf diesem Foto. Gib alle Werte pro 100 g (bzw. 100 ml) an. Falls nur Werte pro Portion lesbar sind, rechne auf 100 g um. Energie in kcal. Unlesbare oder fehlende Werte: -1. name und brand nur, wenn auf dem Foto erkennbar, sonst leerer String. package_grams: Packungsinhalt, serving_grams: Portionsgröße, jeweils -1 falls unbekannt.`;

async function askClaude(b64, mode) {
  const mod = await import(ANTHROPIC_SDK);
  const Anthropic = mod.default ?? mod.Anthropic;
  const client = new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: mode === 'meal' ? MEAL_SCHEMA : LABEL_SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: mode === 'meal' ? MEAL_PROMPT : LABEL_PROMPT },
    ] }],
  };
  let resp;
  try {
    // Server-seitiger Fallback, falls ein Sicherheitsfilter fälschlich blockt.
    resp = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e?.status === 400 && /fallback/i.test(e?.message || '')) resp = await client.messages.create(params);
    else throw e;
  }
  if (resp.stop_reason === 'refusal') throw new Error('Claude hat das Foto abgelehnt.');
  const text = resp.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Keine Antwort erhalten.');
  return JSON.parse(text);
}

function imageToJpegB64(file, maxSide = 1568) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      resolve({ b64: dataUrl.split(',')[1], dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

function openPhoto(mode, target, onLabel) {
  if (!state.settings.apiKey) {
    toast('Für Fotos zuerst unter „Mehr“ einen API-Key eintragen');
    return;
  }
  const body = `
    <p class="small muted">${mode === 'meal' ? 'Fotografiere deinen Teller von schräg oben. Claude schätzt die Komponenten und Gramm – du prüfst und korrigierst danach. Am genauesten bleibt das Wiegen.' : 'Fotografiere die Nährwerttabelle möglichst gerade und scharf.'}</p>
    <label class="btn primary block" style="margin:12px 0">◉ Foto aufnehmen oder wählen<input type="file" accept="image/*" capture="environment" id="photoIn" class="visually-hidden"></label>
    <div id="photoOut"></div>`;
  pushSheet({
    title: mode === 'meal' ? 'Mahlzeit fotografieren' : 'Nährwerttabelle lesen',
    body,
    mount(el) {
      $('#photoIn', el).onchange = async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const out = $('#photoOut', el);
        try {
          const { b64, dataUrl } = await imageToJpegB64(file);
          out.innerHTML = `<img class="photo-prev" src="${dataUrl}" alt=""><p class="muted"><span class="spinner"></span> Claude analysiert das Foto…</p>`;
          if (mode === 'meal') await loadBLS();
          const res = await askClaude(b64, mode);
          if (mode === 'label') { popSheet(); onLabel(res); return; }
          showMealResult(el, out, dataUrl, res.items || [], target);
        } catch (e) {
          const msg = e?.status === 401 ? 'API-Key ungültig.' : e?.status === 429 ? 'Zu viele Anfragen – kurz warten.' : (e?.message || 'Fehler');
          out.innerHTML = `<div class="note warn">${esc(msg)}</div>`;
        }
      };
    },
  });
}

function showMealResult(el, out, dataUrl, items, target) {
  if (!items.length) { out.innerHTML = `<img class="photo-prev" src="${dataUrl}" alt=""><div class="note warn">Keine Lebensmittel erkannt.</div>`; return; }
  const rows = items.map((it) => {
    const cands = searchBLS(it.search_term, 6);
    if (!cands.length) cands.push(...searchBLS(it.name, 6));
    return { it, cands, on: cands.length > 0 };
  });
  out.innerHTML = `<img class="photo-prev" src="${dataUrl}" alt="">
    <div class="note">Geschätzt – bitte Gramm und Zuordnung prüfen. Wenn du die Teile wiegen kannst, trag lieber die gewogenen Werte ein.</div>
    ${rows.map((r, i) => `<div class="card" style="padding:12px">
      <label class="row" style="margin-bottom:8px"><input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''}><b class="grow">${esc(r.it.name)}</b><span class="badge ${r.it.confidence === 'hoch' ? '' : 'est'}">${esc(r.it.confidence)}</span></label>
      ${r.cands.length ? `<select class="input" data-c="${i}" style="margin-bottom:8px">${r.cands.map((c, j) => `<option value="${j}">${esc(c.name)} · ${fmt(c.per100.kcal)} kcal/100 g</option>`).join('')}</select>` : '<div class="small muted" style="margin-bottom:8px">Kein passender Eintrag gefunden – bitte manuell hinzufügen.</div>'}
      <div class="row"><input class="input num" style="width:110px" inputmode="decimal" data-gr="${i}" value="${fmtIn(r.it.grams, 0)}"><span class="muted">g</span><span class="grow"></span><b class="num" data-k="${i}"></b></div>
    </div>`).join('')}
    <button class="btn primary block" id="addAll">Ausgewählte eintragen</button>`;
  const upd = (i) => {
    const r = rows[i];
    const c = r.cands[Number($(`[data-c="${i}"]`, out)?.value || 0)];
    $(`[data-k="${i}"]`, out).textContent = c ? fmt(calc(c.per100, num($(`[data-gr="${i}"]`, out).value)).kcal) + ' kcal' : '';
  };
  rows.forEach((_, i) => {
    upd(i);
    $(`[data-gr="${i}"]`, out).oninput = () => upd(i);
    const s = $(`[data-c="${i}"]`, out);
    if (s) s.onchange = () => upd(i);
  });
  $('#addAll', out).onclick = () => {
    let n = 0, kcal = 0;
    rows.forEach((r, i) => {
      if (!$(`[data-on="${i}"]`, out).checked || !r.cands.length) return;
      const c = r.cands[Number($(`[data-c="${i}"]`, out).value)];
      const g = num($(`[data-gr="${i}"]`, out).value);
      if (!g) return;
      logFood(blsFood(c), g, target?.meal || defaultMeal(), true);
      n++; kcal += calc(c.per100, g).kcal;
    });
    closeAllSheets(); tab = 'tag'; render();
    toast(`${n} Einträge · ${fmt(kcal)} kcal (geschätzt)`);
  };
}

/* ---------- Rezepte ---------- */
function openRecipe(recipe, opts = {}) {
  const r = recipe ? JSON.parse(JSON.stringify(recipe)) : { id: uid(), name: '', items: [], cooked: null };
  const isNew = !recipe || !state.recipes.some((x) => x.id === recipe.id);
  const quick = !!opts.quick;
  const body = `
    ${quick ? '<p class="small muted" style="margin:0 0 12px">Scanne oder suche jede Zutat und gib an, wie viel du reingetan hast (g, ml, Stück, EL …). Danach sagst du, wie viel du davon gegessen hast – z. B. ⅓ vom Topf oder in Gramm.</p>' : ''}
    <label class="field"><span>Name${quick ? ' (optional)' : ''}</span><input class="input" id="rName" value="${esc(r.name)}" placeholder="z. B. Spaghetti Bolognese"></label>
    ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    <div class="list-title">1 · Zutaten (roh gewogen)</div>
    <div id="rItems"></div>
    <button class="btn block" id="rAdd">+ Zutat hinzufügen</button>
    <div class="list-title">2 · Nach dem Kochen wiegen${quick ? ' (optional)' : ''}</div>
    ${quick ? '<p class="small muted" style="margin:0 0 8px">Nur nötig, wenn du deine Portion in Gramm wiegen willst. Für einen Anteil (½, ⅓ …) brauchst du es nicht.</p>' : ''}
    <div class="card" style="padding:12px">
      ${state.pots.length ? `<label class="field"><span>Topf</span><select class="input" id="rPot"><option value="">ohne Topf (direkt gewogen)</option>${state.pots.map((p) => `<option value="${p.id}">${esc(p.name)} (${fmt(p.tare)} g)</option>`).join('')}</select></label>` : '<p class="small muted" style="margin-top:0">Tipp: Unter „Mehr“ kannst du das Leergewicht deiner Töpfe speichern.</p>'}
      <label class="field"><span id="rGrossLbl">Gesamtgewicht gekocht (g)</span><input class="input num" id="rGross" inputmode="decimal" value="${r.cooked ? fmtIn(r.cooked) : ''}"></label>
      <div class="small muted" id="rCookedInfo"></div>
      <label class="field" style="margin-top:10px"><span>Portionen (optional)</span><input class="input num" id="rPortions" inputmode="numeric" value="${r.portions || ''}"></label>
    </div>
    <div class="card" id="rSum"></div>
    ${quick ? `<label class="row" style="margin:4px 0 12px"><input type="checkbox" id="rKeep" checked> <span>Für später speichern (z. B. Reste morgen)</span></label>` : ''}
    ${isNew ? '' : '<button class="btn danger block" id="rDel">Rezept löschen</button>'}`;

  const el = pushSheet({
    title: quick ? 'Selbst gekocht' : isNew ? (r.name || 'Neues Rezept') : r.name,
    right: quick ? { label: 'Weiter', onClick: () => quickNext() } : { label: 'Sichern', onClick: () => persist(true) },
    body,
    mount: () => {},
  });

  function cookedWeight() {
    const gross = num($('#rGross', el).value);
    if (!gross) return null;
    const potId = $('#rPot', el)?.value;
    const pot = state.pots.find((p) => p.id === potId);
    return pot ? gross - pot.tare : gross;
  }
  function refresh() {
    r.cooked = cookedWeight();
    r.portions = num($('#rPortions', el).value) || null;
    $('#rItems', el).innerHTML = r.items.length ? `<div class="list">${r.items.map((it, i) => `<button class="item" data-ri="${i}"><div class="grow"><div class="name">${esc(it.food.name)}</div><div class="sub num">${amountText(it)} · ${srcLabel(it.food)}</div></div><div class="num">${fmt(calc(it.food.per100, it.grams).kcal)} kcal</div></button>`).join('')}</div>` : '<p class="small muted">Noch keine Zutaten.</p>';
    $$('[data-ri]', el).forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.ri);
      const it = r.items[i];
      openAmount(it.food, { mode: 'pick', grams: it.grams, u: it.u, q: it.q, onPick: (f, g, uq) => { r.items[i] = { food: itemFood(f), grams: g, ...uq }; popSheet(); refresh(); } });
    });
    const f = recipeFood(r);
    const potId = $('#rPot', el)?.value;
    $('#rGrossLbl', el).textContent = potId ? 'Topf mit Essen (g)' : 'Gesamtgewicht gekocht (g)';
    $('#rCookedInfo', el).textContent = r.cooked && r.estCooked ? `Geschätzt aus typischen Kochverlusten (roh ${fmt(f.raw)} g). Nach dem Kochen wiegen und das echte Gewicht eintragen.` : r.cooked ? `Essen ohne Topf: ${fmt(r.cooked)} g · Roh waren es ${fmt(f.raw)} g (Faktor ${fmt(r.cooked / (f.raw || 1), 2)})` : 'Ohne Kochgewicht wird mit dem Rohgewicht gerechnet.';
    $('#rSum', el).innerHTML = `<h2>Ergebnis</h2><table class="nut-table">
      <tr><td>Gesamt</td><td class="num">${fmt(f.total.kcal)} kcal</td></tr>
      <tr><td>Pro 100 g ${r.cooked ? 'gekocht' : 'roh'}</td><td class="num"><b>${fmt(f.per100.kcal)} kcal</b></td></tr>
      <tr><td>Eiweiß / Fett / KH pro 100 g</td><td class="num">${fmt(f.per100.protein, 1)} / ${fmt(f.per100.fat, 1)} / ${fmt(f.per100.carbs, 1)} g</td></tr>
      ${f.serving ? `<tr><td>1 Portion (${fmt(f.serving)} g)</td><td class="num"><b>${fmt(calc(f.per100, f.serving).kcal)} kcal</b> · ${fmt(calc(f.per100, f.serving).protein)} g Eiweiß</td></tr>` : ''}</table>
      ${r.items.length && !quick ? '<button class="btn primary block" style="margin-top:12px" id="rLog">Portion eintragen</button>' : ''}`;
    const lg = $('#rLog', el);
    if (lg) lg.onclick = () => { if (persist(false)) openAmount(recipeFood(r), { mode: 'log', meal: defaultMeal() }); };
  }
  function persist(close) {
    r.name = $('#rName', el).value.trim();
    if (!r.name) { toast('Bitte einen Namen eingeben'); return false; }
    if (!r.items.length) { toast('Bitte mindestens eine Zutat hinzufügen'); return false; }
    r.cooked = cookedWeight();
    r.portions = num($('#rPortions', el).value) || null;
    const i = state.recipes.findIndex((x) => x.id === r.id);
    if (i >= 0) state.recipes[i] = r; else state.recipes.push(r);
    save();
    if (close) { popSheet(); render(); toast('Rezept gespeichert'); }
    return true;
  }
  function itemFood(f) { return { key: f.key, src: f.src, code: f.code, fv: f.fv, ean: f.ean, name: f.name, brand: f.brand, per100: f.per100, serving: f.serving, pkg: f.pkg }; }
  // Pick kann aus Suche (2 Ebenen) oder Scanner (3 Ebenen) kommen: bis zum Rezept-Sheet zurück
  const backToRecipe = () => popSheet(sheetStack.length - 1 - sheetStack.findIndex((x) => x.el === el));
  $('#rAdd', el).onclick = () => openAdd({ mode: 'pick', onPick: (f, g, uq) => { r.items.push({ food: itemFood(f), grams: g, ...uq }); backToRecipe(); refresh(); } });
  function quickNext() {
    if (!r.items.length) return toast('Bitte mindestens eine Zutat hinzufügen');
    if (!$('#rName', el).value.trim()) $('#rName', el).value = 'Gekocht am ' + parseKey(currentDate).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
    if ($('#rKeep', el).checked) { if (!persist(false)) return; }
    else { r.name = $('#rName', el).value.trim(); r.cooked = cookedWeight(); }
    openAmount(recipeFood(r), { mode: 'log', meal: opts.meal || defaultMeal(), unit: 'anteil', q: 1 });
  }
  $('#rGross', el).oninput = () => { r.estCooked = false; refresh(); };
  $('#rPortions', el).oninput = refresh;
  const pot = $('#rPot', el);
  if (pot) pot.onchange = refresh;
  const del = $('#rDel', el);
  if (del) del.onclick = () => {
    if (!confirm('Rezept löschen?')) return;
    state.recipes = state.recipes.filter((x) => x.id !== r.id);
    save(); popSheet(); render();
  };
  refresh();
}

/* ---------- Start ---------- */
$$('.tabbar [data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; window.scrollTo(0, 0); render(); });
$('#fab').onclick = () => openAdd({ mode: 'log', meal: defaultMeal() });
$('#prevDay').onclick = () => { currentDate = addDays(currentDate, -1); render(); };
$('#nextDay').onclick = () => { currentDate = addDays(currentDate, 1); render(); };
$('#datePicker').onchange = (e) => { if (e.target.value) { currentDate = e.target.value; render(); } };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheetStack.length) render(); });

render();
loadBLS().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
