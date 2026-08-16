(function () {
  // ---- Debug console (gated on ?debug=1 or localStorage flag) ----
  // Capture is on from boot regardless of the flag, so flipping debug
  // on after-the-fact still has context. The visible UI only renders
  // when the flag is set.
  const DEBUG_KEY = 'locator-debug';
  const isDebug = (() => {
    try {
      const params = new URLSearchParams(location.search);
      if (params.has('debug')) {
        const v = params.get('debug');
        if (v === '0' || v === 'false' || v === 'off') {
          try { localStorage.removeItem(DEBUG_KEY); } catch (_) {}
          return false;
        }
        try { localStorage.setItem(DEBUG_KEY, 'true'); } catch (_) {}
        return true;
      }
      return localStorage.getItem(DEBUG_KEY) === 'true';
    } catch (_) { return false; }
  })();

  const logBuffer = [];
  const MAX_BUFFER = 500;
  function pushLog(level, parts) {
    const time = new Date().toISOString().slice(11, 23);
    let text;
    try {
      text = Array.from(parts).map((a) => {
        if (a == null) return String(a);
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch (_) { return String(a); }
        }
        return String(a);
      }).join(' ');
    } catch (_) { text = '<unstringifiable>'; }
    logBuffer.push(`[${time}] ${(level + '    ').slice(0, 5)} ${text}`);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
  }
  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const orig = console[level] && console[level].bind(console);
    console[level] = function () {
      pushLog(level, arguments);
      if (orig) orig.apply(null, arguments);
    };
  });
  window.addEventListener('error', (e) => {
    pushLog('error', [`Uncaught: ${e.message} (${e.filename}:${e.lineno}:${e.colno})`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason && (e.reason.stack || e.reason.message || e.reason);
    pushLog('error', [`Unhandled rejection: ${reason}`]);
  });

  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const metaAcc = document.getElementById('meta-acc');
  const metaTime = document.getElementById('meta-time');
  const followBtn = document.getElementById('follow-btn');
  const retryBtn = document.getElementById('retry-btn');
  const themeBtn = document.getElementById('theme-btn');
  const layersBtn = document.getElementById('layers-btn');
  const layersPopover = document.getElementById('layers-popover');
  const layersList = document.getElementById('layers-list');
  const profileBtn = document.getElementById('profile-btn');
  const profileBtnEmoji = profileBtn.querySelector('.profile-btn-emoji');
  const profileBtnLabel = profileBtn.querySelector('.profile-btn-label');
  const profileSheet = document.getElementById('profile-sheet');
  const profileSheetClose = document.getElementById('profile-close');
  const profileList = document.getElementById('profile-list');
  const quitBtn = document.getElementById('quit-btn');

  // Self-hosted vector tiles from the daily Geofabrik → planetiler
  // pipeline. Same origin as this iframe, so no CORS dance.
  const PMTILES_URL =
    'https://xhevops-claude.github.io/claude-default/cdn/maps/pmtiles/north-macedonia.pmtiles';

  const NMK_CENTER = [21.7453, 41.6086];
  const NMK_ZOOM = 7;
  const FIX_ZOOM = 15;
  const THEME_KEY = 'locator-theme';
  const LAYER_KEY_PREFIX = 'locator-layer-';
  const PROFILE_KEY = 'locator-poi-profile';
  const PROFILES_URL = './poi-profiles.json';
  // Re-evaluate the radius part of the POI filter only after the user
  // moves at least this far. Avoids a full setFilter on every fix.
  const RADIUS_REFRESH_THRESHOLD_M = 25;

  // Embedded fallback so the app still has *something* if the JSON
  // fetch fails (offline, 404, parse error). Mirrors the on-disk
  // poi-profiles.json's default profile.
  const FALLBACK_PROFILES = {
    active: 'default',
    profiles: [
      {
        id: 'default',
        label: 'Default',
        emoji: '📍',
        description: 'All POIs from zoom 12.',
        default: { type: 'zoom', value: 'z12' },
        rules: {},
      },
    ],
  };

  // pmtiles → MapLibre custom protocol
  const pmtilesProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

  // Two palettes for the OpenMapTiles schema. Keys describe the role
  // each colour plays so the same style code drives both themes.
  const THEMES = {
    dark: {
      bg: '#1a1d24',
      land: '#22262e',
      landuse: '#252a33',
      park: '#1f2a23',
      water: '#0f1419',
      waterLabel: '#5b8db1',
      road: '#3d4148',
      roadMid: '#4a4f57',
      roadHi: '#5a6068',
      roadTop: '#6b7178',
      rail: '#3a3f45',
      runway: '#3a3f45',
      boundary: '#3a4048',
      building: '#262a32',
      label: '#cbd5e1',
      labelStrong: '#e2e8f0',
      labelDim: '#94a3b8',
      poi: '#94a3b8',
    },
    light: {
      bg: '#f5f3ee',
      land: '#ecead8',
      landuse: '#e6dccd',
      park: '#cce0c2',
      water: '#aacbe2',
      waterLabel: '#3b6ea3',
      road: '#ffffff',
      roadMid: '#ffffff',
      roadHi: '#ffe9b0',
      roadTop: '#ffc36b',
      rail: '#a8a6a0',
      runway: '#c9c3b3',
      boundary: '#998888',
      building: '#dfd6c5',
      label: '#1a1d24',
      labelStrong: '#0c1118',
      labelDim: '#525866',
      poi: '#525866',
    },
  };
  const TEXT_FONT = ['Noto Sans Regular'];

  // POI icon emojis. Keys are the OMT `poi.class` values we care
  // about; the matching icon is rendered to a tiny canvas at
  // PIXEL_RATIO and registered with MapLibre via map.addImage —
  // because the demo glyph stack we use is Noto Sans Regular, which
  // doesn't carry colour-emoji glyphs, so `text-field: '🍽'` would
  // come back as a missing-glyph box. Canvas-rendered icons
  // sidestep that entirely.
  const POI_ICONS = {
    // Food & drink
    restaurant: '🍽',
    cafe: '☕',
    bar: '🍻',
    pub: '🍺',
    fast_food: '🍔',
    bakery: '🥖',
    ice_cream: '🍦',
    // Shopping
    shop: '🛍',
    supermarket: '🛒',
    mall: '🏬',
    marketplace: '🏪',
    alcohol_shop: '🍷',
    bookshop: '📖',
    book_shop: '📖',
    florist: '💐',
    // Lodging
    hotel: '🏨',
    hostel: '🛌',
    motel: '🛏',
    // Health
    hospital: '🏥',
    clinic: '🏥',
    pharmacy: '💊',
    dentist: '🦷',
    veterinary: '🐾',
    // Education
    school: '🏫',
    college: '🎓',
    university: '🎓',
    library: '📚',
    kindergarten: '🧸',
    // Recreation
    park: '🌳',
    garden: '🌸',
    museum: '🏛',
    art_gallery: '🖼',
    gallery: '🖼',
    theatre: '🎭',
    cinema: '🎬',
    attraction: '🎡',
    theme_park: '🎢',
    viewpoint: '🔭',
    monument: '🗽',
    zoo: '🦁',
    // Transport
    fuel: '⛽',
    parking: '🅿',
    bus: '🚌',
    railway: '🚉',
    taxi: '🚕',
    ferry_terminal: '⛴',
    bicycle_rental: '🚲',
    // Money
    atm: '🏧',
    bank: '🏦',
    // Public services
    post_office: '📬',
    post_box: '📮',
    police: '🚓',
    fire_station: '🚒',
    place_of_worship: '⛪',
    toilets: '🚻',
    information: 'ℹ',
    drinking_water: '🚰',
    // Sports
    sports_centre: '🏃',
    stadium: '🏟',
    pitch: '⚽',
    swimming_pool: '🏊',
    golf: '⛳',
  };
  const POI_CLASS_LIST = Object.keys(POI_ICONS);

  // POI sub-categories — drive the per-category checkboxes in the
  // Layers panel and define which `poi.class` values belong to each.
  // Tuple: [key, label, classes].
  const POI_CATEGORIES_DEF = [
    ['food',       'Food & drink', ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'bakery', 'ice_cream']],
    ['shopping',   'Shopping',     ['shop', 'supermarket', 'mall', 'marketplace', 'alcohol_shop', 'bookshop', 'book_shop', 'florist']],
    ['lodging',    'Lodging',      ['hotel', 'hostel', 'motel']],
    ['health',     'Health',       ['hospital', 'clinic', 'pharmacy', 'dentist', 'veterinary']],
    ['education',  'Education',    ['school', 'college', 'university', 'library', 'kindergarten']],
    ['recreation', 'Recreation',   ['park', 'garden', 'museum', 'art_gallery', 'gallery', 'theatre', 'cinema', 'attraction', 'theme_park', 'viewpoint', 'monument', 'zoo']],
    ['transport',  'Transport',    ['fuel', 'parking', 'bus', 'railway', 'taxi', 'ferry_terminal', 'bicycle_rental']],
    ['money',      'Money',        ['atm', 'bank']],
    ['public',     'Public',       ['post_office', 'post_box', 'police', 'fire_station', 'place_of_worship', 'toilets', 'information', 'drinking_water']],
    ['sports',     'Sports',       ['sports_centre', 'stadium', 'pitch', 'swimming_pool', 'golf']],
  ];

  // Iconography for the place layer — gives big cities a visible
  // emoji even at country zoom. Same canvas-icon mechanism as POIs.
  const PLACE_ICONS = { city: '🏙' };

  // ---- Emoji → MapLibre image registration ----
  // Render at 2x so the icons stay crisp on Retina; MapLibre is told
  // pixelRatio=2 so it scales them down at draw time. The logical
  // size sets the upper bound for how big icons get on screen — the
  // layer's icon-size scales between 0 and 1 against this size.
  const POI_PIXEL_RATIO = 2;
  const POI_LOGICAL_SIZE = 40;

  function emojiToImage(emoji) {
    const w = POI_LOGICAL_SIZE * POI_PIXEL_RATIO;
    const h = POI_LOGICAL_SIZE * POI_PIXEL_RATIO;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.font =
      `${Math.floor(POI_LOGICAL_SIZE * 0.85 * POI_PIXEL_RATIO)}px ` +
      '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, h / 2);
    const imgData = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: imgData.data };
  }

  function registerPoiIcons() {
    // 1x1 transparent placeholder. Profile rules below their zoom
    // threshold map to this image so the symbol is *present* (the
    // expression doesn't fall through to "image not found") but takes
    // virtually no collision space.
    if (!map.hasImage('poi-blank')) {
      try {
        map.addImage('poi-blank', { width: 1, height: 1, data: new Uint8Array(4) }, { pixelRatio: POI_PIXEL_RATIO });
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('addImage failed', 'poi-blank', e);
      }
    }
    POI_CLASS_LIST.forEach((cls) => {
      const id = 'poi-' + cls;
      if (map.hasImage(id)) return;
      try {
        map.addImage(id, emojiToImage(POI_ICONS[cls]), { pixelRatio: POI_PIXEL_RATIO });
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('addImage failed', id, e);
      }
    });
    Object.entries(PLACE_ICONS).forEach(([cls, emoji]) => {
      const id = 'place-' + cls;
      if (map.hasImage(id)) return;
      try {
        map.addImage(id, emojiToImage(emoji), { pixelRatio: POI_PIXEL_RATIO });
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('addImage failed', id, e);
      }
    });
  }

  // Logical groups organised into categories for the Layers UI.
  // Two flavours:
  //   - { layers: [...] }              — toggles visibility on style
  //                                      layer ids (setLayoutProperty)
  //   - { type: 'poi-filter', classes: [...] }
  //                                    — toggles a subset of POI
  //                                      classes by rewriting the
  //                                      `poi` layer's filter
  // Keys also drive the localStorage entry name (locator-layer-<key>).
  const LAYER_CATEGORIES = [
    {
      name: 'Land',
      groups: {
        landuse:       { label: 'Landuse',     defaultOn: true, layers: ['landcover', 'landuse', 'park'] },
        water:         { label: 'Water',       defaultOn: true, layers: ['water', 'waterway'] },
        'water-names': { label: 'Water names', defaultOn: true, layers: ['water-name'] },
      },
    },
    {
      name: 'Transport',
      groups: {
        roads:        { label: 'Roads',      defaultOn: true, layers: ['road-rail', 'road-minor', 'road-secondary', 'road-primary', 'road-motorway'] },
        'road-names': { label: 'Road names', defaultOn: true, layers: ['road-label-major', 'road-label-minor'] },
        aeroways:     { label: 'Airports',   defaultOn: true, layers: ['aeroway-fill', 'aeroway-line', 'aerodrome-label'] },
      },
    },
    {
      name: 'Places',
      groups: {
        places: { label: 'Places', defaultOn: true, layers: ['place-country', 'place-state', 'place-city', 'place-town', 'place-village'] },
        peaks:  { label: 'Peaks',  defaultOn: true, layers: ['peak'] },
      },
    },
    {
      name: 'Detail',
      groups: {
        buildings:  { label: 'Buildings', defaultOn: true, layers: ['building'] },
        boundaries: { label: 'Borders',   defaultOn: true, layers: ['boundary'] },
      },
    },
    {
      name: 'POIs',
      groups: Object.fromEntries(
        POI_CATEGORIES_DEF.map(([key, label, classes]) => [
          'poi-' + key,
          { label, defaultOn: true, classes, type: 'poi-filter' },
        ]),
      ),
    },
  ];
  // Flat lookup so setGroupVisible / isGroupVisible can resolve a
  // group key without walking the categories.
  const LAYER_GROUPS = {};
  LAYER_CATEGORIES.forEach((cat) => {
    Object.entries(cat.groups).forEach(([k, v]) => { LAYER_GROUPS[k] = v; });
  });
  // Reverse map: POI class → containing category key (e.g.
  // 'restaurant' → 'poi-food'). Built once; used by the cluster
  // pipeline to apply per-category debug zoom overrides.
  const CLASS_TO_CATEGORY = {};
  Object.entries(LAYER_GROUPS).forEach(([key, def]) => {
    if (def.type === 'poi-filter' && Array.isArray(def.classes)) {
      def.classes.forEach((cls) => { CLASS_TO_CATEGORY[cls] = key; });
    }
  });
  // In-memory debug overrides keyed by category. Each value is an
  // additional minzoom floor (number 0–22). Always additive — a
  // higher slider value can only HIDE more, never resurrect content
  // the active profile already gates. Cleared on reload.
  const DEBUG_OVERRIDES = {};

  function buildStyle(themeName) {
    const C = THEMES[themeName] || THEMES.dark;
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        omt: { type: 'vector', url: 'pmtiles://' + PMTILES_URL },
        // POI clusters live in their own GeoJSON source. The `poi`
        // vector tile layer above stays as the read-only data source
        // (queried via querySourceFeatures); supercluster reduces
        // those features to either a count cluster or a passthrough
        // singleton, and writes the result here. setData() refreshes
        // the contents on every map idle.
        'poi-clusters': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },

        // ---- Land + water ----
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', paint: { 'fill-color': C.land } },
        { id: 'landuse',   type: 'fill', source: 'omt', 'source-layer': 'landuse',   paint: { 'fill-color': C.landuse } },
        { id: 'park',      type: 'fill', source: 'omt', 'source-layer': 'park',      paint: { 'fill-color': C.park } },
        { id: 'water',     type: 'fill', source: 'omt', 'source-layer': 'water',     paint: { 'fill-color': C.water } },
        { id: 'waterway',  type: 'line', source: 'omt', 'source-layer': 'waterway',  paint: { 'line-color': C.water, 'line-width': 1 } },

        // ---- Aerodromes (runways/taxiways + terminal areas) ----
        { id: 'aeroway-fill', type: 'fill', source: 'omt', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': C.runway, 'fill-opacity': 0.5 } },
        { id: 'aeroway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': C.runway, 'line-width': 1.5 } },

        // ---- Road network — drawn in priority order so big roads sit on top ----
        { id: 'road-rail',     type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'rail'],
          paint: { 'line-color': C.rail, 'line-width': 0.6 } },
        { id: 'road-minor',    type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['service', 'minor', 'track', 'path']]],
          paint: { 'line-color': C.road, 'line-width': 0.6 } },
        { id: 'road-secondary', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
          paint: { 'line-color': C.roadMid, 'line-width': 1 } },
        { id: 'road-primary',  type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
          paint: { 'line-color': C.roadHi, 'line-width': 1.4 } },
        { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'motorway'],
          paint: { 'line-color': C.roadTop, 'line-width': 1.8 } },

        // ---- Buildings + admin boundaries ----
        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building',
          minzoom: 14, paint: { 'fill-color': C.building } },
        { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary',
          filter: ['<=', ['coalesce', ['get', 'admin_level'], 99], 4],
          paint: { 'line-color': C.boundary, 'line-width': 0.8, 'line-dasharray': [2, 2] } },

        // ---- Road labels (street names along the line) ----
        { id: 'road-label-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 11,
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ['get', 'ref']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 12],
            'symbol-placement': 'line',
            'text-letter-spacing': 0.05,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        { id: 'road-label-minor', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name',
          minzoom: 14,
          filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor']]],
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 10,
            'symbol-placement': 'line',
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- Mountain peaks (▲ + name) ----
        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak',
          minzoom: 9,
          layout: {
            'text-field': ['concat', '▲ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- Water names (lakes, big rivers) ----
        { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
          minzoom: 8,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14],
          },
          paint: { 'text-color': C.waterLabel, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- Aerodrome labels ----
        { id: 'aerodrome-label', type: 'symbol', source: 'omt', 'source-layer': 'aerodrome_label',
          minzoom: 9,
          layout: {
            'text-field': ['concat', '✈ ', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },

        // ---- POIs (emoji icons; name below from z16) ----
        // minzoom 12 because OMT only generates POI features from z12
        // and up — going lower has nothing in the tiles to show.
        // symbol-sort-key uses OMT's `rank` (lower = more important),
        // so when collision detection has to drop overlapping icons
        // at low zoom, the important ones win.
        // Icon and text live in the SAME symbol layer so they don't
        // collide with each other — text-optional means MapLibre
        // places the icon first and only adds the name if it fits.
        // text-field uses `step` to delay names until z16.
        { id: 'poi', type: 'symbol', source: 'omt', 'source-layer': 'poi',
          minzoom: 12,
          filter: ['in', ['get', 'class'], ['literal', POI_CLASS_LIST]],
          layout: {
            'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
            'icon-image': ['concat', 'poi-', ['get', 'class']],
            'icon-size': ['interpolate', ['linear'], ['zoom'],
              12, 0.4,
              14, 0.65,
              16, 0.85,
              19, 1.0,
            ],
            'icon-allow-overlap': false,
            'icon-padding': 2,
            'text-field': ['step', ['zoom'],
              '',
              16, ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
            ],
            'text-font': TEXT_FONT,
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 1.4],
            'text-optional': true,
          },
          paint: {
            'text-color': C.poi,
            'text-halo-color': C.bg,
            'text-halo-width': 1.5,
          } },

        // ---- POI clusters ----
        // Two symbol layers reading the same GeoJSON source.
        // `poi-cluster-icon` renders aggregated clusters as the modal
        // POI class's emoji with the count badge to the right (e.g.
        // 🍴 12). `poi-cluster-leaf` renders singletons (point_count
        // absent) as the bare per-class emoji, preserving the look
        // at high zoom.
        { id: 'poi-cluster-icon', type: 'symbol', source: 'poi-clusters',
          filter: ['has', 'point_count'],
          layout: {
            'icon-image': ['concat', 'poi-', ['get', 'topClass']],
            'icon-size': ['interpolate', ['linear'], ['zoom'],
              10, 0.55,
              13, 0.75,
              16, 0.95,
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': TEXT_FONT,
            'text-size': ['step', ['get', 'point_count'], 12, 10, 13, 50, 15],
            'text-anchor': 'left',
            'text-offset': [1.0, 0],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-optional': false,
          },
          paint: {
            'text-color': C.label,
            'text-halo-color': C.bg,
            'text-halo-width': 2,
          } },
        { id: 'poi-cluster-leaf', type: 'symbol', source: 'poi-clusters',
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': ['concat', 'poi-', ['get', 'class']],
            'icon-size': ['interpolate', ['linear'], ['zoom'],
              12, 0.4,
              14, 0.65,
              16, 0.85,
              19, 1.0,
            ],
            'icon-allow-overlap': true,
            'icon-padding': 2,
            'text-field': ['step', ['zoom'], '', 16, ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
            'text-font': TEXT_FONT,
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 1.4],
            'text-optional': true,
          },
          paint: {
            'text-color': C.poi,
            'text-halo-color': C.bg,
            'text-halo-width': 1.5,
          } },

        // ---- Place hierarchy (last so labels win the depth fight) ----
        // Country: visible from world zoom; uppercase, big.
        { id: 'place-country', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'country'],
          minzoom: 3,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 3, 12, 7, 18],
            'text-letter-spacing': 0.15,
            'text-transform': 'uppercase',
            'text-max-width': 8,
          },
          paint: { 'text-color': C.labelStrong, 'text-halo-color': C.bg, 'text-halo-width': 2 } },
        // Region/state — softer than country.
        { id: 'place-state', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'state'],
          minzoom: 5,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 9, 14],
            'text-letter-spacing': 0.08,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        // Cities — capital + major cities visible early. Icon
        // anchors to bottom-of-icon at the city's point so the 🏙
        // sits just above the dot; text-anchor: top puts the name
        // just below the dot. Both stay legible at country zoom.
        { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'city'],
          minzoom: 5,
          layout: {
            'icon-image': 'place-city',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 12, 0.6],
            'icon-anchor': 'bottom',
            'icon-offset': [0, -2],
            'icon-allow-overlap': true,
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 13, 12, 20],
            'text-letter-spacing': 0.05,
            'text-anchor': 'top',
            'text-offset': [0, 0.4],
            'text-optional': true,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.8 } },
        // Towns — medium settlements.
        { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['==', ['get', 'class'], 'town'],
          minzoom: 8,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15],
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
        // Villages/suburbs — only at high zoom.
        { id: 'place-village', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'hamlet']]],
          minzoom: 11,
          layout: {
            'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
            'text-font': TEXT_FONT,
            'text-size': 11,
          },
          paint: { 'text-color': C.labelDim, 'text-halo-color': C.bg, 'text-halo-width': 1.5 } },
      ],
    };
  }

  // Initial theme: localStorage > system preference > dark.
  function readInitialTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  let currentTheme = readInitialTheme();

  // ---- Map ----
  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(currentTheme),
    center: NMK_CENTER,
    zoom: NMK_ZOOM,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · tiles built with <a href="https://github.com/onthegomap/planetiler">planetiler</a>',
  }), 'bottom-right');

  // ---- Map error surfacing + tile watchdog ----
  // Some platforms (notably iOS Safari in private mode) silently
  // reject the PMTiles byte-range fetch or Web Worker init —
  // MapLibre logs to console but the canvas just stays blank. We
  // catch errors directly and bubble them to the status pill so the
  // user has actionable info without devtools.
  let tilesLoaded = 0;
  let mapErrorMessage = '';
  map.on('error', (e) => {
    const msg = (e && e.error && e.error.message) || 'Map error';
    // Surface only the first error; flooding the status pill is noise.
    if (!mapErrorMessage) {
      mapErrorMessage = msg.slice(0, 60);
      // Don't override an active fix.
      if (statusEl.dataset.state !== 'active') {
        setStatus('error', mapErrorMessage);
      }
    }
    if (typeof console !== 'undefined' && console.error) console.error('Map error:', e);
  });
  map.on('data', (e) => {
    if (e.sourceId === 'omt' && e.dataType === 'source' && e.tile) {
      tilesLoaded++;
      refreshClusters();
    }
  });

  // Quick HEAD probe of the PMTiles URL — if the server / network
  // refuses, we know immediately rather than staring at a blank
  // canvas. Doesn't replace MapLibre's own fetch; it's just early
  // diagnostic.
  fetch(PMTILES_URL, { method: 'HEAD' })
    .then((r) => {
      if (!r.ok) {
        const m = `PMTiles ${r.status}`;
        if (!mapErrorMessage) { mapErrorMessage = m; setStatus('error', m); }
      }
    })
    .catch((err) => {
      const m = 'PMTiles unreachable';
      if (!mapErrorMessage) { mapErrorMessage = m; setStatus('error', m); }
      if (typeof console !== 'undefined' && console.error) console.error('PMTiles HEAD failed:', err);
    });

  // If after 10s no tiles have arrived AND no other error has been
  // surfaced, emit one. Helps when MapLibre/pmtiles fail silently
  // (Web Worker blocked, range request rejected, etc.).
  setTimeout(() => {
    if (tilesLoaded === 0 && !mapErrorMessage && statusEl.dataset.state !== 'active') {
      setStatus('error', 'No tiles loaded');
    }
  }, 10000);

  // ---- User pin + accuracy circle ----
  const pinEl = document.createElement('div');
  pinEl.className = 'me-pin';
  pinEl.innerHTML = '<div class="me-pin-ring"></div><div class="me-pin-dot"></div>';
  const pinMarker = new maplibregl.Marker({ element: pinEl, anchor: 'center' });

  function circlePolygon(lng, lat, radiusMeters, points = 64) {
    const dLat = radiusMeters / 111320;
    const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = [];
    for (let i = 0; i < points; i++) {
      const t = (i / points) * 2 * Math.PI;
      ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
    }
    ring.push(ring[0]);
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    };
  }
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };

  function addUserLayers() {
    if (map.getSource('me-accuracy')) return;
    map.addSource('me-accuracy', { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: 'me-accuracy-fill', type: 'fill', source: 'me-accuracy',
      paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.08 },
    });
    map.addLayer({
      id: 'me-accuracy-line', type: 'line', source: 'me-accuracy',
      paint: { 'line-color': '#fb923c', 'line-width': 1.5, 'line-opacity': 0.5 },
    });
    if (lastFixCoords) {
      map.getSource('me-accuracy').setData(circlePolygon.apply(null, lastFixCoords));
    }
  }

  let mapReady = false;
  let pendingFix = null;
  function hidePoiDataLayer() {
    // Original POI symbol layer is the data source for clustering;
    // never paint it directly. Setting visibility=none does NOT
    // affect querySourceFeatures.
    if (map.getLayer('poi')) map.setLayoutProperty('poi', 'visibility', 'none');
  }
  map.on('load', () => {
    registerPoiIcons();
    addUserLayers();
    initSupercluster();
    hidePoiDataLayer();
    captureOriginalMinzooms();
    applyAllGroupVisibility();
    mapReady = true;
    if (pendingFix) { applyFix(pendingFix); pendingFix = null; }
  });
  // setStyle (theme swap) clears all images registered with addImage,
  // so we re-register icons + re-add the user-position source/layers
  // every time the new style finishes loading.
  map.on('style.load', () => {
    if (!mapReady) return;
    registerPoiIcons();
    addUserLayers();
    hidePoiDataLayer();
    captureOriginalMinzooms();
    applyAllGroupVisibility();
  });
  // Recluster on movement; tile-arrival hook lives next to the
  // tilesLoaded counter above to keep `data` listeners in one place.
  map.on('moveend', refreshClusters);

  // ---- Helpers ----
  // The Locate-me button is hidden only when we have a live fix.
  // Keeping it visible during 'locating' matters because some
  // platforms (notably iOS Safari in iframes) silently block
  // watchPosition until the user makes an explicit gesture — the
  // visible button gives them a way to retry.
  function setStatus(state, text) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
    retryBtn.hidden = (state === 'active');
  }
  function fmtAccuracy(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return `±${Math.round(m)}m`;
    return `±${(m / 1000).toFixed(1)}km`;
  }
  function fmtTime(ts) {
    const d = Math.max(0, Date.now() - ts);
    if (d < 1500) return 'now';
    if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    return `${Math.floor(d / 3600000)}h ago`;
  }
  function refreshTime() {
    if (lastFixTs) metaTime.textContent = fmtTime(lastFixTs);
  }

  let movingUs = false;
  function moveProgrammatically(fn) {
    movingUs = true;
    map.once('moveend', () => { movingUs = false; });
    fn();
  }

  // ---- Geolocation ----
  let firstFix = true;
  let follow = true;
  let lastFixTs = 0;
  let lastFixCoords = null;
  let watchId = null;
  let suspended = false;

  function applyFix(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    lastFixCoords = [longitude, latitude, accuracy];
    clearWatchdog();
    pinMarker.setLngLat([longitude, latitude]).addTo(map);
    map.getSource('me-accuracy').setData(circlePolygon(longitude, latitude, accuracy));

    if (firstFix) {
      moveProgrammatically(() => map.flyTo({ center: [longitude, latitude], zoom: FIX_ZOOM, duration: 800 }));
      firstFix = false;
    } else if (follow) {
      moveProgrammatically(() => map.panTo([longitude, latitude], { duration: 400 }));
    }
    setStatus('active', 'Live');
    metaAcc.textContent = fmtAccuracy(accuracy);
    refreshTime();
    maybeRefreshRadiusFilter([longitude, latitude]);
  }
  function onFix(pos) {
    lastFixTs = pos.timestamp || Date.now();
    if (!mapReady) { pendingFix = pos; return; }
    applyFix(pos);
  }
  function onError(err) {
    let msg = 'Location unavailable';
    if (err && err.code === 1) msg = 'Location denied';
    else if (err && err.code === 3) msg = 'Location timed out';
    setStatus('error', msg);
  }
  let watchdog = null;
  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function startWatch() {
    if (!navigator.geolocation) { setStatus('error', 'Not supported'); return; }
    if (watchId !== null) return;
    setStatus('locating', 'Locating…');
    // Some platforms (notably iOS Safari in iframes) stall
    // watchPosition silently — no fix, no error. After 8s without
    // progress, surface a clearer hint so the user knows to tap
    // Locate me to nudge it.
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (lastFixTs === 0 && statusEl.dataset.state === 'locating') {
        setStatus('locating', 'Tap Locate me');
      }
    }, 8000);
    watchId = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
  }
  function stopWatch() {
    clearWatchdog();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { suspended = true; stopWatch(); }
    else if (suspended) { suspended = false; startWatch(); }
  });

  // ---- Follow toggle ----
  function setFollow(on) {
    follow = on;
    followBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on && pinMarker.getLngLat()) {
      moveProgrammatically(() => map.panTo(pinMarker.getLngLat(), { duration: 300 }));
    }
  }
  followBtn.addEventListener('click', () => setFollow(!follow));
  map.on('dragstart', () => { if (!movingUs && follow) setFollow(false); });

  // ---- Theme toggle ----
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    map.setStyle(buildStyle(theme), { diff: false });
  }
  themeBtn.textContent = currentTheme === 'dark' ? 'Light' : 'Dark';
  themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  });

  // ---- Layers UI ----
  // Snapshot of each style layer's original `minzoom` so profile zoom
  // rules can override without losing the floor (e.g. `building` is
  // minzoom:14 in the style; a profile rule of z16 raises that to
  // z16, but a profile with no rule still respects the original 14).
  const ORIGINAL_MINZOOMS = {};
  function captureOriginalMinzooms() {
    const style = map.getStyle();
    const layers = (style && style.layers) || [];
    layers.forEach((l) => {
      if (l.minzoom != null && ORIGINAL_MINZOOMS[l.id] == null) {
        ORIGINAL_MINZOOMS[l.id] = l.minzoom;
      }
    });
  }

  function isGroupVisible(group) {
    try {
      const v = localStorage.getItem(LAYER_KEY_PREFIX + group);
      if (v === 'true' || v === 'false') return v === 'true';
    } catch (_) {}
    const def = LAYER_GROUPS[group];
    return def ? def.defaultOn : true;
  }
  function applyLayerRulesForGroup(group) {
    const def = LAYER_GROUPS[group];
    if (!def || def.type === 'poi-filter') return;
    const profile = getActiveProfile();
    const layerRules = (profile && profile.layers) || {};
    const userOn = isGroupVisible(group);
    const hasRule = Object.prototype.hasOwnProperty.call(layerRules, group);
    const ruleVal = hasRule ? layerRules[group] : undefined;
    const ruleDisabled = ruleVal === null;
    const parsedRule = (ruleVal && typeof ruleVal === 'object') ? parseRule(ruleVal) : null;
    const visibility = (userOn && !ruleDisabled) ? 'visible' : 'none';
    (def.layers || []).forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', visibility);
      const origMin = ORIGINAL_MINZOOMS[layerId] != null ? ORIGINAL_MINZOOMS[layerId] : 0;
      const ruleMin = (parsedRule && parsedRule.type === 'zoom') ? parsedRule.zoomLevel : 0;
      const debugMin = DEBUG_OVERRIDES[group] != null ? DEBUG_OVERRIDES[group] : 0;
      try { map.setLayerZoomRange(layerId, Math.max(origMin, ruleMin, debugMin), 24); } catch (_) {}
    });
  }
  function applyAllLayerRules() {
    Object.keys(LAYER_GROUPS).forEach((g) => {
      const def = LAYER_GROUPS[g];
      if (def && def.type === 'poi-filter') return;
      applyLayerRulesForGroup(g);
    });
  }
  function setGroupVisible(group, visible, persist = true) {
    const def = LAYER_GROUPS[group];
    if (!def) return;
    if (persist) {
      try { localStorage.setItem(LAYER_KEY_PREFIX + group, String(visible)); } catch (_) {}
    }
    if (def.type === 'poi-filter') {
      // POI sub-category — re-derive the layer's filter from the
      // union of currently-enabled categories.
      refreshPoiFilter();
      return;
    }
    applyLayerRulesForGroup(group);
  }
  // ---- POI profiles ----
  // A profile is a per-class display rule. Two rule shapes:
  //   { type: 'zoom',   value: 'z14'   }  → icon appears at zoom ≥ 14
  //   { type: 'radius', value: '500m'  }  → icon appears only when the
  //                                          feature is within 500m of
  //                                          the user's last known
  //                                          location
  // A null rule disables the class. Classes not in `rules` fall back
  // to `profile.default` (which itself can be null = disabled).
  let profilesData = null;
  let activeProfileId = null;
  let lastFixForFilter = null;

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function parseRule(rule) {
    if (rule == null) return null;
    if (typeof rule !== 'object') return null;
    if (rule.type === 'zoom' && typeof rule.value === 'string') {
      const m = /^z(\d+(?:\.\d+)?)$/i.exec(rule.value);
      if (m) return { type: 'zoom', zoomLevel: parseFloat(m[1]) };
    }
    if (rule.type === 'radius' && typeof rule.value === 'string') {
      const m = /^(\d+(?:\.\d+)?)\s*(km|m)$/i.exec(rule.value);
      if (m) {
        const factor = m[2].toLowerCase() === 'km' ? 1000 : 1;
        return { type: 'radius', radiusMeters: parseFloat(m[1]) * factor };
      }
    }
    return null;
  }

  function effectiveRule(profile, cls) {
    if (!profile) return null;
    const rules = profile.rules || {};
    if (Object.prototype.hasOwnProperty.call(rules, cls)) return parseRule(rules[cls]);
    return parseRule(profile.default);
  }

  function getActiveProfile() {
    const list = profilesData && profilesData.profiles;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list.find((p) => p.id === activeProfileId) || list[0];
  }

  function getEnabledLayerClasses() {
    const set = new Set();
    POI_CATEGORIES_DEF.forEach(([key, , classes]) => {
      if (isGroupVisible('poi-' + key)) classes.forEach((c) => set.add(c));
    });
    return set;
  }

  function distanceMeters(a, b) {
    const dLat = (b[1] - a[1]) * 111320;
    const dLng = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    return Math.hypot(dLat, dLng);
  }

  function buildPoiFilter(profile, layerEnabled, userCenter) {
    const allowed = POI_CLASS_LIST.filter((cls) =>
      layerEnabled.has(cls) && effectiveRule(profile, cls) !== null,
    );

    // Group radius classes by their meter value so we share the
    // expensive `within` polygon across classes that all use, say,
    // 500m.
    const radiusBuckets = {};
    const zoomOnly = [];
    allowed.forEach((cls) => {
      const r = effectiveRule(profile, cls);
      if (r.type === 'radius') {
        const k = String(r.radiusMeters);
        (radiusBuckets[k] = radiusBuckets[k] || []).push(cls);
      } else {
        zoomOnly.push(cls);
      }
    });

    const bucketEntries = Object.entries(radiusBuckets);
    if (bucketEntries.length === 0) {
      return ['in', ['get', 'class'], ['literal', allowed]];
    }

    // No fix yet → drop the radius classes; they'll come back when
    // applyFix triggers maybeRefreshRadiusFilter.
    const radiusClauses = userCenter ? bucketEntries.map(([m, classes]) => {
      const poly = circlePolygon(userCenter[0], userCenter[1], parseFloat(m));
      return ['all',
        ['in', ['get', 'class'], ['literal', classes]],
        ['within', poly],
      ];
    }) : [];

    return ['any',
      ['in', ['get', 'class'], ['literal', zoomOnly]],
      ...radiusClauses,
    ];
  }

  function buildIconImageForProfile(profile) {
    // Per-class step expression: below threshold → 'poi-blank' (the
    // 1x1 transparent), above → 'poi-{cls}'. Radius classes are
    // already gated by the filter, so they go straight to their icon.
    const cases = ['case'];
    POI_CLASS_LIST.forEach((cls) => {
      const r = effectiveRule(profile, cls);
      if (!r) return;
      cases.push(['==', ['get', 'class'], cls]);
      if (r.type === 'zoom') {
        cases.push(['step', ['zoom'], 'poi-blank', r.zoomLevel, 'poi-' + cls]);
      } else {
        cases.push('poi-' + cls);
      }
    });
    cases.push('poi-blank');
    return cases;
  }

  function applyPoiProfile() {
    if (!map.getLayer('poi')) return;
    const profile = getActiveProfile();
    if (!profile) return;
    const layerEnabled = getEnabledLayerClasses();
    map.setFilter('poi', buildPoiFilter(profile, layerEnabled, lastFixForFilter));
    map.setLayoutProperty('poi', 'icon-image', buildIconImageForProfile(profile));
    refreshClusters();
  }

  // ---- POI clustering ----
  // The vector-tile `poi` layer is rendered invisible — it exists
  // purely as a data source for querySourceFeatures. Supercluster
  // reduces the matching features into either a count cluster or a
  // singleton (passthrough), which then renders via `poi-cluster-*`
  // layers. Refresh runs debounced on every map move/zoom and after
  // tile loads. Profile zoom rules are enforced in JS at refresh
  // time; radius rules are honoured by passing the `poi` filter
  // expression (which already encodes `within(...)`) to
  // querySourceFeatures.
  let superclusterAvailable = false;
  let clusterRefreshScheduled = false;
  const CLUSTER_DEBOUNCE_MS = 150;
  // Per-class buckets are sparse (a typical block has 1–2 of any
  // given POI class), so `minPoints: 2` makes pairs of the same
  // class collapse into a single badge instead of two icons.
  const CLUSTER_OPTS = { radius: 60, maxZoom: 16, minPoints: 2 };

  function initSupercluster() {
    if (typeof window.Supercluster === 'undefined') {
      if (typeof console !== 'undefined' && console.warn) console.warn('Supercluster not loaded; clustering disabled.');
      return;
    }
    superclusterAvailable = true;
  }

  function refreshClusters() {
    if (clusterRefreshScheduled) return;
    clusterRefreshScheduled = true;
    setTimeout(() => {
      clusterRefreshScheduled = false;
      doRefreshClusters();
    }, CLUSTER_DEBOUNCE_MS);
  }

  function doRefreshClusters() {
    if (!superclusterAvailable) return;
    const src = map.getSource('poi-clusters');
    if (!src) return;
    if (!map.getLayer('poi')) return;
    const profile = getActiveProfile();
    if (!profile) return;
    const filter = map.getFilter('poi');
    let features;
    try {
      features = map.querySourceFeatures('omt', { sourceLayer: 'poi', filter });
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('querySourceFeatures failed:', e);
      return;
    }

    const z = map.getZoom();
    const seen = new Set();
    // Bucket points by class so each class clusters independently —
    // a restaurant and a cafe in the same block stay as two distinct
    // singletons (or two distinct count badges) instead of merging
    // into a mixed cluster.
    const byClass = new Map();
    for (const f of features) {
      const props = f.properties || {};
      const cls = props.class;
      const r = effectiveRule(profile, cls);
      if (!r) continue;
      if (r.type === 'zoom' && z < r.zoomLevel) continue;
      const cat = CLASS_TO_CATEGORY[cls];
      if (cat && DEBUG_OVERRIDES[cat] != null && z < DEBUG_OVERRIDES[cat]) continue;
      const c = f.geometry && f.geometry.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      const key = cls + '|' + c[0].toFixed(6) + '|' + c[1].toFixed(6);
      if (seen.has(key)) continue;
      seen.add(key);
      let bucket = byClass.get(cls);
      if (!bucket) { bucket = []; byClass.set(cls, bucket); }
      bucket.push({
        type: 'Feature',
        properties: {
          class: cls,
          name: props.name,
          'name:en': props['name:en'],
        },
        geometry: { type: 'Point', coordinates: [c[0], c[1]] },
      });
    }

    const bounds = map.getBounds().toArray().flat();
    const out = [];
    for (const [cls, points] of byClass) {
      const sc = new window.Supercluster(CLUSTER_OPTS);
      sc.load(points);
      const clusters = sc.getClusters(bounds, Math.floor(z));
      for (const c of clusters) {
        if (c.properties && c.properties.cluster) c.properties.topClass = cls;
        out.push(c);
      }
    }
    src.setData({ type: 'FeatureCollection', features: out });
  }

  function profileUsesRadius(profile) {
    if (!profile) return false;
    return POI_CLASS_LIST.some((cls) => {
      const r = effectiveRule(profile, cls);
      return r && r.type === 'radius';
    });
  }

  function maybeRefreshRadiusFilter(coords) {
    if (!profileUsesRadius(getActiveProfile())) {
      lastFixForFilter = coords;
      return;
    }
    const moved = !lastFixForFilter || distanceMeters(coords, lastFixForFilter) > RADIUS_REFRESH_THRESHOLD_M;
    if (moved) {
      lastFixForFilter = coords;
      applyPoiProfile();
    }
  }

  // refreshPoiFilter is called from setGroupVisible when a POI
  // category checkbox flips. The profile-aware path handles the rest.
  function refreshPoiFilter() {
    applyPoiProfile();
  }
  function applyAllGroupVisibility() {
    // Non-POI categories drive visibility + zoom range from the
    // user toggle and the active profile's `layers` block. The POI
    // layer's filter is rewritten once after, to avoid one
    // setFilter per category.
    applyAllLayerRules();
    refreshPoiFilter();
  }

  function buildLayersPanel() {
    layersList.innerHTML = LAYER_CATEGORIES.map((cat) => {
      const items = Object.entries(cat.groups).map(([key, def]) => {
        const checked = isGroupVisible(key) ? ' checked' : '';
        return `<li><label><input type="checkbox" data-group="${key}"${checked}>${def.label}</label></li>`;
      }).join('');
      return `<li class="layers-cat-head">${cat.name}</li>${items}`;
    }).join('');
    layersList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        setGroupVisible(e.target.dataset.group, e.target.checked);
      });
    });
  }
  buildLayersPanel();

  function setLayersOpen(open) {
    layersPopover.hidden = !open;
    layersBtn.setAttribute('aria-expanded', String(open));
  }
  layersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayersOpen(layersPopover.hidden);
  });
  // Click-away dismiss.
  document.addEventListener('click', (e) => {
    if (layersPopover.hidden) return;
    if (layersPopover.contains(e.target) || layersBtn.contains(e.target)) return;
    setLayersOpen(false);
  });

  // ---- Profile picker ----
  function syncProfileUI() {
    const active = getActiveProfile();
    const id = active && active.id;
    profileList.querySelectorAll('.profile-card').forEach((btn) => {
      btn.setAttribute('aria-checked', btn.dataset.profileId === id ? 'true' : 'false');
    });
    if (active) {
      profileBtnEmoji.textContent = active.emoji || '📍';
      profileBtnLabel.textContent = active.label || 'Profile';
    }
  }

  function setActiveProfile(id) {
    const list = profilesData && profilesData.profiles;
    if (!Array.isArray(list) || !list.some((p) => p.id === id)) return;
    activeProfileId = id;
    try { localStorage.setItem(PROFILE_KEY, id); } catch (_) {}
    syncProfileUI();
    applyAllLayerRules();
    applyPoiProfile();
  }

  function buildProfilePanel() {
    const list = (profilesData && profilesData.profiles) || [];
    profileList.innerHTML = list.map((p) => {
      const desc = p.description ? `<span class="profile-card-desc">${escapeHTML(p.description)}</span>` : '';
      return (
        `<button type="button" class="profile-card" role="radio" aria-checked="false" data-profile-id="${escapeHTML(p.id)}">` +
        `<span class="profile-card-emoji" aria-hidden="true">${escapeHTML(p.emoji || '📍')}</span>` +
        `<span class="profile-card-info">` +
        `<span class="profile-card-name">${escapeHTML(p.label || p.id)}</span>` +
        desc +
        `</span>` +
        `<span class="profile-card-mark" aria-hidden="true">●</span>` +
        `</button>`
      );
    }).join('');
    profileList.querySelectorAll('.profile-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveProfile(btn.dataset.profileId);
        profileSheet.hidden = true;
      });
    });
    syncProfileUI();
  }

  profileBtn.addEventListener('click', () => { profileSheet.hidden = false; });
  profileSheetClose.addEventListener('click', () => { profileSheet.hidden = true; });

  function loadProfiles() {
    fetch(PROFILES_URL, { cache: 'no-cache' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .catch((err) => {
        if (typeof console !== 'undefined' && console.warn) console.warn('Profile fetch failed, using fallback:', err);
        return FALLBACK_PROFILES;
      })
      .then((data) => {
        profilesData = data && Array.isArray(data.profiles) && data.profiles.length ? data : FALLBACK_PROFILES;
        const ids = profilesData.profiles.map((p) => p.id);
        let saved = null;
        try { saved = localStorage.getItem(PROFILE_KEY); } catch (_) {}
        if (saved && ids.includes(saved)) activeProfileId = saved;
        else if (ids.includes(profilesData.active)) activeProfileId = profilesData.active;
        else activeProfileId = ids[0];
        buildProfilePanel();
        applyAllLayerRules();
        applyPoiProfile();
      });
  }
  loadProfiles();

  // ---- Debug UI (only when ?debug=1 / localStorage flag set) ----
  if (isDebug) {
    const debugBtn = document.getElementById('debug-btn');
    const debugSheet = document.getElementById('debug-sheet');
    const debugLog = document.getElementById('debug-log');
    const debugCopy = document.getElementById('debug-copy');
    const debugShare = document.getElementById('debug-share');
    const debugClear = document.getElementById('debug-clear');
    const debugClose = document.getElementById('debug-close');

    function debugBlob() {
      const meta = [
        `URL: ${location.href}`,
        `UserAgent: ${navigator.userAgent}`,
        `Pixel ratio: ${window.devicePixelRatio}`,
        `Viewport: ${window.innerWidth}×${window.innerHeight}`,
        `Now: ${new Date().toISOString()}`,
        `MapLibre tiles loaded: ${tilesLoaded}`,
        `MapLibre map error: ${mapErrorMessage || '(none)'}`,
        `Theme: ${currentTheme}`,
        '---',
      ].join('\n');
      return meta + '\n' + logBuffer.join('\n');
    }
    function refreshDebug() {
      debugLog.textContent = debugBlob();
      debugLog.scrollTop = debugLog.scrollHeight;
    }
    function openDebug() { debugSheet.hidden = false; refreshDebug(); }
    function closeDebug() { debugSheet.hidden = true; }
    function flashLabel(btn, text) {
      const orig = btn.textContent;
      btn.textContent = text;
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }

    // Per-category min-zoom override sliders. In-memory only —
    // never persists. Useful for eyeballing "what does the map look
    // like if buildings only appeared at z16?" without editing the
    // profile JSON. Additive: a slider can only HIDE more, never
    // resurrect a class the active profile already disabled.
    const debugZoomList = document.getElementById('debug-zoom-list');
    const debugZoomReset = document.getElementById('debug-zoom-reset');
    function fmtZoom(n) { return 'z' + n; }
    function buildDebugZoomSliders() {
      const html = LAYER_CATEGORIES.map((cat) => {
        const rows = Object.entries(cat.groups).map(([key, def]) => {
          const cur = DEBUG_OVERRIDES[key] != null ? DEBUG_OVERRIDES[key] : 0;
          return `<li class="debug-zoom-row" data-group="${key}">
            <span class="debug-zoom-label">${def.label}</span>
            <span class="debug-zoom-val">${fmtZoom(cur)}</span>
            <input type="range" min="0" max="22" step="1" value="${cur}" aria-label="${def.label} min zoom">
          </li>`;
        }).join('');
        return `<li class="debug-zoom-cat">${cat.name}</li>${rows}`;
      }).join('');
      debugZoomList.innerHTML = html;
      debugZoomList.querySelectorAll('.debug-zoom-row').forEach((row) => {
        const group = row.dataset.group;
        const input = row.querySelector('input[type="range"]');
        const val = row.querySelector('.debug-zoom-val');
        input.addEventListener('input', () => {
          const n = parseInt(input.value, 10);
          if (n > 0) DEBUG_OVERRIDES[group] = n;
          else delete DEBUG_OVERRIDES[group];
          val.textContent = fmtZoom(n);
          // Non-POI groups respond via the layer-rules path; POI
          // groups are gated inside the cluster pipeline. Run both
          // — each is cheap and idempotent.
          applyAllLayerRules();
          refreshClusters();
        });
      });
    }
    debugZoomReset.addEventListener('click', () => {
      for (const k in DEBUG_OVERRIDES) delete DEBUG_OVERRIDES[k];
      buildDebugZoomSliders();
      applyAllLayerRules();
      refreshClusters();
    });
    buildDebugZoomSliders();

    debugBtn.hidden = false;
    debugBtn.addEventListener('click', openDebug);
    debugClose.addEventListener('click', closeDebug);
    debugCopy.addEventListener('click', async () => {
      const text = debugBlob();
      try { await navigator.clipboard.writeText(text); flashLabel(debugCopy, 'Copied'); }
      catch (_) { flashLabel(debugCopy, 'Failed'); }
    });
    debugShare.addEventListener('click', async () => {
      const text = debugBlob();
      if (navigator.share) {
        try { await navigator.share({ title: 'Locator debug', text }); } catch (_) {}
      } else {
        // Fallback: download a .txt file.
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `locator-debug-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    });
    debugClear.addEventListener('click', () => {
      logBuffer.length = 0;
      refreshDebug();
    });
    // Auto-refresh while the sheet is open so live errors appear.
    setInterval(() => { if (!debugSheet.hidden) refreshDebug(); }, 1000);
  }

  // ---- Buttons ----
  retryBtn.addEventListener('click', () => { stopWatch(); startWatch(); });
  function quit() {
    stopWatch();
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }
  quitBtn.addEventListener('click', quit);

  // ---- Boot ----
  setInterval(refreshTime, 1000);
  startWatch();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 1000 - elapsed);
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
