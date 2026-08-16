(function () {
  'use strict';

  // ---- Data ----
  // Twelve animals — enough to cover Expert (12 pairs). Easier difficulties
  // sample a subset.
  const ANIMALS = [
    { emoji: '🦁', name: 'Lion' },
    { emoji: '🐯', name: 'Tiger' },
    { emoji: '🐻', name: 'Bear' },
    { emoji: '🐼', name: 'Panda' },
    { emoji: '🦊', name: 'Fox' },
    { emoji: '🐺', name: 'Wolf' },
    { emoji: '🐨', name: 'Koala' },
    { emoji: '🦘', name: 'Kangaroo' },
    { emoji: '🐘', name: 'Elephant' },
    { emoji: '🦒', name: 'Giraffe' },
    { emoji: '🦓', name: 'Zebra' },
    { emoji: '🐊', name: 'Croc' },
  ];

  // For 3×3 and 5×5 the center cell is a non-matching decorative "wild" so
  // the remaining cells divide evenly into pairs.
  //   3×3: 9 - 1 = 8 = 4 pairs
  //   5×5: 25 - 1 = 24 = 12 pairs
  const DIFFICULTIES = {
    easy:   { label: 'Easy',   rows: 2, cols: 2, pairs: 2,  hasWild: false },
    medium: { label: 'Medium', rows: 3, cols: 3, pairs: 4,  hasWild: true  },
    hard:   { label: 'Hard',   rows: 4, cols: 4, pairs: 8,  hasWild: false },
    expert: { label: 'Expert', rows: 5, cols: 5, pairs: 12, hasWild: true  },
  };

  const DIFF_ORDER = ['easy', 'medium', 'hard', 'expert'];
  const SETTINGS_KEY = 'memory-difficulty';
  const BEST_KEY = (d) => 'memory-best-' + d;

  // ---- DOM refs ----
  const board = document.getElementById('board');
  const diffPicker = document.getElementById('diff-picker');
  const diffIndicator = document.getElementById('diff-indicator');
  const newGameBtn = document.getElementById('new-game-btn');
  const quitBtn = document.getElementById('quit-btn');
  const statMoves = document.getElementById('stat-moves');
  const statTime = document.getElementById('stat-time');
  const statPairs = document.getElementById('stat-pairs');
  const statBest = document.getElementById('stat-best');
  const winOverlay = document.getElementById('win-overlay');
  const winSub = document.getElementById('win-sub');
  const winBest = document.getElementById('win-best');
  const winEmoji = document.getElementById('win-emoji');
  const playAgainBtn = document.getElementById('play-again-btn');

  // ---- State ----
  const state = {
    difficulty: 'medium',
    deck: [],           // [{ idx, animal, isWild, matched }, ...]
    flipped: [],        // indices of currently face-up unmatched tiles
    moves: 0,
    matches: 0,
    pairsTotal: 0,
    locked: false,
    startTime: 0,
    elapsed: 0,
    timerId: 0,
    won: false,
  };

  // ---- Utilities ----
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function loadBest(diff) {
    try {
      const raw = localStorage.getItem(BEST_KEY(diff));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.moves === 'number' && typeof parsed.time === 'number') {
        return parsed;
      }
    } catch (_) {}
    return null;
  }

  function saveBest(diff, record) {
    try { localStorage.setItem(BEST_KEY(diff), JSON.stringify(record)); } catch (_) {}
  }

  function loadDifficulty() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved && DIFFICULTIES[saved]) return saved;
    } catch (_) {}
    return 'medium';
  }

  function saveDifficulty(diff) {
    try { localStorage.setItem(SETTINGS_KEY, diff); } catch (_) {}
  }

  // ---- Deck construction ----
  function buildDeck(diff) {
    const def = DIFFICULTIES[diff];
    const animals = shuffle(ANIMALS).slice(0, def.pairs);
    const tiles = [];
    for (const a of animals) {
      tiles.push({ animal: a, isWild: false, matched: false });
      tiles.push({ animal: a, isWild: false, matched: false });
    }
    const shuffled = shuffle(tiles);

    // Insert the wild tile in the dead center for odd grids.
    if (def.hasWild) {
      const total = def.rows * def.cols;
      const centerIdx = (total - 1) / 2;
      shuffled.splice(centerIdx, 0, { animal: { emoji: '🐾', name: 'Wild' }, isWild: true, matched: false });
    }

    shuffled.forEach((t, i) => { t.idx = i; });
    return shuffled;
  }

  // ---- Render ----
  function render() {
    const def = DIFFICULTIES[state.difficulty];
    board.style.setProperty('--rows', def.rows);
    board.style.setProperty('--cols', def.cols);

    const html = state.deck.map((tile) => {
      const cls = ['tile'];
      if (tile.isWild) cls.push('wild');
      if (tile.matched) cls.push('matched');
      const ariaLabel = tile.isWild
        ? 'Wild tile'
        : (tile.matched ? 'Matched ' + tile.animal.name : 'Face down card');
      return (
        '<button class="' + cls.join(' ') + '" type="button"'
        + ' data-idx="' + tile.idx + '"'
        + (tile.isWild ? ' tabindex="-1" aria-hidden="true"' : '')
        + ' aria-label="' + escapeHTML(ariaLabel) + '">'
        +   '<span class="tile-inner">'
        +     '<span class="tile-face tile-back" aria-hidden="true"></span>'
        +     '<span class="tile-face tile-front">'
        +       '<span class="tile-emoji">' + escapeHTML(tile.animal.emoji) + '</span>'
        +       '<span class="tile-name">' + escapeHTML(tile.animal.name) + '</span>'
        +     '</span>'
        +   '</span>'
        + '</button>'
      );
    }).join('');

    board.innerHTML = html;
    board.classList.remove('entering');
    // Re-trigger the entrance animation.
    void board.offsetWidth;
    board.classList.add('entering');
  }

  function renderStats() {
    statMoves.textContent = String(state.moves);
    statTime.textContent = formatTime(state.elapsed);
    statPairs.textContent = state.matches + ' / ' + state.pairsTotal;
    const best = loadBest(state.difficulty);
    statBest.textContent = best
      ? best.moves + ' · ' + formatTime(best.time)
      : '—';
  }

  // ---- Difficulty picker indicator ----
  function setActiveDiffButton(diff) {
    const buttons = diffPicker.querySelectorAll('.diff-btn');
    let activeBtn = null;
    buttons.forEach((b) => {
      const isActive = b.dataset.diff === diff;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) activeBtn = b;
    });
    if (activeBtn) {
      // Position the sliding indicator over the active button.
      const pickerRect = diffPicker.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      const left = btnRect.left - pickerRect.left;
      diffIndicator.style.width = btnRect.width + 'px';
      diffIndicator.style.transform = 'translateX(' + left + 'px)';
    }
  }

  // ---- Timer ----
  function startTimer() {
    if (state.timerId) return;
    state.startTime = Date.now() - state.elapsed * 1000;
    state.timerId = setInterval(() => {
      state.elapsed = (Date.now() - state.startTime) / 1000;
      statTime.textContent = formatTime(state.elapsed);
    }, 250);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = 0;
    }
  }

  // ---- Game flow ----
  function newGame(diff) {
    stopTimer();
    if (diff) state.difficulty = diff;
    const def = DIFFICULTIES[state.difficulty];
    state.deck = buildDeck(state.difficulty);
    state.flipped = [];
    state.moves = 0;
    state.matches = 0;
    state.pairsTotal = def.pairs;
    state.locked = false;
    state.startTime = 0;
    state.elapsed = 0;
    state.won = false;

    saveDifficulty(state.difficulty);
    setActiveDiffButton(state.difficulty);
    render();
    renderStats();
    hideWinOverlay();
  }

  function onTileClick(e) {
    const tileEl = e.target.closest('.tile');
    if (!tileEl || tileEl.classList.contains('wild')) return;
    if (state.locked) return;

    const idx = Number(tileEl.dataset.idx);
    const tile = state.deck[idx];
    if (!tile || tile.matched) return;
    if (state.flipped.indexOf(idx) !== -1) return; // already flipped (1st pick)
    if (state.flipped.length >= 2) return;

    // Start the timer on first interaction.
    if (state.moves === 0 && state.flipped.length === 0) startTimer();

    tileEl.classList.add('flipped');
    state.flipped.push(idx);

    if (state.flipped.length === 2) {
      state.moves++;
      statMoves.textContent = String(state.moves);
      checkPair();
    }
  }

  function checkPair() {
    const [a, b] = state.flipped;
    const tA = state.deck[a];
    const tB = state.deck[b];
    const elA = board.querySelector('[data-idx="' + a + '"]');
    const elB = board.querySelector('[data-idx="' + b + '"]');
    if (!elA || !elB) {
      state.flipped = [];
      return;
    }

    if (tA.animal.emoji === tB.animal.emoji) {
      // Match — let the flip finish, then mark them gold and pulse.
      state.locked = true;
      setTimeout(() => {
        tA.matched = true;
        tB.matched = true;
        elA.classList.add('matched');
        elB.classList.add('matched');
        state.matches++;
        state.flipped = [];
        state.locked = false;
        renderStats();
        if (state.matches === state.pairsTotal) onWin();
      }, 320);
    } else {
      // Miss — show the miss style briefly, then flip back.
      state.locked = true;
      setTimeout(() => {
        elA.classList.add('miss');
        elB.classList.add('miss');
      }, 320);
      setTimeout(() => {
        elA.classList.remove('flipped', 'miss');
        elB.classList.remove('flipped', 'miss');
        state.flipped = [];
        state.locked = false;
      }, 900);
    }
  }

  // ---- Win ----
  function onWin() {
    state.won = true;
    stopTimer();
    // Make sure the elapsed time reflects the final tick.
    if (state.startTime) {
      state.elapsed = (Date.now() - state.startTime) / 1000;
    }
    statTime.textContent = formatTime(state.elapsed);

    const finalTime = Math.round(state.elapsed);
    const finalMoves = state.moves;
    const prev = loadBest(state.difficulty);
    // Best is judged by moves first, then time as a tiebreaker.
    let isRecord = false;
    if (!prev
        || finalMoves < prev.moves
        || (finalMoves === prev.moves && finalTime < prev.time)) {
      saveBest(state.difficulty, { moves: finalMoves, time: finalTime });
      isRecord = true;
    }
    renderStats();
    showWinOverlay(finalMoves, finalTime, isRecord);
  }

  function showWinOverlay(moves, time, isRecord) {
    const def = DIFFICULTIES[state.difficulty];
    // Pick a random animal for the win emoji (visual flair).
    const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    winEmoji.textContent = a.emoji;
    winSub.textContent = def.label + ' · ' + moves + ' moves · ' + formatTime(time);
    winBest.textContent = isRecord ? '★ New personal best' : '';
    winOverlay.hidden = false;
  }

  function hideWinOverlay() {
    winOverlay.hidden = true;
  }

  // ---- Quit (embedded vs standalone) ----
  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }

  // ---- Wiring ----
  diffPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    const diff = btn.dataset.diff;
    if (!DIFFICULTIES[diff] || diff === state.difficulty) return;
    newGame(diff);
  });

  newGameBtn.addEventListener('click', () => newGame());
  playAgainBtn.addEventListener('click', () => newGame());
  quitBtn.addEventListener('click', quit);

  board.addEventListener('click', onTileClick);

  // Reposition the difficulty indicator on resize.
  window.addEventListener('resize', () => setActiveDiffButton(state.difficulty));

  // Pause the timer when the tab is backgrounded; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.timerId && !state.won) stopTimer();
    } else if (!state.won && state.moves > 0 && state.matches < state.pairsTotal) {
      startTimer();
    }
  });

  // ---- Boot ----
  state.difficulty = loadDifficulty();
  newGame(state.difficulty);
  // The picker indicator needs a layout pass before it can measure.
  requestAnimationFrame(() => setActiveDiffButton(state.difficulty));

  // Hide the inline loading screen once ready and at least 1s has elapsed
  // since the document started loading.
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
