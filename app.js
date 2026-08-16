(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      meta: 'Arcade',
      tagline: "Eat the dots. Don't bite yourself.",
      icon: '🐍',
      url: 'games/snake/',
    },
    {
      slug: 'tic-tac-toe',
      name: 'Tic-Tac-Toe',
      meta: 'Classic',
      tagline: 'Three in a row. Hot-seat for two.',
      icon: '#️⃣',
      url: 'games/tic-tac-toe/',
    },
    {
      slug: 'memory',
      name: 'Memory',
      meta: 'Wildlife',
      tagline: 'Flip cards. Match the pairs.',
      icon: '🐾',
      url: 'games/memory/',
    },
    {
      slug: 'crusaders',
      name: 'Crusaders',
      meta: 'Strategy',
      tagline: 'Roam an isometric desert holding.',
      icon: '🏰',
      url: 'games/crusaders/',
    },
    {
      slug: 'crusaders3d',
      name: 'Crusaders 3D',
      meta: 'Prototype',
      tagline: 'The holding, rebuilt in three.js.',
      icon: '🏯',
      url: 'games/crusaders3d/',
    },
  ];

  const apps = [
    {
      slug: 'locator',
      name: 'Locator',
      meta: 'Map',
      tagline: 'See where you are, in real time.',
      icon: '📍',
      url: 'apps/locator/',
    },
    {
      slug: 'terrain',
      name: 'Terrain',
      meta: 'App',
      tagline: 'Turn a coordinate file into a 3D mesh.',
      icon: '⛰️',
      url: 'apps/terrain/',
    },
    {
      slug: 'timemachine',
      name: 'Time Machine',
      meta: 'Video',
      tagline: 'Dial a year. Watch what defined it.',
      icon: '📼',
      url: 'apps/timemachine/',
    },
    {
      slug: 'binge',
      name: 'Binge',
      meta: 'Video',
      tagline: 'Watch channels start to finish, in order.',
      icon: '🍿',
      url: 'apps/binge/',
    },
    {
      slug: 'marathon',
      name: 'Marathon',
      meta: 'Movies',
      tagline: 'Your actors’ films, in release order.',
      icon: '🎬',
      url: 'apps/marathon/',
    },
    {
      slug: 'usage',
      name: 'Usage',
      meta: 'Status',
      tagline: 'Claude usage meters, live from the feed.',
      icon: '📊',
      url: 'apps/usage/',
    },
    {
      slug: 'expenses',
      name: 'Expenses',
      meta: 'Ledger',
      tagline: 'Construction costs, posted by Claude.',
      icon: '🏗️',
      url: 'apps/expenses/',
    },
    {
      slug: 'buildtrack',
      name: 'BuildTrack',
      meta: 'Tracker',
      tagline: 'Log build costs from your pocket.',
      icon: '🧱',
      url: 'apps/buildtrack/',
    },
    {
      slug: 'directions',
      name: 'Directions',
      meta: 'Coming soon',
      tagline: 'Plot a route between two points.',
      icon: '🧭',
      comingSoon: true,
    },
  ];

  // Same morph + deep-link plumbing serves both grids; we look up by
  // url across the union so games/<slug> and apps/<slug> both work.
  const tiles = games.concat(apps);

  const grid = document.getElementById('grid');
  const appsGrid = document.getElementById('apps-grid');
  const overlay = document.getElementById('game-overlay');
  const wrap = document.getElementById('frame-wrap');
  const frame = document.getElementById('game-frame');
  const skin = document.getElementById('frame-skin');
  const skinIcon = document.getElementById('skin-icon');
  const skinTitle = document.getElementById('skin-title');
  const skinTagline = document.getElementById('skin-tagline');
  const pageMeta = document.getElementById('page-meta');
  const appsMeta = document.getElementById('apps-meta');
  const footMeta = document.getElementById('foot-meta');

  // Match the CSS transitions on .frame-wrap.
  const ZOOM_MS = 550;
  // Card border-radius applied at the small end of the morph.
  const CARD_RADIUS = 0;

  let lastCard = null;
  let lastCardRect = null;
  let lastGame = null;

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function cardInner(g) {
    return `
      <div class="card-art">
        <span class="card-icon" aria-hidden="true">${escapeHTML(g.icon)}</span>
      </div>
      <div class="card-body">
        <h2 class="card-title">${escapeHTML(g.name)}</h2>
        <p class="card-meta">${escapeHTML(g.meta)}</p>
      </div>
    `;
  }

  function cardHtml(g) {
    if (g.comingSoon) {
      return `
        <li class="card locked" data-tile="${escapeHTML(g.slug)}" data-locked="1">
          ${cardInner(g)}
        </li>
      `;
    }
    return `
      <li class="card" data-tile="${escapeHTML(g.slug)}" data-url="${escapeHTML(g.url)}">
        <a href="${escapeHTML(g.url)}">
          ${cardInner(g)}
        </a>
      </li>
    `;
  }

  function renderTiles(gridEl, items, metaEl) {
    if (!gridEl) return;
    gridEl.innerHTML = items.map(cardHtml).join('');
    if (metaEl) {
      const total = items.length;
      const ready = items.filter((g) => !g.comingSoon).length;
      metaEl.textContent = `${ready} / ${total}`;
    }
  }

  function render() {
    renderTiles(grid, games, pageMeta);
    renderTiles(appsGrid, apps, appsMeta);
    if (footMeta) {
      const totalReady = tiles.filter((t) => !t.comingSoon).length;
      footMeta.textContent = `${totalReady} apps & games`;
    }
  }

  function rectFromCard(card) {
    if (card) {
      const r = card.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const w = Math.min(180, window.innerWidth - 32);
    const h = w * 1.3;
    return {
      left: (window.innerWidth - w) / 2,
      top: (window.innerHeight - h) / 2,
      width: w,
      height: h,
    };
  }

  function transformForRect(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return `translate(${rect.left}px, ${rect.top}px)`
         + ` scale(${rect.width / vw}, ${rect.height / vh})`;
  }

  function applySkinFromCard(card, game) {
    if (card) {
      const cs = getComputedStyle(card);
      const g1 = cs.getPropertyValue('--g1').trim();
      if (g1) skin.style.setProperty('--g1', g1);
    }
    skinIcon.textContent = game.icon;
    skinTitle.textContent = game.name;
    skinTagline.textContent = game.meta || '';
  }

  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function openGame(card, game) {
    if (overlay.dataset.state) return;

    const rect = rectFromCard(card);
    lastCard = card || null;
    lastCardRect = rect;
    lastGame = game;

    applySkinFromCard(card, game);

    overlay.hidden = false;
    overlay.dataset.state = 'open';

    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    wrap.style.transform = transformForRect(rect);
    wrap.style.borderRadius = CARD_RADIUS + 'px';
    wrap.style.pointerEvents = 'none';

    skin.classList.add('visible');
    frame.classList.remove('visible');
    frame.src = game.url;

    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = 'translate(0, 0) scale(1, 1)';
      wrap.style.borderRadius = '0';
      skin.classList.remove('visible');
      frame.classList.add('visible');
    });

    setTimeout(() => { wrap.style.pointerEvents = ''; }, ZOOM_MS + 40);

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'shrinking';

    let rect;
    if (lastCard && document.contains(lastCard)) {
      rect = rectFromCard(lastCard);
    } else if (lastCardRect) {
      rect = lastCardRect;
    } else {
      rect = rectFromCard(null);
    }
    lastCardRect = rect;

    if (lastGame) applySkinFromCard(lastCard, lastGame);

    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = transformForRect(rect);
      wrap.style.borderRadius = CARD_RADIUS + 'px';
      skin.classList.add('visible');
      frame.classList.remove('visible');
    });

    setTimeout(finalizeClose, ZOOM_MS + 40);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.removeAttribute('data-state');
    frame.onload = null;
    frame.src = 'about:blank';
    frame.classList.remove('visible');
    skin.classList.remove('visible');
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    wrap.style.transformOrigin = '';
    wrap.style.borderRadius = '';
    wrap.style.pointerEvents = '';
    lastCard = null;
    lastCardRect = null;
    lastGame = null;
  }

  function onGridClick(e) {
    const card = e.target.closest('.card');
    if (!card) return;

    if (card.dataset.locked === '1') {
      e.preventDefault();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      return;
    }

    const url = card.dataset.url;
    if (!url) return;
    const tile = tiles.find((t) => t.url === url);
    if (!tile) return;
    e.preventDefault();
    card.classList.add('tapped');
    setTimeout(() => { card.classList.remove('tapped'); }, 240);
    setTimeout(() => { openGame(card, tile); }, 90);
  }

  if (grid) grid.addEventListener('click', onGridClick);
  if (appsGrid) appsGrid.addEventListener('click', onGridClick);

  window.addEventListener('popstate', () => {
    if (overlay.dataset.state === 'open') {
      closeGame();
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
  });

  // Allow embedded games to request close (their Quit button posts this).
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'close-game') {
      if (history.state && history.state.gameOpen) history.back();
      else closeGame();
    }
  });

  render();

  // ---- Section pager (Home / Apps / Tools / Games) ----
  // Transform-driven barrel carousel. There is no scroll container and
  // no clones — every slide is rendered at its visually-nearest copy
  // of a continuous logical position (modulo N). Touch is captured
  // directly via Pointer Events with axis detection so the inner
  // Games grid still scrolls vertically. Releasing the slide projects
  // velocity, snaps to the nearest target, and animates with rAF.
  //
  // Why this is robust: there are no scroll edges. `pos` can drift
  // arbitrarily large or negative; render() uses ((pos % N)+N)%N to
  // place each slide at its closest visual offset. Fast successive
  // swipes never run out of room — they just keep rotating the
  // barrel. After every settle pos is renormalised back into [0, N)
  // so the running tally stays bounded.
  (function pager() {
    const pagerEl = document.getElementById('pager');
    const navEl = document.getElementById('pager-nav');
    if (!pagerEl || !navEl) return;

    const PAGE_KEY = 'arcade-section';
    const prevBtn = document.getElementById('nav-prev');
    const nextBtn = document.getElementById('nav-next');
    const currLbl = document.getElementById('nav-current');

    const pages = Array.from(pagerEl.querySelectorAll('.page'));
    const N = pages.length;
    const order = pages.map((p) => p.dataset.page);
    const labels = {
      home: 'Home', apps: 'Apps', tools: 'Tools', games: 'Games',
    };

    // ---- Position model ----
    let pos = 0;            // continuous logical position; integer = on slide
    let lastActiveIdx = -1; // last index pushed to the nav, for dedup
    let animRaf = 0;
    let suppressClickUntil = 0;

    function realIndex(name) {
      const i = order.indexOf(name);
      return i === -1 ? 0 : i;
    }

    function indexFromPos(p) {
      return ((Math.round(p) % N) + N) % N;
    }

    function neighbor(name, delta) {
      const i = realIndex(name);
      return order[((i + delta) % N + N) % N];
    }

    function setActive(name) {
      currLbl.textContent = labels[name] || name;
      const prev = neighbor(name, -1);
      const next = neighbor(name, +1);
      prevBtn.textContent = labels[prev];
      nextBtn.textContent = labels[next];
      prevBtn.dataset.page = prev;
      nextBtn.dataset.page = next;
      try { localStorage.setItem(PAGE_KEY, name); } catch (_) {}
    }

    // Place each slide at its visually-nearest copy. delta lives in
    // [-N/2, N/2) so a slide more than halfway around the barrel
    // wraps to the short side; everything outside that range is
    // off-screen and invisible.
    function paint() {
      for (let i = 0; i < N; i++) {
        let d = i - pos;
        d = ((d % N) + N) % N;
        if (d > N / 2) d -= N;
        pages[i].style.transform = `translate3d(${d * 100}%, 0, 0)`;
      }
      const idx = indexFromPos(pos);
      if (idx !== lastActiveIdx) {
        lastActiveIdx = idx;
        setActive(order[idx]);
      }
    }

    // ---- Animation ----
    function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }

    function animateTo(target) {
      cancelAnimationFrame(animRaf);
      const from = pos;
      const dist = target - from;
      if (Math.abs(dist) < 1e-4) {
        pos = target;
        paint();
        return;
      }
      const duration = Math.max(200, Math.min(420, Math.abs(dist) * 280));
      const t0 = performance.now();
      function frame(t) {
        const k = Math.min(1, (t - t0) / duration);
        pos = from + dist * easeOutCubic(k);
        paint();
        if (k < 1) animRaf = requestAnimationFrame(frame);
        else {
          // Renormalise so pos doesn't grow unbounded over many loops.
          pos = ((target % N) + N) % N;
          paint();
          animRaf = 0;
        }
      }
      animRaf = requestAnimationFrame(frame);
    }

    function paginate(delta) {
      animateTo(Math.round(pos) + delta);
    }

    // ---- Pointer / swipe state machine ----
    const ST_IDLE = 0;
    const ST_TRACKING = 1; // axis undecided
    const ST_SWIPING = 2;  // locked to horizontal pan
    let state = ST_IDLE;
    let pointerId = -1;
    let startX = 0, startY = 0, startPos = 0;
    let lastX = 0, lastT = 0;
    let velocity = 0; // slide-widths per ms
    const DIR_LOCK_PX = 8;
    const TAP_SNAP_FRAC = 0.04;

    pagerEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Catch a running animation mid-flight so the user can grab and
      // redirect — pos already reflects the current visual position.
      if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
      state = ST_TRACKING;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startPos = pos;
      lastX = e.clientX;
      lastT = e.timeStamp || performance.now();
      velocity = 0;
    });

    pagerEl.addEventListener('pointermove', (e) => {
      if (state === ST_IDLE || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (state === ST_TRACKING) {
        if (Math.abs(dx) > DIR_LOCK_PX && Math.abs(dx) > Math.abs(dy)) {
          state = ST_SWIPING;
          try { pagerEl.setPointerCapture(e.pointerId); } catch (_) {}
        } else if (Math.abs(dy) > DIR_LOCK_PX) {
          // Vertical pan — let the inner grid scroll natively.
          state = ST_IDLE;
          pointerId = -1;
          return;
        } else {
          return;
        }
      }
      const w = pagerEl.clientWidth || 1;
      pos = startPos - dx / w;
      const t = e.timeStamp || performance.now();
      const dt = t - lastT;
      if (dt > 0) {
        // EWMA smooths jitter from sub-ms move events.
        const inst = -((e.clientX - lastX) / w) / dt;
        velocity = velocity * 0.6 + inst * 0.4;
      }
      lastX = e.clientX;
      lastT = t;
      paint();
    });

    function endSwipe(e) {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      const wasSwipe = state === ST_SWIPING;
      state = ST_IDLE;
      try { pagerEl.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!wasSwipe) return;
      // Click events fire after pointerup; suppress them briefly so a
      // swipe that ends over a card doesn't also open the game.
      suppressClickUntil = performance.now() + 280;
      // Project momentum: a flick should carry to the next slide,
      // a slow drop should snap to the nearest. Cap to ±1 from the
      // slide we started on so a hard fling never skips a section.
      const projection = pos + velocity * 220;
      let target = Math.round(projection);
      const base = Math.round(startPos);
      if (target > base + 1) target = base + 1;
      if (target < base - 1) target = base - 1;
      // If we're effectively where we started AND barely moved,
      // snap back to base (handles tiny accidental drags).
      if (target === base && Math.abs(pos - base) < TAP_SNAP_FRAC) {
        animateTo(base);
        return;
      }
      animateTo(target);
    }

    pagerEl.addEventListener('pointerup', endSwipe);
    pagerEl.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      if (state === ST_SWIPING) animateTo(Math.round(pos));
      state = ST_IDLE;
    });

    // Block click events synthesised by the swipe gesture so cards
    // don't fire after a horizontal drag. Capture phase so we beat
    // the grid handler.
    pagerEl.addEventListener('click', (e) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    prevBtn.addEventListener('click', () => paginate(-1));
    nextBtn.addEventListener('click', () => paginate(+1));

    // Transforms are percentage-based, so layout responds to resize
    // automatically; we just repaint to keep the indicator current.
    window.addEventListener('resize', paint);

    // Restore last section, fall back to Home.
    let initial = 'home';
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      if (saved && order.indexOf(saved) !== -1) initial = saved;
    } catch (_) {}
    pos = realIndex(initial);
    paint();
  })();

  // Deep link: opening /#games/<slug>/ or /#apps/<slug>/ goes
  // straight into the tile.
  (function deepLink() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return;
    const tile = tiles.find((t) => t.url === hash && !t.comingSoon);
    if (tile) {
      history.replaceState(null, '', location.pathname + location.search);
      openGame(null, tile);
    }
  })();
})();
