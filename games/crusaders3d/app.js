/* global THREE */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Crusaders 3D — a three.js proof-of-concept renderer for the same procedural
  // holding. Self-contained; uses the global THREE (classic build) so this file
  // stays a plain script. Primitive geometry for now — the path to high-poly
  // glTF models, instancing and shadows is what this prototype demonstrates.
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('scene');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) {
    document.getElementById('game-loading').innerHTML = '<p style="padding:24px;text-align:center">WebGL isn\'t available on this device.</p>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const SKY = 0xcda26a;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 42, 95);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(24, 22, 24);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 72;
  controls.maxPolarAngle = 1.45;   // don't dip under the ground
  // Left-drag moves (pan), right-drag rotates, wheel zooms. A plain left-click
  // (no drag) selects — handled separately below.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---- Lighting --------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x4a3a28, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.1);
  sun.position.set(22, 32, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 130;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ---- Seeded value noise (shared idea with the 2D version) ------------------
  let seed = 1234567;
  try { const s = localStorage.getItem('crusaders-seed'); if (s) seed = (parseInt(s, 10) >>> 0); } catch (e) {}

  // Mirror the 2D game's saved resources in the HUD overlay.
  (function fillHud() {
    const DEF = { gold: 200, food: 85, water: 30, wood: 40, stone: 0, iron: 0, ale: 0, weapons: 0, army: 0, popularity: 50, pop: 24 };
    let saved = {};
    try { const s = JSON.parse(localStorage.getItem('crusaders-save')); if (s && s.res) saved = s.res; } catch (e) {}
    Object.keys(DEF).forEach(function (k) {
      const el = document.getElementById('r-' + k);
      if (el) el.textContent = (saved[k] != null ? saved[k] : DEF[k]);
    });
  })();
  function hash2(s, x, y) {
    let h = s | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function valueNoise(s, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const top = lerp(hash2(s, xi, yi), hash2(s, xi + 1, yi), u);
    const bot = lerp(hash2(s, xi, yi + 1), hash2(s, xi + 1, yi + 1), u);
    return lerp(top, bot, v);
  }
  function fbm(s, x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) { sum += amp * valueNoise(s + o * 1013, x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  }

  const BIOME_COLOR = {
    dw: 0x2d6586, w: 0x3f86a8, sa: 0xd9b56a, g: 0x7d9b46, fo: 0x5f7e34, ro: 0x8d8475, sn: 0xe8eaf0,
  };
  function biomeFrom(e, m) {
    if (e < 0.34) return 'dw';
    if (e < 0.40) return 'w';
    if (e < 0.45) return 'sa';
    if (e < 0.72) { if (m < 0.42) return 'sa'; if (m > 0.62) return 'fo'; return 'g'; }
    if (e < 0.84) return 'ro';
    return 'sn';
  }
  // Flat ground: land sits at a constant height, water biomes dip below the
  // water plane so the oasis still reads. (No hills/mountains.)
  function sample(x, z) {
    const e = fbm(seed, x * 0.05, z * 0.05);
    const m = fbm(seed + 777, x * 0.045 + 100, z * 0.045 + 100);
    let biome = biomeFrom(e, m);
    if (Math.hypot(x, z) < 11) biome = 'g';   // grass clearing at spawn
    const h = (biome === 'dw' || biome === 'w') ? -0.6 : 0.3;
    return { biome: biome, h: h };
  }

  // ---- Terrain mesh ----------------------------------------------------------
  const SIZE = 70;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colorArr = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const s = sample(x, z);
    pos.setY(i, s.h);
    col.set(BIOME_COLOR[s.biome]);
    colorArr[i * 3] = col.r; colorArr[i * 3 + 1] = col.g; colorArr[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Oasis / sea water plane at y = 0.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f7fa0, transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0.1 })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = -0.05;
  scene.add(water);

  // ---- Buildings (grouped so each can be selected & managed as one) ----------
  const GRID = 2;          // world units per tile/cell (placement snaps to this)
  const SP = GRID;         // demo spacing == grid so everything lines up
  const BASE = 0.3;        // clearing ground height
  const selectable = [];   // meshes a left-click can pick (each → userData.root)
  const objects = [];      // manageable building groups
  function snap(v) { return Math.round(v / GRID) * GRID; }

  // Tile grid over the ground. With SIZE/GRID divisions the helper's lines fall
  // on odd coords, so even-snapped objects already sit in cell centres — no
  // extra offset (that was the misalignment).
  const grid = new THREE.GridHelper(SIZE, SIZE / GRID, 0x6b5836, 0x57462c);
  grid.position.set(0, BASE + 0.02, 0);
  grid.material.transparent = true; grid.material.opacity = 0.4;
  scene.add(grid);
  function mat(color, rough) { return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.9 : rough }); }
  function partBox(g, w, h, d, color, yBase) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(0, yBase + h / 2, 0); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function partRoof(g, radius, h, color, yTop) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 4), mat(color));
    m.position.set(0, yTop + h / 2, 0); m.rotation.y = Math.PI / 4; m.castShadow = true; g.add(m); return m;
  }
  function partCone(g, radius, h, color, yBase, segs) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(radius, h, segs || 4), mat(color));
    m.position.set(0, yBase + h / 2, 0); m.castShadow = true; g.add(m); return m;
  }
  // Register a building group at world (x,z): make its meshes pickable & track it.
  function place(group, x, z, name, cat) {
    group.position.set(x, 0, z);
    group.userData.name = name; group.userData.cat = cat || '';
    group.traverse(function (o) { if (o.isMesh) { o.userData.root = group; selectable.push(o); } });
    scene.add(group); objects.push(group); return group;
  }

  // Keep (with banner)
  let flag;
  (function () {
    const g = new THREE.Group();
    partBox(g, 2.4, 3.4, 2.4, 0xded2b6, BASE);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), mat(0x3a2817));
    pole.position.set(0, BASE + 3.9, 0); g.add(pole);
    flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xd64545, side: THREE.DoubleSide, roughness: 1 }));
    flag.position.set(0.5, BASE + 4.1, 0); g.add(flag);
    place(g, 0, 0, 'The Keep', 'castle');
  })();
  // Towers + conical roofs
  [[-2, -1], [2, -1], [-2, 2], [2, 2]].forEach(function (t) {
    const g = new THREE.Group();
    partBox(g, 1.3, 2.8, 1.3, 0xcdbfa3, BASE);
    partRoof(g, 1.05, 1.2, 0x525c70, BASE + 2.8);
    place(g, t[0] * SP, t[1] * SP, 'Square Tower', 'castle');
  });
  // Gatehouse
  (function () { const g = new THREE.Group(); partBox(g, 1.6, 2.2, 1.6, 0xcdbfa3, BASE); place(g, 0, -3 * SP, 'Gatehouse', 'castle'); })();
  // Curtain wall ring
  [[-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-2, 0], [-2, 1], [-2, 2],
   [2, 0], [2, 1], [2, 2], [-1, 2], [0, 2], [1, 2]].forEach(function (w) {
    const g = new THREE.Group(); partBox(g, 1.05, 1.5, 1.05, 0xb9ad90, BASE); place(g, w[0] * SP, w[1] * SP, 'Castle Wall', 'castle');
  });
  // Hovels (box + terracotta roof)
  [[-4, 4], [-5, 5], [-3, 6]].forEach(function (hh) {
    const g = new THREE.Group(); partBox(g, 1.2, 1.0, 1.2, 0xb06a3b, BASE); partRoof(g, 0.95, 0.9, 0xa14a2c, BASE + 1.0);
    place(g, hh[0] * SP, hh[1] * SP, "Peasant's Hovel", 'housing');
  });
  // Mercenary tents
  [[5, 2], [6, 3]].forEach(function (tt) {
    const g = new THREE.Group(); partCone(g, 0.75, 1.3, 0xe3dcc7, BASE, 12); place(g, tt[0] * SP, tt[1] * SP, 'Mercenary Tent', 'weapons');
  });
  // Market
  (function () { const g = new THREE.Group(); partBox(g, 1.6, 1.2, 1.6, 0xc98f4e, BASE); place(g, 6 * SP, 1 * SP, 'Market', 'community'); })();

  // ---- Trees (InstancedMesh — the perf path for many objects) ----------------
  const treePts = [];
  for (let x = -SIZE / 2 + 1; x < SIZE / 2; x++) {
    for (let z = -SIZE / 2 + 1; z < SIZE / 2; z++) {
      if (Math.hypot(x, z) < 14) continue;
      const s = sample(x, z);
      if (s.h < 0.2) continue;
      const dense = s.biome === 'fo' ? 0.5 : (s.biome === 'g' ? 0.1 : 0);
      if (dense && hash2(seed ^ 0x9e37, x, z) < dense) {
        treePts.push({ x: x + (hash2(seed, x, z) - 0.5) * 0.6, z: z + (hash2(seed, z, x) - 0.5) * 0.6, h: s.h });
      }
    }
  }
  if (treePts.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.13, 0.9, 5), mat(0x6b4a2a, 1), treePts.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 1.6, 7), mat(0x3f7a34, 1), treePts.length);
    trunks.castShadow = true; crowns.castShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < treePts.length; i++) {
      const p = treePts[i];
      dummy.position.set(p.x, p.h + 0.45, p.z); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.h + 1.5, p.z); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
    }
    scene.add(trunks, crowns);
  }

  // ---- Resize ----------------------------------------------------------------
  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  // ---- Quit ------------------------------------------------------------------
  document.getElementById('quit-btn').addEventListener('click', function () {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else { location.href = '../../'; }
  });

  // ---- Left-click select + object tools --------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const info = document.getElementById('info');
  const infoName = document.getElementById('info-name');
  const infoMeta = document.getElementById('info-meta');
  let selected = null, downX = 0, downY = 0, placing = null, tool = 'select';

  function highlight(group, on) {
    group.traverse(function (o) {
      if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(on ? 0x5a3a14 : 0x000000);
    });
  }
  function setSelected(g) {
    if (selected) highlight(selected, false);
    selected = g;
    if (g) {
      highlight(g, true);
      infoName.textContent = g.userData.name || 'Structure';
      const cat = g.userData.cat || '';
      infoMeta.textContent = cat ? (cat.charAt(0).toUpperCase() + cat.slice(1) + ' building') : 'Structure';
      info.classList.add('show');
    } else {
      info.classList.remove('show');
    }
  }
  function pointerToNdc(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }
  function groundTile() {
    const hit = raycaster.intersectObject(ground, false)[0];
    return hit ? { x: snap(hit.point.x), z: snap(hit.point.z) } : null;
  }
  function pickObject(e) {
    pointerToNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(selectable, false);
    return hits.length ? hits[0].object.userData.root : null;
  }

  // The active left-toolbar tool drives what a click/drag does.
  let dragObj = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    downX = e.clientX; downY = e.clientY;
    if (tool === 'move') {                       // grab a building to slide it
      const obj = pickObject(e);
      if (obj) { dragObj = obj; setSelected(obj); controls.enabled = false; }
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragObj) return;
    pointerToNdc(e); raycaster.setFromCamera(ndc, camera);
    const t = groundTile();
    if (t) { dragObj.position.x = t.x; dragObj.position.z = t.z; }
  });
  function endDrag() { if (dragObj) { dragObj = null; controls.enabled = true; } }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerup', function (e) {
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;   // was a drag, not a click
    if (placing) { pointerToNdc(e); raycaster.setFromCamera(ndc, camera); placeAt(); return; }
    const obj = pickObject(e);
    if (tool === 'delete') { if (obj) deleteObj(obj); return; }
    setSelected(obj);                            // select & move tools select on click
  });

  // ---- Object operations -----------------------------------------------------
  function registerGroup(group, name, cat) {   // like place() but keeps current position
    group.userData.name = name; group.userData.cat = cat || '';
    group.traverse(function (o) { if (o.isMesh) { o.userData.root = group; selectable.push(o); } });
    scene.add(group); objects.push(group);
  }
  function deleteObj(g) {
    scene.remove(g);
    for (let i = selectable.length - 1; i >= 0; i--) if (selectable[i].userData.root === g) selectable.splice(i, 1);
    const oi = objects.indexOf(g); if (oi >= 0) objects.splice(oi, 1);
    if (selected === g) setSelected(null);
  }
  // Right info panel actions.
  document.getElementById('info-close').addEventListener('click', function () { setSelected(null); });
  document.getElementById('act-rotate').addEventListener('click', function () { if (selected) selected.rotation.y += Math.PI / 2; });
  document.getElementById('act-copy').addEventListener('click', function () {
    if (!selected) return;
    const clone = selected.clone(true);
    clone.traverse(function (o) { if (o.isMesh && o.material) o.material = o.material.clone(); });
    clone.position.x += GRID; clone.position.z += GRID;
    registerGroup(clone, selected.userData.name, selected.userData.cat);
    setSelected(clone);
  });
  document.getElementById('act-delete').addEventListener('click', function () { if (selected) deleteObj(selected); });

  // ---- Left toolbar: tool modes (Paint-style) --------------------------------
  const TOOL_BTN = { select: document.getElementById('lt-select'), move: document.getElementById('lt-move'), delete: document.getElementById('lt-delete') };
  function setTool(t) {
    tool = t;
    if (t !== 'move') endDrag();
    Object.keys(TOOL_BTN).forEach(function (k) { if (TOOL_BTN[k]) TOOL_BTN[k].classList.toggle('active', k === t); });
  }
  TOOL_BTN.select.addEventListener('click', function () { setTool('select'); });
  TOOL_BTN.move.addEventListener('click', function () { setTool('move'); });
  TOOL_BTN.delete.addEventListener('click', function () { setTool('delete'); });
  setTool('select');

  // ---- Build menu (DOM overlay) + click-to-place -----------------------------
  const CATEGORIES = [
    { id: 'castle', name: 'Castle', icon: '🏰' },
    { id: 'industry', name: 'Industry', icon: '⛏️' },
    { id: 'farm', name: 'Farm', icon: '🌾' },
    { id: 'housing', name: 'Housing', icon: '🏠' },
    { id: 'community', name: 'Community', icon: '🏛️' },
    { id: 'storage', name: 'Storage', icon: '📦' },
    { id: 'weapons', name: 'Weapons', icon: '⚔️' },
  ];
  const BUILDABLE = [
    { type: 'tower', cat: 'castle', icon: '🗼', name: 'Tower' },
    { type: 'wall', cat: 'castle', icon: '🧱', name: 'Wall' },
    { type: 'gatehouse', cat: 'castle', icon: '🚪', name: 'Gatehouse' },
    { type: 'woodcutter', cat: 'industry', icon: '🪓', name: 'Woodcutter' },
    { type: 'quarry', cat: 'industry', icon: '⛏️', name: 'Quarry' },
    { type: 'ironmine', cat: 'industry', icon: '⚒️', name: 'Iron Mine' },
    { type: 'farm', cat: 'farm', icon: '🌾', name: 'Farm' },
    { type: 'orchard', cat: 'farm', icon: '🍎', name: 'Apple Orchard' },
    { type: 'dairy', cat: 'farm', icon: '🐄', name: 'Dairy Farm' },
    { type: 'house', cat: 'housing', icon: '🏠', name: 'Hovel' },
    { type: 'well', cat: 'housing', icon: '💧', name: 'Well' },
    { type: 'market', cat: 'community', icon: '🪙', name: 'Market' },
    { type: 'chapel', cat: 'community', icon: '⛪', name: 'Chapel' },
    { type: 'inn', cat: 'community', icon: '🍻', name: 'Inn' },
    { type: 'mill', cat: 'community', icon: '🌀', name: 'Mill' },
    { type: 'bakery', cat: 'community', icon: '🥖', name: 'Bakery' },
    { type: 'granary', cat: 'storage', icon: '🏬', name: 'Granary' },
    { type: 'stockpile', cat: 'storage', icon: '📦', name: 'Stockpile' },
    { type: 'blacksmith', cat: 'weapons', icon: '🛠️', name: 'Blacksmith' },
    { type: 'fletcher', cat: 'weapons', icon: '🏹', name: 'Fletcher' },
    { type: 'barracks', cat: 'weapons', icon: '⚔️', name: 'Barracks' },
  ];
  const CAT_COLOR = {
    castle: 0xcdbfa3, industry: 0xb98a5a, farm: 0x8a9b46, housing: 0xb06a3b,
    community: 0xc98f4e, storage: 0xa89a7e, weapons: 0x9aa0a8,
  };
  const TALL = { tower: 1, gatehouse: 1, chapel: 1, barracks: 1, mill: 1 };
  let activeCat = 'castle';

  const buildSheet = document.getElementById('build-sheet');
  const buildList = document.getElementById('build-list');
  const buildTabs = document.getElementById('build-tabs');
  const placeBanner = document.getElementById('place-banner');
  const placeText = document.getElementById('place-text');

  function renderTabs() {
    buildTabs.textContent = '';
    CATEGORIES.forEach(function (c) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'build-tab' + (c.id === activeCat ? ' active' : '');
      const ic = document.createElement('span'); ic.className = 'bt-icon'; ic.textContent = c.icon;
      const nm = document.createElement('span'); nm.textContent = c.name;
      t.append(ic, nm);
      t.addEventListener('click', function () { activeCat = c.id; renderTabs(); refreshList(); });
      buildTabs.appendChild(t);
    });
  }
  function refreshList() {
    buildList.textContent = '';
    BUILDABLE.forEach(function (b) {
      if (b.cat !== activeCat) return;
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'build-opt';
      const ic = document.createElement('span'); ic.className = 'bo-icon'; ic.textContent = b.icon;
      const nm = document.createElement('span'); nm.className = 'bo-name'; nm.textContent = b.name;
      el.append(ic, nm);
      el.addEventListener('click', function () { startPlacing(b); });
      buildList.appendChild(el);
    });
  }
  function openBuild() { renderTabs(); refreshList(); buildSheet.dataset.open = 'true'; }
  function closeBuild() { buildSheet.dataset.open = 'false'; }
  function startPlacing(b) { placing = b; closeBuild(); placeText.textContent = 'Click the ground to place ' + b.name; placeBanner.classList.add('show'); }
  function stopPlacing() { placing = null; placeBanner.classList.remove('show'); }

  document.getElementById('build-btn').addEventListener('click', function () {
    if (placing) { stopPlacing(); return; }
    if (buildSheet.dataset.open === 'true') closeBuild(); else openBuild();
  });
  document.getElementById('build-close').addEventListener('click', closeBuild);
  document.getElementById('place-cancel').addEventListener('click', stopPlacing);

  const gridBtn = document.getElementById('grid-btn');
  gridBtn.classList.add('active');
  gridBtn.addEventListener('click', function () {
    grid.visible = !grid.visible;
    gridBtn.classList.toggle('active', grid.visible);
  });

  // Drop a building group on the ground tile under the cursor (raycaster is
  // already aimed from the pointerup handler). Placement is free in this proto.
  function placeAt() {
    const t = groundTile();
    if (!t) return;
    const color = CAT_COLOR[placing.cat] || 0xcdbfa3;
    const h = TALL[placing.type] ? 2.6 : 1.2;
    const g = new THREE.Group();
    partBox(g, 1.4, h, 1.4, color, BASE);
    partRoof(g, 1.15, 1.0, 0x6e4a2b, BASE + h);
    place(g, t.x, t.z, placing.name, placing.cat);
  }

  openBuild();   // bottom build menu visible by default

  // ---- Loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    flag.rotation.y = Math.sin(t * 2) * 0.25;       // gentle banner wave
    water.position.y = -0.05 + Math.sin(t) * 0.03;  // shimmer
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Fade the hint, and clear the splash once ready + at least 3s elapsed.
  setTimeout(function () { const h = document.getElementById('hint'); if (h) h.classList.add('gone'); }, 6000);
  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(function () { loading.classList.add('hidden'); setTimeout(function () { loading.remove(); }, 500); }, remaining);
  })();
})();
