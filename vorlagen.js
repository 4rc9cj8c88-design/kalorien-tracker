// Rezeptvorlagen. Zutaten: [BLS-Code, Gramm roh, Kochfaktor].
// Kochfaktor = Gewicht nach dem Garen / Rohgewicht. Daraus wird das Kochgewicht nur geschätzt,
// bis der Nutzer den fertigen Topf wiegt.
// Eigene Zutaten ohne BLS-Eintrag stehen in CUSTOM (Durchschnittswerte).

export const CUSTOM = {
  whey: {
    key: 'tpl:whey', src: 'own', name: 'Whey Protein (Durchschnittswerte)',
    per100: { kcal: 380, protein: 75, fat: 6, carbs: 8, fiber: 0, sugar: 6, salt: 0.5, satfat: 3.5 },
  },
};

export const VORLAGEN = [
  // ---------- Hähnchen ----------
  { id: 'haehnchen-bowl', cat: 'Hähnchen', name: 'Hähnchen-Reis-Bowl mit Gemüse', portions: 4,
    note: 'Meal-Prep: alles in einer großen Pfanne/Schüssel mischen.',
    items: [['V416100', 800, 0.75], ['C352000', 360, 2.6], ['G312100', 500, 0.9], ['G543100', 300, 0.85],
      ['G620100', 200, 0.9], ['Q120000', 30, 1], ['R143000', 40, 1]] },
  { id: 'butter-chicken', cat: 'Hähnchen', name: 'Butter Chicken (leicht) mit Reis und Spinat', portions: 4,
    items: [['V416100', 800, 0.75], ['G480100', 200, 0.8], ['G490100', 15, 1], ['R211200', 15, 1],
      ['R161200', 500, 0.85], ['G543100', 300, 0.85], ['M141300', 200, 1], ['Q611000', 20, 1], ['G211100', 200, 0.5], ['C352000', 320, 2.6]] },
  { id: 'kokos-curry', cat: 'Hähnchen', name: 'Hähnchen-Kokos-Curry mit Reis', portions: 4,
    items: [['V416100', 700, 0.75], ['H154000', 200, 1], ['G543100', 300, 0.85], ['G582100', 300, 0.85],
      ['G760200', 200, 1], ['G480100', 150, 0.8], ['Q180000', 15, 1], ['C352000', 320, 2.6]] },
  { id: 'ofen-haehnchen', cat: 'Hähnchen', name: 'Ofen-Hähnchen mit Kartoffeln und Gemüse', portions: 3,
    items: [['V416100', 600, 0.72], ['K110100', 900, 0.8], ['G582100', 300, 0.8], ['G543100', 300, 0.8],
      ['G480100', 150, 0.75], ['Q120000', 30, 1]] },
  { id: 'haehnchen-pasta', cat: 'Hähnchen', name: 'Hähnchen-Pasta mit Spinat und Tomaten', portions: 4,
    items: [['V416100', 600, 0.75], ['E401000', 400, 2.3], ['G211100', 300, 0.5], ['G561100', 300, 0.85],
      ['M710700', 150, 1], ['G490100', 10, 1], ['Q120000', 15, 1]] },
  { id: 'haehnchen-wraps', cat: 'Hähnchen', name: 'Hähnchen-Wraps mit Joghurtsoße (4 Wraps)', portions: 2,
    items: [['V416100', 400, 0.75], ['B783012', 250, 1], ['G543100', 150, 0.85], ['G103100', 100, 1],
      ['G561100', 150, 1], ['M141300', 150, 1], ['M402500', 60, 1], ['Q180000', 10, 1]] },

  // ---------- Hackfleisch ----------
  { id: 'bolognese', cat: 'Hackfleisch', name: 'Spaghetti Bolognese', portions: 4,
    note: 'Nudeln und Soße zusammen in den Topf, dann wiegen. Willst du sie getrennt lassen, mach zwei Rezepte.',
    items: [['U010100', 600, 0.75], ['G480100', 150, 0.8], ['G620100', 200, 0.85], ['G490100', 10, 1],
      ['R161200', 700, 0.8], ['Q120000', 15, 1], ['E401000', 400, 2.3]] },
  { id: 'chili', cat: 'Hackfleisch', name: 'Chili con Carne mit Reis', portions: 5,
    items: [['U010100', 600, 0.75], ['H742902', 500, 1], ['G570902', 280, 1], ['G568900', 800, 0.8],
      ['G543100', 300, 0.85], ['G480100', 150, 0.8], ['Q180000', 15, 1], ['C352000', 400, 2.6]] },
  { id: 'burrito-bowl', cat: 'Hackfleisch', name: 'Hack-Burrito-Bowl', portions: 4,
    items: [['U010100', 500, 0.75], ['C352000', 300, 2.6], ['G543100', 300, 0.85], ['G570902', 140, 1],
      ['H742902', 250, 1], ['G561100', 200, 1], ['M402500', 80, 1], ['Q180000', 10, 1]] },
  { id: 'frikadellen', cat: 'Hackfleisch', name: 'Frikadellen / Burger-Patties (8 Stück)', portions: 4,
    note: 'Mit Haferflocken statt Paniermehl. Dazu passt Salat oder Ofengemüse.',
    items: [['U010100', 800, 0.78], ['E111100', 60, 1], ['C133000', 50, 1], ['G480100', 100, 0.8], ['Q180000', 15, 1]] },
  { id: 'hack-gemuese-pfanne', cat: 'Hackfleisch', name: 'Hack-Gemüse-Pfanne mit Kartoffeln', portions: 3,
    items: [['U010100', 500, 0.75], ['K110100', 800, 0.85], ['G582100', 300, 0.8], ['G543100', 250, 0.8],
      ['G480100', 150, 0.8], ['R161200', 200, 0.8], ['Q180000', 15, 1]] },

  // ---------- Shakes & Frühstück ----------
  { id: 'shake-banane', cat: 'Shakes & Frühstück', name: 'Protein-Shake Banane-Hafer', portions: 1,
    note: 'Bulk-Shake mit rund 600 kcal. Tausch das Whey gegen deine eigene Dose (Barcode scannen).',
    items: [['whey', 30, 1], ['M111200', 400, 1], ['F503100', 120, 1], ['C133000', 40, 1], ['H880200', 15, 1]] },
  { id: 'shake-beeren', cat: 'Shakes & Frühstück', name: 'Protein-Shake Beeren-Quark', portions: 1,
    items: [['whey', 30, 1], ['M111200', 300, 1], ['F304100', 150, 1], ['M713100', 100, 1], ['C133000', 30, 1]] },
  { id: 'quark-bowl', cat: 'Shakes & Frühstück', name: 'Quark-Bowl mit Obst und Hafer', portions: 1,
    items: [['M713100', 250, 1], ['C133000', 60, 1], ['F503100', 100, 1], ['F302100', 100, 1], ['S120000', 15, 1], ['H880200', 15, 1]] },
];
