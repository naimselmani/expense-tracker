(function () {
  const board = document.getElementById('board');
  const cells = Array.from(board.querySelectorAll('.cell'));
  const status = document.getElementById('status');
  const scoreXEl = document.getElementById('score-x');
  const scoreOEl = document.getElementById('score-o');
  const scoreDEl = document.getElementById('score-d');
  const menu = document.getElementById('menu');
  const menuTitle = document.getElementById('menu-title');
  const menuTagline = document.getElementById('menu-tagline');
  const playBtn = document.getElementById('play-btn');
  const resetBtn = document.getElementById('reset-btn');
  const quitBtn = document.getElementById('quit-btn');
  const winLineSvg = document.getElementById('win-line');
  const winLineSeg = document.getElementById('win-line-segment');

  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  let grid, turn, over, scores;

  function loadScores() {
    try {
      const s = JSON.parse(localStorage.getItem('ttt-scores') || 'null');
      if (s && typeof s === 'object') return s;
    } catch (_) {}
    return { X: 0, O: 0, D: 0 };
  }

  function saveScores() {
    try { localStorage.setItem('ttt-scores', JSON.stringify(scores)); } catch (_) {}
  }

  function renderScores() {
    scoreXEl.textContent = scores.X;
    scoreOEl.textContent = scores.O;
    scoreDEl.textContent = scores.D;
    // Show "RESET SCORES" button only when there's something to reset.
    const hasScores = scores.X || scores.O || scores.D;
    resetBtn.hidden = !hasScores;
  }

  function showMenu(state) {
    if (state === 'ready') {
      menuTitle.textContent = 'tic tac toe';
      menuTagline.textContent = 'three in a row · hot-seat for two';
      playBtn.textContent = 'play';
    } else if (state === 'over-x') {
      menuTitle.textContent = 'x wins';
      menuTagline.textContent = 'one more?';
      playBtn.textContent = 'play again';
    } else if (state === 'over-o') {
      menuTitle.textContent = 'o wins';
      menuTagline.textContent = 'one more?';
      playBtn.textContent = 'play again';
    } else if (state === 'draw') {
      menuTitle.textContent = 'draw';
      menuTagline.textContent = 'try again?';
      playBtn.textContent = 'play again';
    }
    menu.dataset.state = 'ready';
  }

  function hideMenu() {
    menu.dataset.state = 'hidden';
  }

  // Lowercase mark for the handwriting font (× / ○ render nicer).
  const MARK = { X: '×', O: '○' };

  // Convert a winning line (e.g. [0, 1, 2]) into SVG endpoints in cell
  // coordinates (the SVG viewBox is 0 0 3 3, so each unit = one cell).
  function lineEndpoints(line) {
    const a = line[0], b = line[line.length - 1];
    const ax = (a % 3) + 0.5, ay = Math.floor(a / 3) + 0.5;
    const bx = (b % 3) + 0.5, by = Math.floor(b / 3) + 0.5;
    return { ax, ay, bx, by };
  }

  function showWinLine(line) {
    const { ax, ay, bx, by } = lineEndpoints(line);
    winLineSeg.setAttribute('x1', ax);
    winLineSeg.setAttribute('y1', ay);
    winLineSeg.setAttribute('x2', bx);
    winLineSeg.setAttribute('y2', by);
    // Force a reflow so the dash-offset animation runs every time.
    winLineSvg.classList.remove('visible');
    void winLineSvg.getBoundingClientRect();
    winLineSvg.classList.add('visible');
  }

  function hideWinLine() {
    winLineSvg.classList.remove('visible');
  }

  function newRound() {
    grid = Array(9).fill(null);
    turn = 'X';
    over = false;
    cells.forEach((c) => {
      c.removeAttribute('data-mark');
      c.classList.remove('win');
      c.disabled = false;
    });
    hideWinLine();
    status.textContent = `${MARK[turn]} to play`;
  }

  function checkWinner() {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (grid[a] && grid[a] === grid[b] && grid[a] === grid[c]) {
        return { winner: grid[a], line };
      }
    }
    if (grid.every(Boolean)) return { winner: 'D' };
    return null;
  }

  function play(i) {
    if (over || grid[i]) return;
    grid[i] = turn;
    // Set the data attribute only — CSS draws the mark via ::after, so
    // we can per-cell rotate the X/O without touching the DOM tree.
    cells[i].setAttribute('data-mark', MARK[turn]);
    cells[i].disabled = true;

    const result = checkWinner();
    if (result) {
      over = true;
      cells.forEach((c) => { c.disabled = true; });
      if (result.winner === 'D') {
        status.textContent = 'draw';
        scores.D += 1;
      } else {
        status.textContent = `${MARK[result.winner]} wins`;
        scores[result.winner] += 1;
        result.line.forEach((idx) => cells[idx].classList.add('win'));
        showWinLine(result.line);
      }
      saveScores();
      renderScores();
      // Wait briefly so the player can see the result on the board,
      // then bring the menu back with the appropriate state.
      setTimeout(() => {
        const next = result.winner === 'D' ? 'draw'
          : result.winner === 'X' ? 'over-x' : 'over-o';
        showMenu(next);
      }, 1200);
    } else {
      turn = turn === 'X' ? 'O' : 'X';
      status.textContent = `${MARK[turn]} to play`;
    }
  }

  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }

  cells.forEach((c) => {
    c.addEventListener('click', () => play(parseInt(c.dataset.i, 10)));
  });

  playBtn.addEventListener('click', () => {
    newRound();
    hideMenu();
  });

  resetBtn.addEventListener('click', () => {
    scores = { X: 0, O: 0, D: 0 };
    saveScores();
    renderScores();
  });

  quitBtn.addEventListener('click', quit);

  scores = loadScores();
  renderScores();
  newRound();
  showMenu('ready');

  // Hide the inline loading screen once ready and at least 3s have
  // elapsed since the document started loading.
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
