(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Dataset — landmark YouTube videos, keyed by the year they broke through.
  // No backend / API key: the site is static, so this is a hand-curated set.
  // Every clip is played through the IFrame Player API; if any ID turns out to
  // be unembeddable or removed, onError auto-advances to the next in that year
  // (see playYear/handleError), so a stale entry degrades gracefully.
  // ---------------------------------------------------------------------------
  const VIDEOS = [
    { year: 2005, id: 'jNQXAC9IVRw', title: 'Me at the zoo', by: 'jawed — the first YouTube video' },

    { year: 2006, id: 'dMH0bHeiRNg', title: 'Evolution of Dance', by: 'Judson Laipply' },

    { year: 2007, id: '_OBlgSz8sSM', title: 'Charlie bit my finger — again!', by: 'HDCYT' },
    { year: 2007, id: 'EwTZ2xpQwpA', title: 'Chocolate Rain', by: 'Tay Zonday' },

    { year: 2008, id: 'zlfKdbWwruY', title: 'Where the Hell is Matt? (2008)', by: 'Matt Harding' },

    { year: 2009, id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', by: 'Rick Astley — the rickroll' },
    { year: 2009, id: 'txqiwrbYGrs', title: 'David After Dentist', by: 'booba1234' },

    { year: 2010, id: 'kffacxfA7G4', title: 'Baby ft. Ludacris', by: 'Justin Bieber' },
    { year: 2010, id: 'qybUFnY7Y8w', title: 'This Too Shall Pass — Rube Goldberg', by: 'OK Go' },

    { year: 2011, id: 'QH2-TGUlwu4', title: 'Nyan Cat (original)', by: 'saraj00n' },
    { year: 2011, id: 'kfVsfOSbJY0', title: 'Friday', by: 'Rebecca Black' },

    { year: 2012, id: '9bZkp7q19f0', title: 'Gangnam Style', by: 'PSY' },
    { year: 2012, id: 'IJNR2EpS0jw', title: 'Dumb Ways to Die', by: 'Metro Trains Melbourne' },

    { year: 2013, id: 'jofNR_WkoCE', title: 'The Fox (What Does the Fox Say?)', by: 'Ylvis' },

    { year: 2014, id: 'OPf0YbXqDm0', title: 'Uptown Funk ft. Bruno Mars', by: 'Mark Ronson' },
    { year: 2014, id: 'nfWlot6h_JM', title: 'Shake It Off', by: 'Taylor Swift' },

    { year: 2015, id: 'RgKAFK5djSk', title: 'See You Again ft. Charlie Puth', by: 'Wiz Khalifa' },
    { year: 2015, id: 'YQHsXMglC9A', title: 'Hello', by: 'Adele' },

    { year: 2016, id: 'XqZsoesa55w', title: 'Baby Shark Dance', by: 'Pinkfong' },
    { year: 2016, id: '0E00Zuayv9Q', title: 'PPAP (Pen-Pineapple-Apple-Pen)', by: 'Pikotaro' },

    { year: 2017, id: 'kJQP7kiw5Fk', title: 'Despacito ft. Daddy Yankee', by: 'Luis Fonsi' },
    { year: 2017, id: 'JGwWNGJdvx8', title: 'Shape of You', by: 'Ed Sheeran' },

    { year: 2018, id: 'VYOjWnS4cMY', title: 'This Is America', by: 'Childish Gambino' },

    { year: 2019, id: 'DyDfgMOUjCI', title: 'bad guy', by: 'Billie Eilish' },

    { year: 2020, id: '4NRXx6U8ABQ', title: 'Blinding Lights', by: 'The Weeknd' },
    { year: 2020, id: 'gdZLi9oWNZg', title: 'Dynamite', by: 'BTS' },

    { year: 2021, id: '6swmTBVI83k', title: 'MONTERO (Call Me By Your Name)', by: 'Lil Nas X' },

    { year: 2022, id: 'H5v3kku4y6Q', title: 'As It Was', by: 'Harry Styles' },

    { year: 2023, id: 'G7KNmW9a75Y', title: 'Flowers', by: 'Miley Cyrus' },
  ];

  // ---- derived structures ----
  const byYear = {};
  VIDEOS.forEach((v) => { (byYear[v.year] || (byYear[v.year] = [])).push(v); });
  const YEARS = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const MIN = YEARS[0];
  const MAX = YEARS[YEARS.length - 1];

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const dialView = $('dial-view');
  const stageView = $('stage-view');
  const yrBig = $('yr-big');
  const yrCount = $('yr-count');
  const yrPrev = $('yr-prev');
  const yrNext = $('yr-next');
  const yrRange = $('yr-range');
  const yrScale = $('yr-scale');
  const travelBtn = $('travel');
  const surpriseBtn = $('surprise');
  const veil = $('veil');
  const veilText = $('veil-text');
  const veilLink = $('veil-link');
  const nowYear = $('now-year');
  const nowTitle = $('now-title');
  const nowBy = $('now-by');
  const againBtn = $('again');
  const againYear = $('again-year');
  const rerollBtn = $('reroll');
  const watchLink = $('watch');
  const backBtn = $('back');
  const quitBtn = $('quit');

  // ---- state ----
  let selIdx = Math.floor(YEARS.length / 2); // index into YEARS
  let curYear = YEARS[selIdx];
  let order = [];     // shuffled play order (clip objects) for curYear
  let orderPos = 0;   // index into order
  let player = null;
  let playerReady = false;
  let pendingClip = null; // clip queued before player is ready

  // deterministic-ish shuffle without Date/Math.random restrictions:
  // use a tiny LCG seeded by a rotating counter so reloads vary.
  let seed = (YEARS.length * 2654435761) >>> 0;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---- dial rendering ----
  function renderDial() {
    curYear = YEARS[selIdx];
    yrBig.textContent = curYear;
    const n = byYear[curYear].length;
    yrCount.textContent = n + (n === 1 ? ' clip' : ' clips');
    yrRange.value = String(selIdx);
    yrPrev.disabled = selIdx <= 0;
    yrNext.disabled = selIdx >= YEARS.length - 1;
  }

  function setIdx(i) {
    selIdx = Math.max(0, Math.min(YEARS.length - 1, i));
    renderDial();
  }

  yrPrev.addEventListener('click', () => setIdx(selIdx - 1));
  yrNext.addEventListener('click', () => setIdx(selIdx + 1));
  yrRange.addEventListener('input', () => setIdx(Number(yrRange.value)));

  function buildScale() {
    yrRange.min = '0';
    yrRange.max = String(YEARS.length - 1);
    yrScale.innerHTML = '';
    [MIN, YEARS[Math.floor(YEARS.length / 2)], MAX].forEach((y) => {
      const s = document.createElement('span');
      s.textContent = "'" + String(y).slice(2);
      yrScale.appendChild(s);
    });
  }

  // ---- view switching ----
  function showStage() {
    dialView.hidden = true;
    stageView.hidden = false;
  }
  function showDial() {
    if (player && playerReady) { try { player.stopVideo(); } catch (e) {} }
    stageView.hidden = true;
    dialView.hidden = false;
  }

  // ---- playback ----
  function travelTo(year) {
    curYear = year;
    order = shuffle(byYear[year]);
    orderPos = 0;
    showStage();
    cue(order[orderPos]);
  }

  function nextInYear() {
    if (!order.length) return;
    orderPos = (orderPos + 1) % order.length;
    cue(order[orderPos]);
  }

  function setVeil(state, text) {
    if (state === 'off') { veil.hidden = true; return; }
    veil.hidden = false;
    veilText.textContent = text || 'Tuning in…';
    veilLink.hidden = state !== 'lost';
  }

  function cue(clip) {
    if (!clip) { setVeil('lost', 'No clip found'); return; }
    nowYear.textContent = clip.year;
    nowTitle.textContent = clip.title;
    nowBy.textContent = clip.by;
    againYear.textContent = clip.year;
    const watchUrl = 'https://www.youtube.com/watch?v=' + clip.id;
    watchLink.href = watchUrl;
    veilLink.href = watchUrl;
    setVeil('on', 'Tuning in…');

    if (!playerReady) { pendingClip = clip; return; }
    try {
      player.loadVideoById(clip.id);
    } catch (e) {
      handleError();
    }
  }

  // Auto-advance past any clip the player refuses (removed / embedding off).
  let failStreak = 0;
  function handleError() {
    failStreak += 1;
    if (failStreak >= order.length) {
      // Every clip for this year failed — offer the manual escape hatch.
      setVeil('lost', 'Signal lost for ' + curYear);
      failStreak = 0;
      return;
    }
    nextInYear();
  }

  // ---- YouTube IFrame Player API ----
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 1,
      },
      events: {
        onReady: function () {
          playerReady = true;
          if (pendingClip) { const c = pendingClip; pendingClip = null; cue(c); }
        },
        onStateChange: function (e) {
          // A clip that actually starts clears the loading veil and resets the
          // failure counter for the year.
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) {
            setVeil('off');
            failStreak = 0;
          }
        },
        onError: function () { handleError(); },
      },
    });
  };

  function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  // ---- wiring ----
  travelBtn.addEventListener('click', () => travelTo(YEARS[selIdx]));
  surpriseBtn.addEventListener('click', () => {
    setIdx(Math.floor(rnd() * YEARS.length));
    travelTo(YEARS[selIdx]);
  });
  againBtn.addEventListener('click', nextInYear);
  rerollBtn.addEventListener('click', () => {
    setIdx(Math.floor(rnd() * YEARS.length));
    travelTo(YEARS[selIdx]);
  });
  backBtn.addEventListener('click', showDial);

  function quit() {
    if (player && playerReady) { try { player.stopVideo(); } catch (e) {} }
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else {
      location.href = '../../';
    }
  }
  quitBtn.addEventListener('click', quit);

  // ---- boot ----
  buildScale();
  renderDial();
  loadYouTubeAPI();

  (function hideLoading() {
    const loading = document.getElementById('app-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 3000 - elapsed); // mandatory ≥3s splash
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
