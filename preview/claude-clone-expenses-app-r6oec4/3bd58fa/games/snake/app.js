(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const quitBtn = document.getElementById('quit-btn');
  const skinBtns = Array.from(document.querySelectorAll('.skin-btn'));

  // ---- Skin selection ----
  const SKINS = ['classic', 'nokia'];
  const SKIN_KEY = 'snake-skin';

  function currentSkin() {
    return document.documentElement.dataset.skin === 'nokia' ? 'nokia' : 'classic';
  }

  // Both skins share the LCD scoreboard, so always pad to 4 digits like 0035.
  function fmt(n) {
    return String(n || 0).padStart(4, '0');
  }

  function applySkin(skin) {
    if (!SKINS.includes(skin)) skin = 'classic';
    document.documentElement.dataset.skin = skin;
    try { localStorage.setItem(SKIN_KEY, skin); } catch (_) {}
    skinBtns.forEach((b) => {
      b.classList.toggle('active', b.dataset.skin === skin);
    });
    // Repaint canvas with new snake/food drawing when not actively running.
    if (state !== 'playing' && typeof food !== 'undefined') draw();
  }

  skinBtns.forEach((b) => {
    b.addEventListener('click', () => applySkin(b.dataset.skin));
  });

  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }
  quitBtn.addEventListener('click', quit);

  const GRID = 20;
  const CELL = canvas.width / GRID;
  const TICK_START = 130;
  const TICK_MIN = 60;
  const TICK_STEP = 3;

  let snake, dir, queuedDir, food, score, best, tickMs, lastTick, raf;
  let state = 'ready'; // ready | playing | paused | over

  try { best = parseInt(localStorage.getItem('snake-best') || '0', 10) || 0; } catch (_) { best = 0; }
  bestEl.textContent = fmt(best);

  function reset() {
    snake = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
    ];
    dir = { x: 1, y: 0 };
    queuedDir = dir;
    score = 0;
    tickMs = TICK_START;
    placeFood();
    scoreEl.textContent = fmt(score);
  }

  function placeFood() {
    while (true) {
      const f = {
        x: Math.floor(Math.random() * GRID),
        y: Math.floor(Math.random() * GRID),
      };
      if (!snake.some((s) => s.x === f.x && s.y === f.y)) {
        food = f;
        return;
      }
    }
  }

  function setOverlay(s, title, text, btn) {
    state = s;
    if (s === 'playing') {
      overlay.dataset.state = 'hidden';
      return;
    }
    overlay.dataset.state = s;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    actionBtn.textContent = btn;
  }

  function start() {
    reset();
    setOverlay('playing');
    lastTick = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function pause() {
    if (state !== 'playing') return;
    setOverlay('paused', 'PAUSED', 'Press space, tap, or hit RESUME to continue.', 'RESUME');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    overlay.dataset.state = 'hidden';
    lastTick = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function gameOver() {
    if (score > best) {
      best = score;
      bestEl.textContent = fmt(best);
      try { localStorage.setItem('snake-best', String(best)); } catch (_) {}
    }
    setOverlay('over', 'GAME OVER', `Score: ${score}    Best: ${best}`, 'PLAY AGAIN');
  }

  function step() {
    // Apply queued direction if it isn't a 180° reverse.
    if (queuedDir.x !== -dir.x || queuedDir.y !== -dir.y) {
      dir = queuedDir;
    }

    const head = snake[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      return gameOver();
    }
    // Self-collision (skip the tail tip since it will move out unless we eat).
    const willEat = next.x === food.x && next.y === food.y;
    const body = willEat ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === next.x && s.y === next.y)) {
      return gameOver();
    }

    snake.unshift(next);
    if (willEat) {
      score += 1;
      scoreEl.textContent = fmt(score);
      tickMs = Math.max(TICK_MIN, tickMs - TICK_STEP);
      placeFood();
    } else {
      snake.pop();
    }
  }

  function loop(now) {
    if (state !== 'playing') return;
    if (now - lastTick >= tickMs) {
      step();
      lastTick = now;
      if (state !== 'playing') {
        draw();
        return;
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  // Pixel-art patterns for the Nokia 3310 skin. Each cell is divided
  // into a 3x3 sub-grid; 1 = filled sub-pixel, 0 = empty. The classic
  // 3310 snake body reads as 5-dot "X" stipples and the food is the
  // inverse 4-dot diamond, so the food can be told apart from the body.
  const NOKIA_BODY = [
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
  ];
  const NOKIA_FOOD = [
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
  ];

  function drawPattern(cellX, cellY, pattern) {
    const SIZE = pattern.length;
    const sub = CELL / SIZE;
    const px = cellX * CELL;
    const py = cellY * CELL;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (pattern[r][c]) {
          // Math.ceil prevents thin gaps between sub-pixels caused by
          // sub-pixel rounding when sub isn't a whole pixel.
          ctx.fillRect(
            Math.floor(px + c * sub),
            Math.floor(py + r * sub),
            Math.ceil(sub),
            Math.ceil(sub)
          );
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background grid (subtle).
    const gridLine = getCss('--grid-line');
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL + 0.5, 0);
      ctx.lineTo(i * CELL + 0.5, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL + 0.5);
      ctx.lineTo(canvas.width, i * CELL + 0.5);
      ctx.stroke();
    }

    if (currentSkin() === 'nokia') {
      // Nokia 3310: stippled snake + 4-dot food, like the original LCD.
      ctx.fillStyle = getCss('--food');
      drawPattern(food.x, food.y, NOKIA_FOOD);

      ctx.fillStyle = getCss('--snake');
      for (let i = 0; i < snake.length; i++) {
        const seg = snake[i];
        drawPattern(seg.x, seg.y, NOKIA_BODY);
      }
    } else {
      // Classic: solid connected snake, inset food block.
      ctx.fillStyle = getCss('--food');
      const fInset = Math.floor(CELL / 4);
      ctx.fillRect(
        food.x * CELL + fInset,
        food.y * CELL + fInset,
        CELL - fInset * 2,
        CELL - fInset * 2
      );

      ctx.fillStyle = getCss('--snake');
      for (let i = snake.length - 1; i >= 0; i--) {
        const seg = snake[i];
        ctx.fillRect(seg.x * CELL, seg.y * CELL, CELL, CELL);
      }
    }
  }

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setDirection(nx, ny) {
    queuedDir = { x: nx, y: ny };
  }

  const DIRS = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  };

  function applyDir(name) {
    const d = DIRS[name];
    if (d) setDirection(d[0], d[1]);
  }

  function togglePause() {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { applyDir('up'); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { applyDir('down'); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { applyDir('left'); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { applyDir('right'); e.preventDefault(); }
    else if (k === ' ') { togglePause(); e.preventDefault(); }
    else if (k === 'Enter') {
      if (state === 'over' || state === 'ready') start();
      e.preventDefault();
    }
  });

  actionBtn.addEventListener('click', () => {
    if (state === 'paused') resume();
    else start();
  });

  // Continuous swipe across the entire page: bigger touch surface plays
  // nicer on tablets and larger phones. Each touchmove past a small
  // threshold (relative to the previous registered point) fires a
  // direction change, so the player can keep their finger down and turn
  // repeatedly without lifting. A no-movement touchend toggles pause.
  // Touches that start on a button or on the visible overlay are ignored
  // so the menu (Play / Quit / skin picker) stays tappable.
  let touchStart = null;
  let swipePivot = null;
  let didSwipe = false;
  const SWIPE_STEP = 22;
  const TAP_TOLERANCE = 10;

  function isInteractiveTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest('button, a, input, select, textarea, [role="button"]')) return true;
    const ov = el.closest('.overlay');
    if (ov && ov.dataset.state !== 'hidden') return true;
    return false;
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (isInteractiveTarget(e.target)) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    swipePivot = { x: t.clientX, y: t.clientY };
    didSwipe = false;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!swipePivot) return;
    e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - swipePivot.x;
    const dy = t.clientY - swipePivot.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < SWIPE_STEP && ay < SWIPE_STEP) return;

    if (ax > ay) applyDir(dx > 0 ? 'right' : 'left');
    else applyDir(dy > 0 ? 'down' : 'up');

    // Re-anchor the pivot to the current point so the next step is measured
    // from here — the player can curl their finger and keep turning.
    swipePivot = { x: t.clientX, y: t.clientY };
    didSwipe = true;
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (!didSwipe && Math.abs(dx) < TAP_TOLERANCE && Math.abs(dy) < TAP_TOLERANCE) {
      togglePause();
    }
    touchStart = null;
    swipePivot = null;
    didSwipe = false;
  }, { passive: false });

  document.addEventListener('touchcancel', () => {
    touchStart = null;
    swipePivot = null;
    didSwipe = false;
  });

  // Initial draw so the board is visible behind the start overlay.
  reset();
  draw();

  // Apply the saved skin (an inline <head> script also sets the
  // attribute pre-paint to avoid a flash; this call wires the active
  // class on the picker buttons and re-formats the score for Nokia).
  applySkin(currentSkin());

  // Hide the inline loading screen once the game is ready and at least
  // 3s have elapsed since the document started loading. This is the
  // "loader for at least 3 seconds" requirement from the gallery side.
  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
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
