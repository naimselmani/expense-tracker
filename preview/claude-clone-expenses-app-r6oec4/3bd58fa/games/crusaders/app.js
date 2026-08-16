(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Stronghold Crusaders — prototype.
  // A SEEDED, ENDLESS isometric world. Terrain and props are pure functions of
  // (seed, tileC, tileR), so the map isn't stored anywhere — we just compute &
  // draw whatever tiles the camera currently covers. Pan in any direction and
  // new land appears forever (bounded only by float precision — "almost"
  // infinite). Self-contained: no shared imports, ships its own palette.
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const tip = document.getElementById('tip');
  const overlay = document.getElementById('overlay');
  const blurb = document.getElementById('overlay-blurb');
  const seedVal = document.getElementById('seed-val');

  const TILE_W = 64, TILE_H = 32;   // base iso footprint (unzoomed)
  const ELEV = 22;                  // px a 1-unit-tall block rises

  // ---- Seed ------------------------------------------------------------------
  function loadSeed() {
    try {
      const s = localStorage.getItem('crusaders-seed');
      if (s != null && s !== '') return (parseInt(s, 10) >>> 0);
    } catch (_) {}
    return (Math.random() * 4294967296) >>> 0;
  }
  let seed = loadSeed();
  function setSeed(s) {
    seed = s >>> 0;
    try { localStorage.setItem('crusaders-seed', String(seed)); } catch (_) {}
    if (seedVal) seedVal.textContent = seed;
    clearWorldCache();   // terrain depends on the seed
  }

  // ---- Seeded value noise ----------------------------------------------------
  // 32-bit integer hash (Math.imul keeps it deterministic for huge coords).
  function hash2(s, x, y) {
    let h = s | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  function valueNoise(s, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const top = lerp(hash2(s, xi, yi), hash2(s, xi + 1, yi), u);
    const bot = lerp(hash2(s, xi, yi + 1), hash2(s, xi + 1, yi + 1), u);
    return lerp(top, bot, v);
  }
  function fbm(s, x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += amp * valueNoise(s + o * 1013, x * freq, y * freq);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  // ---- Biomes ----------------------------------------------------------------
  const COLORS = {
    dw: { top: '#2d6586', l: '#244f68', r: '#1d4254' },  // deep water
    w:  { top: '#3f86a8', l: '#336e8b', r: '#2a5c75' },  // shallow water
    sa: { top: '#d9b56a', l: '#bf9a50', r: '#a8843f' },  // sand
    g:  { top: '#7d9b46', l: '#5f7836', r: '#4f6429' },  // grassland
    fo: { top: '#5f7e34', l: '#496127', r: '#3c5020' },  // woodland floor
    ro: { top: '#8d8475', l: '#6f675b', r: '#585146' },  // rocky highland
    sn: { top: '#e8eaf0', l: '#c2c8d6', r: '#a9b0c2' },  // snowfield
  };
  const BIOME_NAME = {
    dw: 'Deep water', w: 'Shallow water', sa: 'Desert sand', g: 'Grassland',
    fo: 'Woodland', ro: 'Rocky highland', sn: 'Snowfield',
  };

  // Home clearing: force grass within this radius of spawn so the keep always
  // sits on solid, buildable ground regardless of seed.
  const HOME_R = 9;
  function isHome(c, r) { return (c * c + r * r) < HOME_R * HOME_R; }

  // Terrain & props are static for a given seed, so memoize them — otherwise
  // the multi-octave noise would re-run for every visible tile every frame,
  // which is the main source of lag. Caches are cleared when the seed changes.
  const biomeCache = new Map();
  const propCache = new Map();
  function clearWorldCache() { biomeCache.clear(); propCache.clear(); }

  function computeBiome(c, r) {
    if (isHome(c, r)) return 'g';
    const e = fbm(seed, c * 0.06, r * 0.06);            // elevation
    const m = fbm(seed + 777, c * 0.05 + 100, r * 0.05 + 100); // moisture
    if (e < 0.34) return 'dw';
    if (e < 0.40) return 'w';
    if (e < 0.45) return 'sa';
    if (e < 0.72) { if (m < 0.42) return 'sa'; if (m > 0.62) return 'fo'; return 'g'; }
    if (e < 0.84) return 'ro';
    return 'sn';
  }
  function biomeAt(c, r) {
    const key = c + ',' + r;
    let v = biomeCache.get(key);
    if (v === undefined) {
      if (biomeCache.size > 60000) biomeCache.clear();   // bound memory as you roam
      v = computeBiome(c, r);
      biomeCache.set(key, v);
    }
    return v;
  }

  // Deterministic prop per tile (trees, rocks, ruins...). Pure function of seed.
  const PROP_NAME = {
    tree: 'Tree', palm: 'Date palm', cactus: 'Cactus', rock: 'Boulder', ruin: 'Ancient ruin',
  };
  function computeProp(c, r) {
    if (isHome(c, r)) return null;
    const b = biomeAt(c, r);
    const h = hash2(seed ^ 0x9e37, c, r);
    const j = hash2(seed ^ 0x51ed, c, r);
    if (b === 'fo') { if (h < 0.55) return { type: 'tree', h: 1.3 + j * 0.9 }; }
    else if (b === 'g') { if (h < 0.12) return { type: 'tree', h: 1.1 + j * 0.5 }; if (h > 0.985) return { type: 'ruin', h: 1.0 }; }
    else if (b === 'sa') { if (h < 0.045) return { type: 'palm', h: 1.5 }; if (h > 0.98) return { type: 'cactus', h: 1.0 }; }
    else if (b === 'ro') { if (h < 0.20) return { type: 'rock', h: 0.7 + j * 0.8 }; }
    else if (b === 'sn') { if (h < 0.10) return { type: 'rock', h: 0.8 }; }
    return null;
  }
  function propAt(c, r) {
    const key = c + ',' + r;
    let v = propCache.get(key);
    if (v === undefined) {
      if (propCache.size > 60000) propCache.clear();
      v = computeProp(c, r);
      propCache.set(key, v === null ? false : v);   // distinguish "computed: nothing" from "uncomputed"
      return v;
    }
    return v === false ? null : v;
  }

  // ---- The home holding ------------------------------------------------------
  // Two start modes: a fully-built "demo" holding, or "scratch" (just the keep).
  // Populated in place by buildWorld() so reset/restore keeps array references.
  let mode = 'demo';
  const buildings = [];
  const walls = [];
  const units = [];

  function buildWorld(m) {
    buildings.length = 0; walls.length = 0; units.length = 0;
    // The keep anchors both modes (permanent, drives the safety-net trickle).
    buildings.push({ c: 0, r: 0, type: 'keep', h: 3.0, label: 'The Keep' });

    if (m === 'scratch') {
      // Bare beginning: just the keep and a lone guard to build out from.
      units.push({ color: '#d64545', flag: '#f2d35a', path: [[-1, -2], [1, -2], [1, 2], [-1, 2]], i: 0, t: 0, spd: 0.4, label: 'Spearman' });
      return;
    }

    // Demo: a fully functional holding.
    buildings.push(
      { c: -2, r: -1, type: 'tower',  h: 2.4, label: 'Square Tower' },
      { c: 2,  r: -1, type: 'tower',  h: 2.4, label: 'Square Tower' },
      { c: -2, r: 2,  type: 'tower',  h: 2.4, label: 'Square Tower' },
      { c: 2,  r: 2,  type: 'tower',  h: 2.4, label: 'Square Tower' },
      { c: 0,  r: -3, type: 'gate',   h: 1.8, label: 'Gatehouse' },
      { c: -4, r: 4,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
      { c: -5, r: 5,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
      { c: -3, r: 6,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
      { c: 5,  r: 2,  type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
      { c: 6,  r: 3,  type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
      { c: 3,  r: 6,  type: 'farm',   h: 0.35, label: 'Wheat Farm' },
      { c: 5,  r: 7,  type: 'farm',   h: 0.35, label: 'Apple Orchard' },
      { c: 6,  r: 1,  type: 'market', h: 1.3, label: 'Market' },
    );
    const ring = [[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],
                  [-2,0],[-2,1],[-2,2],
                  [2,0],[2,1],[2,2],
                  [-1,2],[0,2],[1,2]];
    for (const [c, r] of ring) walls.push({ c, r, h: 1.4 });
    units.push(
      { color: '#d64545', flag: '#f2d35a', path: [[-1,-2],[1,-2],[1,3],[-1,3]], i: 0, t: 0, spd: 0.45, label: 'Spearman patrol' },
      { color: '#3f5fb0', flag: '#e8e8e8', path: [[-4,4],[3,6],[5,3],[0,0]], i: 0, t: 0.3, spd: 0.30, label: 'Trader' },
      { color: '#caa23a', flag: '#2b1d12', path: [[5,2],[7,4],[6,6],[4,4]], i: 0, t: 0.6, spd: 0.36, label: 'Mercenary' },
    );
  }

  const START_RES = {
    demo:    { gold: 200, food: 85, water: 30, wood: 40, stone: 0, iron: 0, ale: 0, weapons: 0, army: 0, popularity: 50, pop: 24 },
    scratch: { gold: 60,  food: 40, water: 20, wood: 30, stone: 0, iron: 0, ale: 0, weapons: 0, army: 0, popularity: 50, pop: 6 },
  };

  // ---- Economy ---------------------------------------------------------------
  // The holding is alive: producers pay out on a fixed cycle, the population
  // eats, and peasants arrive while there's a food surplus. Each payout floats
  // a "+N" above the building that earned it.
  const hudEl = {
    gold:  document.getElementById('r-gold'),
    food:  document.getElementById('r-food'),
    water: document.getElementById('r-water'),
    wood:  document.getElementById('r-wood'),
    stone: document.getElementById('r-stone'),
    iron:  document.getElementById('r-iron'),
    ale:   document.getElementById('r-ale'),
    weapons: document.getElementById('r-weapons'),
    army:  document.getElementById('r-army'),
    popularity: document.getElementById('r-popularity'),
    pop:   document.getElementById('r-pop'),
  };
  const res = { gold: 200, food: 85, water: 30, wood: 40, stone: 0, iron: 0, ale: 0, weapons: 0, army: 0, popularity: 50, pop: 24 };

  // Capacity: each storable resource is capped. The keep grants a base cap;
  // storage buildings raise it. Production clamps at the cap, so storage is
  // what lets you stockpile more.
  const BASE_CAP = { gold: 300, food: 200, water: 100, wood: 150, stone: 120, iron: 100, ale: 60, weapons: 80, popularity: 100 };
  const STORE_CAP = {
    granary:   { food: 200 },
    larder:    { food: 100 },
    barn:      { food: 150 },
    stockpile: { wood: 150, stone: 150, iron: 120 },
    cistern:   { water: 200 },
  };
  let caps = Object.assign({}, BASE_CAP);

  function setRes(k, v) {
    v = Math.max(0, Math.round(v));
    if (caps[k] != null) v = Math.min(v, caps[k]);
    res[k] = v;
    const el = hudEl[k];
    if (el) {
      el.textContent = res[k];
      if (el.parentElement && caps[k] != null) el.parentElement.classList.toggle('full', res[k] >= caps[k]);
    }
  }
  function recomputeCaps() {
    caps = Object.assign({}, BASE_CAP);
    for (const b of buildings) {
      const sc = STORE_CAP[b.type];
      if (!sc) continue;
      for (const k in sc) caps[k] = (caps[k] || 0) + sc[k];
    }
    for (const k in caps) setRes(k, res[k]);   // re-clamp + refresh HUD
  }

  // ---- Save / restore (localStorage, so a refresh resumes the game) ----------
  const SAVE_KEY = 'crusaders-save';
  function saveState() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, mode: mode, seed: seed, res: res, buildings: buildings, walls: walls }));
    } catch (_) {}
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      return (s && s.v === 1 && Array.isArray(s.buildings)) ? s : null;
    } catch (_) { return null; }
  }
  // Start a fresh game in the given mode (new layout + starting resources).
  function resetWorld(m) {
    mode = (m === 'scratch') ? 'scratch' : 'demo';
    buildWorld(mode);
    rebuildOccupied();
    recomputeCaps();
    const s = START_RES[mode] || START_RES.demo;
    for (const k in s) setRes(k, s[k]);
    if (typeof floats !== 'undefined') floats.length = 0;
    prodAcc = 0;
    saveState();
  }
  // Restore a previously saved game verbatim.
  function applyState(s) {
    mode = (s.mode === 'scratch') ? 'scratch' : 'demo';
    setSeed((s.seed >>> 0) || seed);
    buildWorld(mode);                              // gives us units for the mode
    buildings.length = 0; for (const b of s.buildings) buildings.push(b);
    walls.length = 0; for (const w of (s.walls || [])) walls.push(w);
    rebuildOccupied();
    recomputeCaps();
    for (const k in res) if (s.res && s.res[k] != null) setRes(k, s.res[k]);
  }

  // Gatherers: each adds `amt` of one resource per cycle. Some get a bonus for
  // bordering the right terrain (woodcutter→woodland, quarry/mine→rock).
  const PRODUCERS = {
    farm:       { res: 'food',  amt: 3, color: '#e9d27a' },
    market:     { res: 'gold',  amt: 6, color: '#f2d35a' },
    woodcutter: { res: 'wood',  amt: 4, color: '#caa46a', bonus: 'fo' },
    quarry:     { res: 'stone', amt: 3, color: '#cfc6b6', bonus: 'ro' },
    ironmine:   { res: 'iron',  amt: 2, color: '#9fb0c2', bonus: 'ro' },
    orchard:    { res: 'food',  amt: 3, color: '#e9d27a', bonus: 'g' },
    dairy:      { res: 'food',  amt: 4, color: '#e9d27a', bonus: 'g' },
    hunter:     { res: 'food',  amt: 3, color: '#e9d27a', bonus: 'fo' },
    mill:       { res: 'food',  amt: 5, color: '#e9d27a', bonus: 'g' },
    well:       { res: 'water', amt: 4, color: '#7fc7e8', bonus: 'w' },
    pitchrig:   { res: 'gold',  amt: 4, color: '#f2d35a', bonus: 'dw' },
  };
  // Workshops: consume inputs to make outputs (only when the inputs are on
  // hand), forming a simple production chain on top of the raw gatherers.
  // (An empty `in` always runs — e.g. the chapel just radiates popularity.)
  const CONVERTERS = {
    blacksmith: { in: { iron: 2 },             out: { gold: 12 },     color: '#f2d35a' },
    bakery:     { in: { wood: 1 },             out: { food: 8 },      color: '#e9d27a' },
    brewery:    { in: { water: 2 },            out: { ale: 3 },       color: '#d8a24a' },
    inn:        { in: { ale: 2 },              out: { popularity: 2 }, color: '#9fe07a' },
    chapel:     { in: {},                      out: { popularity: 2 }, color: '#9fe07a' },
    fletcher:   { in: { wood: 2 },             out: { weapons: 1 },   color: '#d0c0a0' },
    poleturner: { in: { wood: 2 },             out: { weapons: 1 },   color: '#d0c0a0' },
    armourer:   { in: { iron: 2 },             out: { weapons: 2 },   color: '#cdd6e2' },
    barracks:   { in: { weapons: 2, gold: 5 }, out: { army: 1 },      color: '#e2c46a' },
    stables:    { in: { gold: 15 },            out: { army: 1 },      color: '#e2c46a' },
    mercpost:   { in: { gold: 12 },            out: { army: 1 },      color: '#e2c46a' },
  };
  // +1 per neighbouring tile of the producer's bonus biome (up to +4).
  function terrainBonus(biome, c, r) {
    if (!biome) return 0;
    let n = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (biomeAt(c + dc, r + dr) === biome) n++;
    return n;
  }
  const floats = [];   // { c, r, text, color, t }
  function spawnFloat(c, r, text, color) { floats.push({ c, r, text, color, t: 0 }); }

  // ---- Building / placement --------------------------------------------------
  const RES_ICON = { wood: '🪵', gold: '🪙', food: '🍞', water: '💧', stone: '🪨', iron: '⚙️', ale: '🍺', weapons: '⚔️', army: '🛡️', popularity: '😊' };
  // Categories mirror Stronghold's build tabs.
  const CATEGORIES = [
    { id: 'castle',    name: 'Castle',    icon: '🏰' },
    { id: 'industry',  name: 'Industry',  icon: '⛏️' },
    { id: 'farm',      name: 'Farm',      icon: '🌾' },
    { id: 'housing',   name: 'Housing',   icon: '🏠' },
    { id: 'community', name: 'Community', icon: '🏛️' },
    { id: 'storage',   name: 'Storage',   icon: '📦' },
    { id: 'weapons',   name: 'Weapons',   icon: '⚔️' },
  ];
  let activeCat = 'castle';

  const BUILDABLE = [
    { type: 'tower',  cat: 'castle',   icon: '🗼', name: 'Tower',  cost: { stone: 15, wood: 5 },   h: 2.4,  label: 'Square Tower' },
    { type: 'wall',      cat: 'castle', icon: '🧱', name: 'Wall',      cost: { stone: 5 },            h: 1.3, label: 'Castle Wall' },
    { type: 'gatehouse', cat: 'castle', icon: '🚪', name: 'Gatehouse', cost: { stone: 20, wood: 10 }, h: 2.0, label: 'Gatehouse' },
    { type: 'moat',      cat: 'castle', icon: '🌊', name: 'Moat',      cost: { wood: 5 },             h: 0.2, label: 'Moat' },

    { type: 'woodcutter', cat: 'industry', icon: '🪓', name: 'Woodcutter', cost: { gold: 20 },           h: 1.2,  label: "Woodcutter's Hut" },
    { type: 'quarry',     cat: 'industry', icon: '⛏️', name: 'Quarry',     cost: { gold: 25 },           h: 0.8,  label: 'Stone Quarry' },
    { type: 'ironmine',   cat: 'industry', icon: '⚒️', name: 'Iron Mine',  cost: { gold: 30, wood: 10 }, h: 1.1,  label: 'Iron Mine' },
    { type: 'pitchrig',   cat: 'industry', icon: '🛢️', name: 'Pitch Rig',  cost: { gold: 25, wood: 10 }, h: 1.2,  label: 'Pitch Rig' },

    { type: 'farm',   cat: 'farm', icon: '🌾', name: 'Farm',   cost: { wood: 8 },             h: 0.35, label: 'Wheat Farm' },
    { type: 'orchard', cat: 'farm', icon: '🍎', name: 'Apple Orchard', cost: { wood: 10 },           h: 0.4,  label: 'Apple Orchard' },
    { type: 'dairy',   cat: 'farm', icon: '🐄', name: 'Dairy Farm',    cost: { wood: 12, gold: 10 }, h: 1.0,  label: 'Dairy Farm' },
    { type: 'hunter',  cat: 'farm', icon: '🦌', name: "Hunter's Hut",  cost: { wood: 8 },            h: 1.0,  label: "Hunter's Hut" },

    { type: 'house',  cat: 'housing', icon: '🏠', name: 'Hovel',  cost: { wood: 10, gold: 5 }, h: 1.0, label: "Peasant's Hovel" },
    { type: 'well',    cat: 'housing', icon: '💧', name: 'Well',    cost: { wood: 10 },          h: 1.0, label: 'Well' },

    { type: 'market', cat: 'community', icon: '🪙', name: 'Market', cost: { wood: 15, gold: 25 }, h: 1.3, label: 'Market' },
    { type: 'chapel',  cat: 'community', icon: '⛪', name: 'Chapel',  cost: { wood: 20, stone: 15 }, h: 2.2, label: 'Chapel' },
    { type: 'inn',     cat: 'community', icon: '🍻', name: 'Inn',     cost: { wood: 15, gold: 10 },  h: 1.2, label: 'Inn' },
    { type: 'mill',    cat: 'community', icon: '🌀', name: 'Mill',    cost: { wood: 15 },            h: 1.6, label: 'Mill' },
    { type: 'bakery',  cat: 'community', icon: '🥖', name: 'Bakery',  cost: { wood: 12, stone: 5 },  h: 1.2, label: 'Bakery' },
    { type: 'brewery', cat: 'community', icon: '🍺', name: 'Brewery', cost: { wood: 15 },            h: 1.3, label: 'Brewery' },

    { type: 'granary',   cat: 'storage', icon: '🏬', name: 'Granary',   cost: { wood: 12 },           h: 1.2, label: 'Granary (+food storage)' },
    { type: 'stockpile', cat: 'storage', icon: '📦', name: 'Stockpile', cost: { wood: 15 },           h: 0.5, label: 'Stockpile (+materials storage)' },
    { type: 'larder',    cat: 'storage', icon: '🧺', name: 'Larder',    cost: { wood: 8 },            h: 0.9, label: 'Larder (+food storage)' },
    { type: 'barn',      cat: 'storage', icon: '🛖', name: 'Barn',      cost: { wood: 12, stone: 5 }, h: 1.3, label: 'Barn (+food storage)' },
    { type: 'cistern',   cat: 'storage', icon: '🚰', name: 'Cistern',   cost: { wood: 12 },           h: 0.6, label: 'Cistern (+water storage)' },

    { type: 'blacksmith', cat: 'weapons', icon: '🛠️', name: 'Blacksmith', cost: { wood: 15, stone: 10 }, h: 1.3, label: 'Blacksmith' },
    { type: 'tent',   cat: 'weapons', icon: '⛺', name: 'Tent',   cost: { gold: 15 },           h: 1.1, label: 'Mercenary Tent' },
    { type: 'fletcher',   cat: 'weapons', icon: '🏹', name: 'Fletcher',   cost: { wood: 15 },            h: 1.2, label: 'Fletcher' },
    { type: 'poleturner', cat: 'weapons', icon: '🔱', name: 'Poleturner', cost: { wood: 15 },            h: 1.2, label: 'Poleturner' },
    { type: 'armourer',   cat: 'weapons', icon: '🛡️', name: 'Armourer',   cost: { wood: 15, stone: 10 }, h: 1.3, label: 'Armourer' },
    { type: 'barracks',   cat: 'weapons', icon: '⚔️', name: 'Barracks',   cost: { wood: 20, stone: 15 }, h: 1.6, label: 'Barracks' },
    { type: 'stables',    cat: 'weapons', icon: '🐎', name: 'Stables',    cost: { wood: 20, gold: 15 },  h: 1.2, label: 'Stables' },
    { type: 'mercpost',   cat: 'weapons', icon: '🗡️', name: 'Mercenary Post', cost: { gold: 20 },        h: 1.1, label: 'Mercenary Post' },
  ];
  let placing = null;   // the BUILDABLE entry currently being placed, or null

  function screenToTile(px, py) {
    const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
    return {
      c: Math.round((wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2),
      r: Math.round((wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2),
    };
  }
  // Occupancy as a Set for O(1) lookups — the render loop tests every visible
  // tile each frame, so a linear scan over buildings was costly.
  const occupiedSet = new Set();
  function rebuildOccupied() {
    occupiedSet.clear();
    for (const b of buildings) occupiedSet.add(b.c + ',' + b.r);
    for (const w of walls) occupiedSet.add(w.c + ',' + w.r);
  }
  function occupied(c, r) { return occupiedSet.has(c + ',' + r); }
  function canAfford(cost) { for (const k in cost) if (res[k] < cost[k]) return false; return true; }
  function payFor(cost) { for (const k in cost) setRes(k, res[k] - cost[k]); }
  function costText(cost) { return Object.keys(cost).map((k) => RES_ICON[k] + cost[k]).join(' '); }

  function tryPlace(px, py) {
    if (!placing) return;
    const { c, r } = screenToTile(px, py);
    const t = biomeAt(c, r);
    if (t === 'w' || t === 'dw') { showTip("Can't build on water"); return; }
    if (occupied(c, r)) { showTip('Tile occupied'); return; }
    if (!canAfford(placing.cost)) { showTip('Not enough ' + Object.keys(placing.cost).map((k) => RES_ICON[k]).join('')); return; }
    payFor(placing.cost);
    buildings.push({ c, r, type: placing.type, h: placing.h, label: placing.label });
    rebuildOccupied();
    const sc = STORE_CAP[placing.type];
    if (sc) {
      recomputeCaps();
      spawnFloat(c, r, Object.keys(sc).map((k) => '+' + sc[k] + RES_ICON[k]).join(' '), '#cfe6a0');
    } else {
      spawnFloat(c, r, 'built', '#cfe6a0');
    }
    refreshBuildList();   // some options may now be unaffordable
    saveState();
  }

  const PROD_EVERY = 3;   // seconds per production cycle
  let prodAcc = 0;
  function tickEconomy(dt) {
    prodAcc += dt;
    if (prodAcc < PROD_EVERY) return;
    prodAcc -= PROD_EVERY;
    for (const b of buildings) {
      const p = PRODUCERS[b.type];
      if (!p) continue;
      const amt = p.amt + terrainBonus(p.bonus, b.c, b.r);
      setRes(p.res, res[p.res] + amt);
      spawnFloat(b.c, b.r, '+' + amt, p.color);
    }
    // Workshops convert raw resources into finished goods when stocked.
    for (const b of buildings) {
      const cv = CONVERTERS[b.type];
      if (!cv || !canAfford(cv.in)) continue;
      payFor(cv.in);
      let out = '';
      for (const k in cv.out) { setRes(k, res[k] + cv.out[k]); out += '+' + cv.out[k]; }
      spawnFloat(b.c, b.r, out, cv.color);
    }
    // Safety net: the keep is permanent, so its gatherers always bring in a
    // small trickle of every resource. This makes a true dead-end impossible —
    // even from zero you can wait and rebuild (e.g. afford a woodcutter again).
    const keep = buildings.find((b) => b.type === 'keep');
    if (keep) {
      setRes('wood', res.wood + 1);
      setRes('gold', res.gold + 1);
      setRes('food', res.food + 1);
      spawnFloat(keep.c, keep.r, '🪵+1', '#caa46a');
    }
    // Population eats; spare food draws new peasants to the hovels.
    setRes('food', res.food - Math.ceil(res.pop * 0.1));
    const hovels = buildings.filter((b) => b.type === 'house').length;
    if (res.food > 30 && res.popularity >= 45 && res.pop < 60) {
      setRes('pop', res.pop + Math.max(1, Math.floor(hovels / 2)));
      spawnFloat(0, 0, '+peasant', '#cfe6a0');
    }
    saveState();   // persist resources each cycle so a refresh resumes
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    for (const f of floats) {
      const { sx, sy } = screenOf(f.c, f.r);
      const y = sy - 26 * cam.zoom - f.t * 30;
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.fillStyle = f.color;
      ctx.font = 'bold ' + Math.max(11, 13 * cam.zoom).toFixed(0) + 'px "Trebuchet MS", sans-serif';
      ctx.fillText(f.text, sx, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // ---- Camera ---------------------------------------------------------------
  const cam = { x: 0, y: 0, zoom: 1 };
  const ZOOM_MIN = 0.08, ZOOM_MAX = 2.2;

  // Level of detail: when tiles get tiny, render them as larger merged blocks
  // so the on-screen tile count stays bounded no matter how far we zoom out.
  // (A step x step square of grid tiles maps to one larger iso diamond because
  // the projection is affine.)
  function lodStep() {
    let step = 1;
    while (TILE_W * cam.zoom * step < 14) step *= 2;
    return step;
  }

  function tileTopScreen(c, r) {
    return { x: (c - r) * (TILE_W / 2), y: (c + r) * (TILE_H / 2) };
  }
  function screenOf(c, r) {
    const p = tileTopScreen(c, r);
    return { sx: cam.x + p.x * cam.zoom, sy: cam.y + p.y * cam.zoom };
  }
  function centerOn(c, r) {
    const p = tileTopScreen(c, r);
    cam.x = canvas.clientWidth / 2 - p.x * cam.zoom;
    cam.y = canvas.clientHeight / 2 - p.y * cam.zoom;
  }

  // Which tiles does the viewport currently cover? Invert the iso transform on
  // the (padded) screen corners and take the axis-aligned tile bounding box.
  function visibleBounds() {
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 80;
    const corners = [[-pad, -pad], [W + pad, -pad], [-pad, H + pad], [W + pad, H + pad]];
    let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const [px, py] of corners) {
      const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
      const c = (wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2;
      const r = (wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2;
      cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    return {
      cMin: Math.floor(cMin) - 2, cMax: Math.ceil(cMax) + 2,
      rMin: Math.floor(rMin) - 2, rMax: Math.ceil(rMax) + 3,
    };
  }

  // ---- Hi-DPI sizing ---------------------------------------------------------
  let DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * DPR);
    canvas.height = Math.round(canvas.clientHeight * DPR);
  }

  // ---- Drawing primitives ----------------------------------------------------
  function diamond(sx, sy, w, h) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - h / 2);
    ctx.lineTo(sx + w / 2, sy);
    ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx - w / 2, sy);
    ctx.closePath();
  }

  function drawTile(c, r, step) {
    step = step || 1;
    const cx = c + (step - 1) / 2, cy = r + (step - 1) / 2;  // block centroid
    const t = biomeAt(Math.round(cx), Math.round(cy));
    const p = screenOf(cx, cy);
    const sx = p.sx; let sy = p.sy;
    const w = TILE_W * cam.zoom * step, h = TILE_H * cam.zoom * step;
    if (sx < -w || sx > canvas.clientWidth + w || sy < -h || sy > canvas.clientHeight + h) return;
    if ((t === 'w' || t === 'dw') && step === 1) sy += Math.sin(now / 600 + (c + r)) * 1.2;
    diamond(sx, sy, w, h);
    ctx.fillStyle = COLORS[t].top; ctx.fill();
    // The hairline grid reads as noise once tiles get tiny — only stroke at
    // full detail and a reasonable zoom (also saves a stroke per tile).
    if (cam.zoom > 0.45 && step === 1) { ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Lighten (amt>0) or darken (amt<0) a #rrggbb color toward white/black.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const cl = (x) => Math.max(0, Math.min(255, Math.round(x + 255 * amt)));
    return 'rgb(' + cl((n >> 16) & 255) + ',' + cl((n >> 8) & 255) + ',' + cl(n & 255) + ')';
  }

  // A vertically-shaded iso box anchored at screen point (sx,sy = base centre).
  function isoBox(sx, sy, w, h, rise, faces) {
    let grad = ctx.createLinearGradient(0, sy - rise, 0, sy + h / 2);
    grad.addColorStop(0, shade(faces.l, 0.05)); grad.addColorStop(1, shade(faces.l, -0.07));
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, sy); ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise); ctx.lineTo(sx - w / 2, sy - rise);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    grad = ctx.createLinearGradient(0, sy - rise, 0, sy + h / 2);
    grad.addColorStop(0, shade(faces.r, 0.02)); grad.addColorStop(1, shade(faces.r, -0.11));
    ctx.beginPath();
    ctx.moveTo(sx + w / 2, sy); ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise); ctx.lineTo(sx + w / 2, sy - rise);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    diamond(sx, sy - rise, w, h);
    ctx.fillStyle = faces.top; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawBox(c, r, hUnits, faces, footScale) {
    const { sx, sy } = screenOf(c, r);
    const w = TILE_W * cam.zoom * (footScale || 1);
    const h = TILE_H * cam.zoom * (footScale || 1);
    const rise = ELEV * hUnits * cam.zoom;
    isoBox(sx, sy, w, h, rise, faces);
    return { sx, sy, rise, w, h };
  }

  const STONE = { top: '#cdbfa3', l: '#9c8e72', r: '#84765c' };
  const KEEP  = { top: '#ded2b6', l: '#a99c7e', r: '#8d8064' };
  const ROCK  = { top: '#9a9183', l: '#7a7264', r: '#615a4e' };
  const HOUSE_ROOF = '#a14a2c', TOWER_ROOF = '#525c70';

  // Soft contact shadow on the ground beneath a standing object.
  function groundShadow(c, r, scale) {
    const { sx, sy } = screenOf(c, r);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    diamond(sx + 3 * cam.zoom, sy + 2 * cam.zoom, TILE_W * cam.zoom * scale, TILE_H * cam.zoom * scale);
    ctx.fill();
  }

  // Battlement ring: small merlon cubes spaced around the top diamond rim.
  function crenellate(sx, topY, w, h, faces) {
    const mw = w * 0.2, mh = h * 0.2, mr = 5 * cam.zoom;
    const pts = [
      [sx, topY - h / 2], [sx + w / 2, topY], [sx, topY + h / 2], [sx - w / 2, topY],
      [sx + w / 4, topY - h / 4], [sx + w / 4, topY + h / 4],
      [sx - w / 4, topY + h / 4], [sx - w / 4, topY - h / 4],
    ];
    for (const [mx, my] of pts) isoBox(mx, my, mw, mh, mr, faces);
  }

  // Hip/pyramid roof rising `rh` above the top diamond at (sx, topY).
  function pyramidRoof(sx, topY, w, h, rh, color) {
    const apex = [sx, topY - rh];
    const N = [sx, topY - h / 2], E = [sx + w / 2, topY], S = [sx, topY + h / 2], W = [sx - w / 2, topY];
    const tri = (a, b, c2, col) => {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]);
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    tri(apex, N, W, shade(color, 0.05));   // back-left
    tri(apex, N, E, shade(color, 0.11));   // back-right, catches light
    tri(apex, W, S, shade(color, -0.05));  // front-left
    tri(apex, E, S, shade(color, -0.13));  // front-right, in shade
  }

  // A small arched door on the front-right face.
  function doorOn(sx, sy, w, h, rise) {
    const dw = w * 0.15, dh = rise * 0.5;
    const dx = sx + w * 0.2, dy = sy + h * 0.12;
    ctx.fillStyle = 'rgba(38,22,10,0.85)';
    ctx.beginPath();
    ctx.moveTo(dx - dw / 2, dy);
    ctx.lineTo(dx - dw / 2, dy - dh + dw / 2);
    ctx.quadraticCurveTo(dx, dy - dh, dx + dw / 2, dy - dh + dw / 2);
    ctx.lineTo(dx + dw / 2, dy);
    ctx.closePath(); ctx.fill();
  }

  function flagpole(sx, topY, pole) {
    const hgt = 16 * cam.zoom;
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 2 * cam.zoom;
    ctx.beginPath(); ctx.moveTo(sx, topY); ctx.lineTo(sx, topY - hgt); ctx.stroke();
    const wave = Math.sin(now / 240) * 2 * cam.zoom;
    ctx.fillStyle = pole;
    ctx.beginPath();
    ctx.moveTo(sx, topY - hgt);
    ctx.lineTo(sx + 12 * cam.zoom + wave, topY - hgt + 3 * cam.zoom);
    ctx.lineTo(sx, topY - hgt + 7 * cam.zoom);
    ctx.closePath(); ctx.fill();
  }

  // Generic hut styling for the simpler production buildings: body colour +
  // roof colour + footprint. A roof of null means flat (no pyramid roof).
  const STYLE = {
    dairy:      { body: { top: '#e6e0d4', l: '#c5beb0', r: '#a7a094' }, roof: '#8c3f2a', foot: 0.82 },
    hunter:     { body: { top: '#9a7a4e', l: '#7c6240', r: '#634e32' }, roof: '#4a3722', foot: 0.74 },
    inn:        { body: { top: '#c2935a', l: '#a3793f', r: '#876230' }, roof: '#6e4a2b', foot: 0.82 },
    bakery:     { body: { top: '#caa06a', l: '#a87f4c', r: '#8c673a' }, roof: '#7a4a2a', foot: 0.8 },
    fletcher:   { body: { top: '#b98a5a', l: '#996f44', r: '#7e5a36' }, roof: '#5f4326', foot: 0.78 },
    poleturner: { body: { top: '#b98a5a', l: '#996f44', r: '#7e5a36' }, roof: '#5f4326', foot: 0.78 },
    armourer:   { body: { top: '#9aa0a8', l: '#787e86', r: '#5f646b' }, roof: '#41464d', foot: 0.82 },
    barracks:   { body: { top: '#c1b496', l: '#9f9376', r: '#83785e' }, roof: '#5a4a30', foot: 0.95 },
    stables:    { body: { top: '#a87f4c', l: '#8a6638', r: '#6f5230' }, roof: '#5f4326', foot: 0.92 },
    mercpost:   { body: { top: '#cdbfa3', l: '#9c8e72', r: '#84765c' }, roof: '#7a352a', foot: 0.78 },
    gatehouse:  { body: STONE, roof: null, foot: 1.0 },
  };

  function drawBuilding(b) {
    // Skip fine ornament (roofs, battlements, doors, stripes) when zoomed far
    // out — it's invisible at that scale and keeps the far view cheap.
    const detail = cam.zoom > 0.3;
    switch (b.type) {
      case 'keep': {
        groundShadow(b.c, b.r, 1.05);
        const o = drawBox(b.c, b.r, b.h, KEEP, 1.05);
        const topY = o.sy - o.rise;
        if (detail) { doorOn(o.sx, o.sy, o.w, o.h, o.rise); crenellate(o.sx, topY, o.w, o.h, KEEP); }
        flagpole(o.sx, topY - (detail ? 5 * cam.zoom : 0), '#d64545');
        break;
      }
      case 'tower': {
        groundShadow(b.c, b.r, 0.8);
        const o = drawBox(b.c, b.r, b.h, STONE, 0.8);
        const topY = o.sy - o.rise;
        if (detail) {
          crenellate(o.sx, topY, o.w, o.h, STONE);
          pyramidRoof(o.sx, topY - 5 * cam.zoom, o.w * 0.6, o.h * 0.6, 16 * cam.zoom, TOWER_ROOF);
        }
        break;
      }
      case 'gate': {
        groundShadow(b.c, b.r, 1.0);
        const o = drawBox(b.c, b.r, b.h, STONE, 1.0);
        if (detail) { doorOn(o.sx, o.sy, o.w, o.h, o.rise); crenellate(o.sx, o.sy - o.rise, o.w, o.h, STONE); }
        break;
      }
      case 'market': {
        groundShadow(b.c, b.r, 0.95);
        const o = drawBox(b.c, b.r, b.h, { top: '#b9823f', l: '#9a6a31', r: '#7e5527' }, 0.9);
        const topY = o.sy - o.rise;
        // striped awning, concentric diamonds
        diamond(o.sx, topY, o.w, o.h); ctx.fillStyle = '#e7dcc0'; ctx.fill();
        diamond(o.sx, topY, o.w * 0.66, o.h * 0.66); ctx.fillStyle = '#c0492f'; ctx.fill();
        diamond(o.sx, topY, o.w * 0.33, o.h * 0.33); ctx.fillStyle = '#e7dcc0'; ctx.fill();
        break;
      }
      case 'house': {
        groundShadow(b.c, b.r, 0.72);
        const o = drawBox(b.c, b.r, b.h, { top: '#caa06a', l: '#a87f4c', r: '#8c673a' }, 0.72);
        if (detail) pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.78, o.h * 0.78, 13 * cam.zoom, HOUSE_ROOF);
        break;
      }
      case 'woodcutter': {
        groundShadow(b.c, b.r, 0.78);
        const o = drawBox(b.c, b.r, b.h, { top: '#b98a5a', l: '#996f44', r: '#7e5a36' }, 0.78);
        if (detail) {
          pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.82, o.h * 0.82, 12 * cam.zoom, '#6e4a2b');
          const s = cam.zoom;   // stacked log pile to the side
          ctx.fillStyle = '#8a5a32'; ctx.fillRect(o.sx - o.w * 0.55, o.sy + 1 * s, 7 * s, 3.5 * s);
          ctx.fillStyle = '#a87248'; ctx.fillRect(o.sx - o.w * 0.55, o.sy - 2.5 * s, 7 * s, 3.5 * s);
        }
        break;
      }
      case 'quarry': {
        groundShadow(b.c, b.r, 0.8);
        const o = drawBox(b.c, b.r, b.h, STONE, 0.78);
        if (detail) {
          // pile of cut stone blocks on top
          isoBox(o.sx - o.w * 0.12, o.sy - o.rise + o.h * 0.1, o.w * 0.3, o.h * 0.3, 6 * cam.zoom, ROCK);
          isoBox(o.sx + o.w * 0.16, o.sy - o.rise, o.w * 0.26, o.h * 0.26, 9 * cam.zoom, ROCK);
        }
        break;
      }
      case 'ironmine': {
        groundShadow(b.c, b.r, 0.8);
        const o = drawBox(b.c, b.r, b.h, { top: '#7d7a72', l: '#5f5c55', r: '#4b4843' }, 0.8);
        if (detail) {
          pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.84, o.h * 0.84, 11 * cam.zoom, '#3c3a36');
          doorOn(o.sx, o.sy, o.w, o.h, o.rise);   // dark mine adit
        }
        break;
      }
      case 'blacksmith': {
        groundShadow(b.c, b.r, 0.85);
        const o = drawBox(b.c, b.r, b.h, { top: '#9a9088', l: '#787068', r: '#5f584f' }, 0.82);
        const topY = o.sy - o.rise;
        if (detail) {
          pyramidRoof(o.sx, topY, o.w * 0.84, o.h * 0.84, 12 * cam.zoom, '#41423f');
          const s = cam.zoom;
          // chimney + forge glow
          isoBox(o.sx + o.w * 0.18, topY - o.h * 0.18, o.w * 0.18, o.h * 0.18, 14 * s, { top: '#5f584f', l: '#4b463f', r: '#3a352f' });
          const glow = 0.6 + 0.4 * Math.abs(Math.sin(now / 300));
          ctx.fillStyle = 'rgba(255,140,40,' + glow.toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(o.sx - o.w * 0.12, o.sy + o.h * 0.05, 3 * s, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'granary': {
        groundShadow(b.c, b.r, 0.82);
        const o = drawBox(b.c, b.r, b.h, { top: '#d8c79a', l: '#b8a474', r: '#9c8a5e' }, 0.82);
        if (detail) {
          pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.86, o.h * 0.86, 12 * cam.zoom, '#c8a85a');
          const s = cam.zoom;   // grain sacks at the base
          ctx.fillStyle = '#cdb079';
          ctx.beginPath(); ctx.arc(o.sx - o.w * 0.3, o.sy + 2 * s, 3.2 * s, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(o.sx - o.w * 0.18, o.sy + 3 * s, 2.8 * s, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'larder': {
        groundShadow(b.c, b.r, 0.7);
        const o = drawBox(b.c, b.r, b.h, { top: '#c2a878', l: '#a48a5c', r: '#897248' }, 0.7);
        if (detail) pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.8, o.h * 0.8, 10 * cam.zoom, '#7a5a36');
        break;
      }
      case 'barn': {
        groundShadow(b.c, b.r, 0.92);
        const o = drawBox(b.c, b.r, b.h, { top: '#b98a5a', l: '#9a6f44', r: '#7e5a36' }, 0.92);
        if (detail) {
          pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.9, o.h * 0.9, 14 * cam.zoom, '#8c3f2a');
          const s = cam.zoom;   // hay bale beside the barn
          ctx.fillStyle = '#d6c069';
          ctx.fillRect(o.sx - o.w * 0.55, o.sy - 1 * s, 7 * s, 5 * s);
        }
        break;
      }
      case 'stockpile': {
        groundShadow(b.c, b.r, 1.0);
        const o = drawBox(b.c, b.r, b.h, { top: '#a89a7e', l: '#897c62', r: '#6e6450' }, 1.0);
        if (detail) {
          const topY = o.sy - o.rise;   // stacked materials on an open yard
          isoBox(o.sx - o.w * 0.2, topY + o.h * 0.12, o.w * 0.3, o.h * 0.3, 7 * cam.zoom, { top: '#a8814c', l: '#8a6638', r: '#6f5230' });
          isoBox(o.sx + o.w * 0.18, topY + o.h * 0.05, o.w * 0.3, o.h * 0.3, 9 * cam.zoom, ROCK);
        }
        break;
      }
      case 'farm': {
        groundShadow(b.c, b.r, 1.0);
        const o = drawBox(b.c, b.r, b.h, { top: '#b9a23f', l: '#8f7d30', r: '#766727' }, 1.0);
        if (detail) {
          const topY = o.sy - o.rise;
          ctx.strokeStyle = 'rgba(86,70,22,0.55)'; ctx.lineWidth = 1.1 * cam.zoom;
          for (const k of [-1, 0, 1]) {
            const ox = k * o.w * 0.16, oy = -k * o.h * 0.16;
            ctx.beginPath();
            ctx.moveTo(o.sx + ox - o.w * 0.26, topY + oy - o.h * 0.26);
            ctx.lineTo(o.sx + ox + o.w * 0.26, topY + oy + o.h * 0.26);
            ctx.stroke();
          }
        }
        break;
      }
      case 'tent': {
        groundShadow(b.c, b.r, 0.6);
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, rise = ELEV * b.h * s, w = TILE_W * 0.58 * s, base = sy + 4 * s;
        ctx.beginPath();
        ctx.moveTo(sx, sy - rise); ctx.lineTo(sx - w / 2, base); ctx.lineTo(sx + w / 2, base);
        ctx.closePath(); ctx.fillStyle = '#e8e0cb'; ctx.fill();
        // shaded right half
        ctx.beginPath();
        ctx.moveTo(sx, sy - rise); ctx.lineTo(sx + w / 2, base); ctx.lineTo(sx, base);
        ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill();
        if (detail) {
          ctx.strokeStyle = '#b6402f'; ctx.lineWidth = 1.5 * s; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(sx, sy - rise); ctx.lineTo(sx - w / 2, base);
          ctx.moveTo(sx, sy - rise); ctx.lineTo(sx + w / 2, base);
          ctx.moveTo(sx - w / 2, base); ctx.lineTo(sx + w / 2, base);
          ctx.stroke();
          // pennant
          ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 1.4 * s;
          ctx.beginPath(); ctx.moveTo(sx, sy - rise); ctx.lineTo(sx, sy - rise - 8 * s); ctx.stroke();
          ctx.fillStyle = '#caa23a';
          ctx.beginPath();
          ctx.moveTo(sx, sy - rise - 8 * s); ctx.lineTo(sx + 7 * s, sy - rise - 6 * s);
          ctx.lineTo(sx, sy - rise - 4.5 * s); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'ruin': {
        groundShadow(b.c, b.r, 0.7);
        const o = drawBox(b.c, b.r, b.h, STONE, 0.7);
        const topY = o.sy - o.rise;
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; diamond(o.sx, topY, o.w * 0.5, o.h * 0.5); ctx.fill();
        if (detail) {
          isoBox(o.sx - o.w / 4, topY + o.h / 4, o.w * 0.2, o.h * 0.2, 6 * cam.zoom, STONE);
          isoBox(o.sx + o.w / 2, topY, o.w * 0.2, o.h * 0.2, 3 * cam.zoom, STONE);
        }
        break;
      }
      case 'rock': { groundShadow(b.c, b.r, 0.6); drawBox(b.c, b.r, b.h, ROCK, 0.6); break; }
      case 'cactus': {
        groundShadow(b.c, b.r, 0.45);
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, th = ELEV * b.h * s;
        ctx.strokeStyle = '#3f7a34'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - th); ctx.stroke();
        ctx.lineWidth = 3 * s;
        ctx.beginPath(); ctx.moveTo(sx, sy - th * 0.55); ctx.lineTo(sx - 6 * s, sy - th * 0.55);
        ctx.lineTo(sx - 6 * s, sy - th * 0.8); ctx.stroke();
        break;
      }
      case 'palm': {
        groundShadow(b.c, b.r, 0.5);
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, trunk = ELEV * b.h * s;
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 2 * s, sy - trunk); ctx.stroke();
        const tx = sx + 2 * s, ty = sy - trunk, fr = 13 * s;
        ctx.fillStyle = '#7a5230';   // coconut cluster
        ctx.beginPath(); ctx.arc(tx, ty, 2.4 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = 2.4 * s;
        for (const a of [-2.5, -1.7, -0.9, -0.2, 0.6]) {
          ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.lineTo(tx + Math.cos(a) * fr, ty - Math.sin(a) * fr * 0.7); ctx.stroke();
        }
        break;
      }
      case 'tree': {
        groundShadow(b.c, b.r, 0.5);
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, th = ELEV * b.h * s, cy = sy - th - 3 * s;
        ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3.2 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - th); ctx.stroke();
        ctx.fillStyle = '#2f6a2c';
        ctx.beginPath(); ctx.arc(sx, cy + 3 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f7a34';
        ctx.beginPath(); ctx.arc(sx - 5 * s, cy, 7.5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + 5 * s, cy + s, 7 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4f9040';
        ctx.beginPath(); ctx.arc(sx - 2 * s, cy - 4 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'wall': {
        groundShadow(b.c, b.r, 0.92);
        const o = drawBox(b.c, b.r, b.h, STONE, 0.92);
        if (detail) crenellate(o.sx, o.sy - o.rise, o.w, o.h, STONE);
        break;
      }
      case 'gatehouse': {
        groundShadow(b.c, b.r, 1.0);
        const o = drawBox(b.c, b.r, b.h, STONE, 1.0);
        if (detail) { doorOn(o.sx, o.sy, o.w, o.h, o.rise); crenellate(o.sx, o.sy - o.rise, o.w, o.h, STONE); }
        break;
      }
      case 'moat': {
        // A shallow water trench: a slightly sunken animated water diamond.
        const { sx } = screenOf(b.c, b.r);
        let { sy } = screenOf(b.c, b.r);
        sy += Math.sin(now / 600 + (b.c + b.r)) * 1.2;
        const w = TILE_W * cam.zoom * 0.96, h = TILE_H * cam.zoom * 0.96;
        diamond(sx, sy, w, h); ctx.fillStyle = '#356f8f'; ctx.fill();
        diamond(sx, sy, w * 0.7, h * 0.7); ctx.fillStyle = '#3f86a8'; ctx.fill();
        break;
      }
      case 'well': {
        groundShadow(b.c, b.r, 0.5);
        const o = drawBox(b.c, b.r, 0.5, STONE, 0.4);   // low stone ring
        if (detail) {
          const s = cam.zoom, topY = o.sy - o.rise;
          diamond(o.sx, topY, o.w * 0.5, o.h * 0.5); ctx.fillStyle = '#2d6586'; ctx.fill();
          // two posts + a little roof over the shaft
          ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.moveTo(o.sx - 6 * s, topY); ctx.lineTo(o.sx - 6 * s, topY - 14 * s);
          ctx.moveTo(o.sx + 6 * s, topY); ctx.lineTo(o.sx + 6 * s, topY - 14 * s);
          ctx.stroke();
          ctx.fillStyle = '#8c3f2a';
          ctx.beginPath();
          ctx.moveTo(o.sx, topY - 20 * s); ctx.lineTo(o.sx - 9 * s, topY - 13 * s);
          ctx.lineTo(o.sx + 9 * s, topY - 13 * s); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'cistern': {
        groundShadow(b.c, b.r, 0.85);
        const o = drawBox(b.c, b.r, b.h, { top: '#356f8f', l: '#5f6b6f', r: '#4b5559' }, 0.82);
        // shimmering water surface on top
        const topY = o.sy - o.rise + Math.sin(now / 600 + b.c) * 1;
        diamond(o.sx, topY, o.w * 0.8, o.h * 0.8); ctx.fillStyle = '#3f86a8'; ctx.fill();
        break;
      }
      case 'mill': {
        groundShadow(b.c, b.r, 0.8);
        const o = drawBox(b.c, b.r, b.h, { top: '#cdbfa3', l: '#a99c7e', r: '#8d8064' }, 0.78);
        const topY = o.sy - o.rise;
        if (detail) {
          const s = cam.zoom, a = now / 700;   // slowly turning sails
          ctx.strokeStyle = '#5a4326'; ctx.lineWidth = 2.4 * s;
          for (let k = 0; k < 4; k++) {
            const ang = a + k * Math.PI / 2;
            ctx.beginPath(); ctx.moveTo(o.sx, topY - 4 * s);
            ctx.lineTo(o.sx + Math.cos(ang) * 14 * s, topY - 4 * s + Math.sin(ang) * 14 * s);
            ctx.stroke();
          }
          ctx.fillStyle = '#3a2817';
          ctx.beginPath(); ctx.arc(o.sx, topY - 4 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'chapel': {
        groundShadow(b.c, b.r, 0.85);
        const o = drawBox(b.c, b.r, b.h, KEEP, 0.78);
        const topY = o.sy - o.rise;
        if (detail) {
          pyramidRoof(o.sx, topY, o.w * 0.82, o.h * 0.82, 18 * cam.zoom, '#7d6a8a');
          const s = cam.zoom;   // a cross on the apex
          ctx.strokeStyle = '#e7d8a8'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
          const ay = topY - 18 * cam.zoom;
          ctx.beginPath();
          ctx.moveTo(o.sx, ay - 9 * s); ctx.lineTo(o.sx, ay - 1 * s);
          ctx.moveTo(o.sx - 3 * s, ay - 6 * s); ctx.lineTo(o.sx + 3 * s, ay - 6 * s);
          ctx.stroke();
        }
        break;
      }
      case 'brewery': {
        groundShadow(b.c, b.r, 0.82);
        const o = drawBox(b.c, b.r, b.h, STYLE.inn.body, 0.82);
        if (detail) {
          pyramidRoof(o.sx, o.sy - o.rise, o.w * 0.84, o.h * 0.84, 12 * cam.zoom, '#6e4a2b');
          const s = cam.zoom;   // ale barrel
          ctx.fillStyle = '#8a5a32'; ctx.fillRect(o.sx - o.w * 0.55, o.sy - 3 * s, 7 * s, 7 * s);
          ctx.strokeStyle = '#4a3722'; ctx.lineWidth = 1 * s;
          ctx.strokeRect(o.sx - o.w * 0.55, o.sy - 3 * s, 7 * s, 7 * s);
        }
        break;
      }
      case 'pitchrig': {
        groundShadow(b.c, b.r, 0.8);
        const o = drawBox(b.c, b.r, 0.6, { top: '#3c3a36', l: '#2e2c29', r: '#222120' }, 0.8);
        if (detail) {
          const s = cam.zoom, topY = o.sy - o.rise;
          // black pitch pool + a derrick
          diamond(o.sx, topY, o.w * 0.6, o.h * 0.6); ctx.fillStyle = '#16140f'; ctx.fill();
          ctx.strokeStyle = '#5a4326'; ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.moveTo(o.sx - 7 * s, topY + 2 * s); ctx.lineTo(o.sx, topY - 18 * s);
          ctx.lineTo(o.sx + 7 * s, topY + 2 * s); ctx.stroke();
        }
        break;
      }
      case 'orchard': {
        groundShadow(b.c, b.r, 1.0);
        drawBox(b.c, b.r, 0.18, { top: '#8a9b46', l: '#6f7d36', r: '#5c6829' }, 1.0);
        if (detail) {
          // a little grove of apple trees on the plot
          const s = cam.zoom;
          for (const [dx, dy] of [[-0.25, -0.12], [0.22, -0.05], [0, 0.18]]) {
            const px = screenOf(b.c, b.r).sx + dx * TILE_W * cam.zoom;
            const py = screenOf(b.c, b.r).sy + dy * TILE_H * cam.zoom;
            ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 9 * s); ctx.stroke();
            ctx.fillStyle = '#3f7a34';
            ctx.beginPath(); ctx.arc(px, py - 12 * s, 5.5 * s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#d6402f';
            ctx.beginPath(); ctx.arc(px + 2 * s, py - 11 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
          }
        }
        break;
      }
      default: {
        // Generic styled hut for the remaining production buildings.
        const st = STYLE[b.type] || { body: { top: '#b0a487', l: '#8f846a', r: '#746b54' }, roof: '#5a4a30', foot: 0.8 };
        groundShadow(b.c, b.r, st.foot);
        const o = drawBox(b.c, b.r, b.h, st.body, st.foot);
        if (detail && st.roof) pyramidRoof(o.sx, o.sy - o.rise, o.w * (st.foot + 0.04), o.h * (st.foot + 0.04), 12 * cam.zoom, st.roof);
        break;
      }
    }
  }

  function unitWorldPos(u) {
    const a = u.path[u.i], b = u.path[(u.i + 1) % u.path.length];
    return tileTopScreen(a[0] + (b[0] - a[0]) * u.t, a[1] + (b[1] - a[1]) * u.t);
  }
  function drawUnit(u) {
    const p = unitWorldPos(u);
    const sx = cam.x + p.x * cam.zoom, sy = cam.y + p.y * cam.zoom, s = cam.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 7 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = u.color; ctx.fillRect(sx - 3 * s, sy - 13 * s, 6 * s, 11 * s);
    ctx.fillStyle = '#e9c9a0';
    ctx.beginPath(); ctx.arc(sx, sy - 15 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 1.4 * s;
    ctx.beginPath(); ctx.moveTo(sx + 4 * s, sy - 2 * s); ctx.lineTo(sx + 4 * s, sy - 18 * s); ctx.stroke();
    ctx.fillStyle = u.flag;
    ctx.beginPath();
    ctx.moveTo(sx + 4 * s, sy - 18 * s); ctx.lineTo(sx + 11 * s, sy - 16 * s);
    ctx.lineTo(sx + 4 * s, sy - 14 * s); ctx.closePath(); ctx.fill();
  }

  // ---- Render ----------------------------------------------------------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    g.addColorStop(0, '#c98f4e'); g.addColorStop(0.5, '#a86f3a'); g.addColorStop(1, '#7a4f2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const b = visibleBounds();
    const inView = (c, r) => c >= b.cMin && c <= b.cMax && r >= b.rMin && r <= b.rMax;
    const step = lodStep();

    // 1) ground. Flat diamonds don't overlap, so order doesn't matter; iterate
    //    in LOD-sized blocks aligned to `step`.
    const c0 = Math.floor(b.cMin / step) * step, r0 = Math.floor(b.rMin / step) * step;
    for (let c = c0; c <= b.cMax; c += step)
      for (let r = r0; r <= b.rMax; r += step)
        drawTile(c, r, step);

    // 2) everything that stands up, depth-sorted
    const objs = [];
    for (const w of walls) if (inView(w.c, w.r)) objs.push({ d: w.c + w.r, kind: 'wall', ref: w });
    for (const bd of buildings) if (inView(bd.c, bd.r)) objs.push({ d: bd.c + bd.r, kind: 'bld', ref: bd });
    // Procedural props are sub-pixel specks when zoomed far out — only place
    // them at full detail.
    if (step === 1) {
      for (let c = b.cMin; c <= b.cMax; c++) {
        for (let r = b.rMin; r <= b.rMax; r++) {
          if (occupied(c, r)) continue;   // a placed building clears the prop
          const p = propAt(c, r);
          if (p) objs.push({ d: c + r + 0.02, kind: 'bld', ref: { c, r, type: p.type, h: p.h } });
        }
      }
    }
    for (const u of units) {
      const a = u.path[u.i], n = u.path[(u.i + 1) % u.path.length];
      const d = (a[0] + (n[0] - a[0]) * u.t) + (a[1] + (n[1] - a[1]) * u.t);
      objs.push({ d: d + 0.01, kind: 'unit', ref: u });
    }
    objs.sort((p, q) => p.d - q.d);
    for (const o of objs) {
      if (o.kind === 'wall') drawBox(o.ref.c, o.ref.r, o.ref.h, STONE, 0.92);
      else if (o.kind === 'bld') drawBuilding(o.ref);
      else drawUnit(o.ref);
    }

    drawFloats();
  }

  // ---- Picking ---------------------------------------------------------------
  function pickAt(px, py) {
    const ordered = buildings.slice().sort((a, b) => (b.c + b.r) - (a.c + a.r));
    for (const b of ordered) {
      const { sx } = screenOf(b.c, b.r);
      const sy = screenOf(b.c, b.r).sy - ELEV * b.h * cam.zoom;
      const w = TILE_W * cam.zoom, h = TILE_H * cam.zoom;
      if (Math.abs(px - sx) / (w / 2) + Math.abs(py - sy) / (h / 2) <= 1.1) return b.label;
    }
    const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
    const c = Math.round((wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2);
    const r = Math.round((wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2);
    const p = propAt(c, r);
    if (p) return PROP_NAME[p.type];
    return BIOME_NAME[biomeAt(c, r)];
  }

  let tipTimer = 0;
  function showTip(text) {
    if (!text) return;
    tip.textContent = text; tip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('show'), 1800);
  }

  // ---- Gestures: pan (1 finger) / pinch-zoom (2 fingers) ---------------------
  const pointers = new Map();
  let panLast = null, pinch = null, downAt = null, moved = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function clientToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = clientToCanvas(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) { panLast = p; downAt = p; moved = 0; }
    else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: cam.zoom,
      };
      panLast = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = clientToCanvas(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      zoomAround(cx, cy, clamp(pinch.zoom * (dist / pinch.dist), ZOOM_MIN, ZOOM_MAX));
      return;
    }
    if (panLast) {
      const dx = p.x - panLast.x, dy = p.y - panLast.y;
      cam.x += dx; cam.y += dy; moved += Math.abs(dx) + Math.abs(dy);
      panLast = p;
    }
  });
  function endPointer(e) {
    const wasTap = pointers.size === 1 && moved < 8 && downAt;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) panLast = [...pointers.values()][0];
    else if (pointers.size === 0) {
      if (wasTap) {
        if (placing) tryPlace(downAt.x, downAt.y);
        else showTip(pickAt(downAt.x, downAt.y));
      }
      panLast = null; downAt = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function zoomAround(cx, cy, target) {
    const wx = (cx - cam.x) / cam.zoom, wy = (cy - cam.y) / cam.zoom;
    cam.zoom = target;
    cam.x = cx - wx * cam.zoom; cam.y = cy - wy * cam.zoom;
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = clientToCanvas(e);
    zoomAround(p.x, p.y, clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), ZOOM_MIN, ZOOM_MAX));
  }, { passive: false });

  // ---- Buttons ---------------------------------------------------------------
  function zoomStep(f) {
    zoomAround(canvas.clientWidth / 2, canvas.clientHeight / 2, clamp(cam.zoom * f, ZOOM_MIN, ZOOM_MAX));
  }
  document.getElementById('zin-btn').addEventListener('click', () => zoomStep(1.2));
  document.getElementById('zout-btn').addEventListener('click', () => zoomStep(1 / 1.2));
  document.getElementById('center-btn').addEventListener('click', () => centerOn(0, 0));
  document.getElementById('menu-btn').addEventListener('click', openMenu);

  const modeSelect = document.getElementById('mode-select');

  function openMenu() {
    if (seedVal) seedVal.textContent = seed;
    if (modeSelect) modeSelect.value = mode;
    overlay.dataset.state = 'title';
  }
  function closeMenu() { overlay.dataset.state = 'hidden'; }
  document.getElementById('play-btn').addEventListener('click', closeMenu);
  document.getElementById('how-btn').addEventListener('click', () => {
    blurb.textContent = 'Drag with one finger to roam the endless map. Pinch (or − / +) to zoom. Tap any building, prop or tile to inspect it. 🏰 recenters on your keep. Pick a Start mode and hit “New world” for a fresh game — your progress is saved, so a refresh resumes where you left off.';
  });
  // Start dropdown: changing it begins a fresh game in that mode.
  modeSelect.addEventListener('change', () => {
    setSeed((Math.random() * 4294967296) >>> 0);
    resetWorld(modeSelect.value);
    centerOn(0, 0);
  });
  document.getElementById('reroll-btn').addEventListener('click', () => {
    setSeed((Math.random() * 4294967296) >>> 0);
    resetWorld(mode);   // fresh layout + resources for the current mode
    centerOn(0, 0);
  });

  document.getElementById('quit-btn').addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else { location.href = '../../'; }
  });

  // ---- Build menu ------------------------------------------------------------
  const buildSheet = document.getElementById('build-sheet');
  const buildList = document.getElementById('build-list');
  const buildTabs = document.getElementById('build-tabs');
  const placeBanner = document.getElementById('place-banner');
  const placeText = document.getElementById('place-text');

  function renderTabs() {
    buildTabs.textContent = '';
    for (const c of CATEGORIES) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'build-tab' + (c.id === activeCat ? ' active' : '');
      const ic = document.createElement('span'); ic.className = 'bt-icon'; ic.textContent = c.icon;
      const nm = document.createElement('span'); nm.textContent = c.name;
      t.append(ic, nm);
      t.addEventListener('click', () => { activeCat = c.id; renderTabs(); refreshBuildList(); });
      buildTabs.appendChild(t);
    }
  }

  function refreshBuildList() {
    buildList.textContent = '';
    for (const b of BUILDABLE) {
      if (b.cat !== activeCat) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'build-opt';
      const ic = document.createElement('span'); ic.className = 'bo-icon'; ic.textContent = b.icon;
      const nm = document.createElement('span'); nm.className = 'bo-name'; nm.textContent = b.name;
      const co = document.createElement('span'); co.className = 'bo-cost';
      el.append(ic, nm, co);
      if (b.comingSoon) {
        el.classList.add('soon');
        co.textContent = 'Coming soon';
        const ov = document.createElement('span'); ov.className = 'bo-soon'; ov.textContent = '🔒';
        el.append(ov);
        el.addEventListener('click', () => showTip(b.name + ' — coming soon'));
      } else {
        co.textContent = costText(b.cost);
        el.disabled = !canAfford(b.cost);
        el.addEventListener('click', () => startPlacing(b));
      }
      buildList.appendChild(el);
    }
  }
  function openBuild() { renderTabs(); refreshBuildList(); buildSheet.dataset.open = 'true'; }
  function closeBuild() { buildSheet.dataset.open = 'false'; }
  function startPlacing(b) {
    placing = b;
    closeBuild();
    placeText.textContent = 'Tap a tile to build ' + b.name + ' · ' + costText(b.cost);
    placeBanner.classList.add('show');
  }
  function stopPlacing() { placing = null; placeBanner.classList.remove('show'); }

  document.getElementById('build-btn').addEventListener('click', () => {
    if (placing) { stopPlacing(); return; }
    if (buildSheet.dataset.open === 'true') closeBuild();
    else openBuild();
  });
  document.getElementById('build-close').addEventListener('click', closeBuild);
  document.getElementById('place-cancel').addEventListener('click', stopPlacing);

  // ---- On-screen joystick ----------------------------------------------------
  const joyEl = document.getElementById('joystick');
  const joyKnob = document.getElementById('joystick-knob');
  const joyToggle = document.getElementById('joy-toggle');
  const JOY_RADIUS = 44, PAN_SPEED = 540;   // knob travel (px) / pan rate (px/s)
  const joyVec = { x: 0, y: 0 };            // normalised deflection, -1..1
  let joyId = null;

  function joyMove(e) {
    const rect = joyEl.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const mag = Math.hypot(dx, dy) || 1;
    const reach = Math.min(mag, JOY_RADIUS), nx = dx / mag, ny = dy / mag;
    joyKnob.style.transform = 'translate(' + (nx * reach) + 'px,' + (ny * reach) + 'px)';
    joyVec.x = nx * (reach / JOY_RADIUS);
    joyVec.y = ny * (reach / JOY_RADIUS);
  }
  function joyReset() { joyVec.x = 0; joyVec.y = 0; joyKnob.style.transform = 'translate(0,0)'; }
  joyEl.addEventListener('pointerdown', (e) => {
    joyEl.setPointerCapture(e.pointerId); joyId = e.pointerId; joyMove(e); e.preventDefault();
  });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  function joyEnd(e) { if (e.pointerId === joyId) { joyId = null; joyReset(); } }
  joyEl.addEventListener('pointerup', joyEnd);
  joyEl.addEventListener('pointercancel', joyEnd);

  function setJoystick(on) {
    joyEl.classList.toggle('on', on);
    if (!on) joyReset();
    try { localStorage.setItem('crusaders-joystick', on ? '1' : '0'); } catch (_) {}
  }
  let joyOn = false;
  try { joyOn = localStorage.getItem('crusaders-joystick') === '1'; } catch (_) {}
  joyToggle.checked = joyOn;
  setJoystick(joyOn);
  joyToggle.addEventListener('change', () => setJoystick(joyToggle.checked));

  // ---- Main loop -------------------------------------------------------------
  let now = 0, last = 0;
  function frame(ts) {
    now = ts;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    for (const u of units) {
      u.t += u.spd * dt;
      while (u.t >= 1) { u.t -= 1; u.i = (u.i + 1) % u.path.length; }
    }
    if (joyVec.x || joyVec.y) { cam.x -= joyVec.x * PAN_SPEED * dt; cam.y -= joyVec.y * PAN_SPEED * dt; }
    const goldWas = res.gold, woodWas = res.wood;
    tickEconomy(dt);
    // Keep the build sheet's affordability greying in sync when it's open.
    if (buildSheet.dataset.open === 'true' && (res.gold !== goldWas || res.wood !== woodWas)) refreshBuildList();
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].t += dt;
      if (floats[i].t > 1.6) floats.splice(i, 1);
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ------------------------------------------------------------------
  // Resume a saved game if there is one; otherwise start fresh in the default
  // mode (demo). Either path leaves `mode`/resources/buildings ready to render.
  const saved = loadState();
  if (saved) {
    applyState(saved);
  } else {
    setSeed(seed);        // sync display + clear caches for the starting seed
    resetWorld('demo');
  }
  if (modeSelect) modeSelect.value = mode;
  resize();
  centerOn(0, 0);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  requestAnimationFrame(frame);

  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
