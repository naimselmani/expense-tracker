(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // THE STATIC ACTOR POOL — edit this list (and bump POOL_VERSION so cached
  // filmographies refresh) when the pool should change. Names are fallbacks;
  // real names and photos resolve live from Wikidata.
  // ---------------------------------------------------------------------------
  const ACTORS = [
    { qid: 'Q38111', name: 'Leonardo DiCaprio' },
    { qid: 'Q2263', name: 'Tom Hanks' },
    { qid: 'Q43416', name: 'Keanu Reeves' },
    { qid: 'Q35332', name: 'Brad Pitt' },
    { qid: 'Q37079', name: 'Tom Cruise' },
  ];
  const POOL_VERSION = 1;

  // Data comes live from open, keyless APIs:
  //  - Wikidata Query Service (SPARQL) for actor info, filmographies,
  //    film facts and cast
  //  - Wikipedia for posters (pageimages) and plot summaries (REST)
  const SPARQL = 'https://query.wikidata.org/sparql';
  const WP_API = 'https://en.wikipedia.org/w/api.php';
  const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

  const LS = {
    data: 'marathon-data',            // {v, meta:{qid:{name,img}}, films:{qid:[...]}}
    watched: 'marathon-watched',
    showWatched: 'marathon-showwatched',
    sort: 'marathon-sort',
    group: 'marathon-group',
    hide: 'marathon-hideactors',
    cutoff: 'marathon-cutoff',
    filtersOpen: 'marathon-filters-open',
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---- persisted state ----
  const cached = load(LS.data, null);
  const cacheValid = cached && cached.v === POOL_VERSION;
  let meta = cacheValid ? (cached.meta || {}) : {};    // qid -> {name, img}
  let films = cacheValid ? (cached.films || {}) : {};  // qid -> [{qid,title,year,ymd,poster,article,role}]
  let watched = new Set(load(LS.watched, []));
  let showWatched = load(LS.showWatched, true);
  let sortBy = load(LS.sort, 'old');       // 'old' | 'new' — oldest first is the point
  let groupBy = load(LS.group, 'none');    // 'none' | 'source' | 'year'
  if (['none', 'source', 'year'].indexOf(groupBy) < 0) groupBy = 'none';
  let hidden = new Set(load(LS.hide, []));
  const savedCut = load(LS.cutoff, null);
  let cutoff = (savedCut && typeof savedCut.y === 'number') ? savedCut : todayYMD();
  let filtersOpen = load(LS.filtersOpen, false);

  // ---- runtime state ----
  const loading = new Set();     // actor qids currently fetching
  const collapsed = new Set();
  const posterCache = {};        // article title -> thumb url ('' = tried, none)
  let detail = null;             // open film modal
  let yearRange = [];
  let netFailed = false;

  // ---- elements ----
  const $ = (id) => document.getElementById(id);
  const poolChips = $('pool-chips');
  const fltEl = $('flt'), fltToggle = $('flt-toggle'), fltBody = $('flt-body'), fltSummary = $('flt-summary');
  const srcSwitches = $('src-switches'), srcAllBtn = $('src-all'), srcNoneBtn = $('src-none');
  const fltReset = $('flt-reset'), showWatchedChk = $('show-watched'), clearWatchedBtn = $('clear-watched');
  const refreshBtn = $('refresh-data');
  const fYear = $('f-year'), fMonth = $('f-month'), fDay = $('f-day');
  const yrValue = $('yr-value'), moValue = $('mo-value'), dyValue = $('dy-value');
  const toolbar = $('toolbar'), selSort = $('sel-sort'), selGroup = $('sel-group');
  const progressEl = $('progress'), progressFill = $('progress-fill'), progressText = $('progress-text');
  const upnextEl = $('upnext'), upnextPoster = $('upnext-poster'), upnextTitle = $('upnext-title'), upnextSub = $('upnext-sub');
  const sectionsEl = $('sections');
  const xStatus = $('x-status'), xMsg = $('x-msg'), xAction = $('x-action');
  const detailModal = $('detail-modal'), detailCard = $('detail-card'), detailClose = $('detail-close');
  const detailPoster = $('detail-poster'), detailTitle = $('detail-title'), detailSub = $('detail-sub');
  const detailFacts = $('detail-facts'), detailActions = $('detail-actions'), detailPlot = $('detail-plot');
  const detailSaga = $('detail-saga');
  const castHead = $('cast-head'), castGrid = $('cast-grid'), detailLinks = $('detail-links');
  const quitBtn = $('quit');

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------------
  // Remote data
  // ---------------------------------------------------------------------------
  async function sparql(query) {
    const res = await fetch(SPARQL + '?format=json&query=' + encodeURIComponent(query), {
      headers: { Accept: 'application/sparql-results+json' },
    });
    if (!res.ok) throw new Error('sparql ' + res.status);
    return (await res.json()).results.bindings;
  }
  function qidOf(iri) { const m = /Q\d+$/.exec(iri || ''); return m ? m[0] : null; }
  function articleOf(iri) {
    if (!iri) return null;
    const i = iri.indexOf('/wiki/');
    if (i < 0) return null;
    try { return decodeURIComponent(iri.slice(i + 6)).replace(/_/g, ' '); } catch (e) { return null; }
  }
  function parseWDate(iso) {
    // e.g. "1999-03-31T00:00:00Z" — year-precision dates come through as Jan 1.
    const m = /^(-?\d+)-(\d\d)-(\d\d)/.exec(iso || '');
    if (!m) return null;
    const y = +m[1], mo = +m[2] || 1, d = +m[3] || 1;
    return { y: y, m: mo, d: d, ymd: y * 10000 + mo * 100 + d };
  }
  function httpsize(url) { return String(url || '').replace(/^http:\/\//, 'https://'); }

  // Actor names + photos, one query for the whole pool.
  async function fetchActorMeta() {
    const q =
      'SELECT ?actor ?actorLabel ?img WHERE {\n' +
      '  VALUES ?actor { ' + ACTORS.map((a) => 'wd:' + a.qid).join(' ') + ' }\n' +
      '  OPTIONAL { ?actor wdt:P18 ?img. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '}';
    const rows = await sparql(q);
    const out = {};
    rows.forEach((r) => {
      const qid = qidOf(r.actor && r.actor.value);
      if (!qid) return;
      if (!out[qid]) out[qid] = {
        name: (r.actorLabel && r.actorLabel.value) || null,
        img: r.img ? httpsize(r.img.value) + '?width=240' : null,
      };
    });
    return out;
  }

  const ROLE_LABELS = { P161: 'Acted', P725: 'Voice', P57: 'Directed', P162: 'Produced' };
  async function fetchFilmography(personQ) {
    const q =
      'SELECT ?film ?filmLabel (MIN(?d) AS ?date) (SAMPLE(?art) AS ?article)\n' +
      '       (GROUP_CONCAT(DISTINCT STR(?p); separator=",") AS ?props) WHERE {\n' +
      '  VALUES ?p { wdt:P161 wdt:P725 wdt:P57 wdt:P162 }\n' +
      '  ?film ?p wd:' + personQ + '.\n' +
      '  ?film wdt:P31/wdt:P279* wd:Q11424.\n' +
      '  OPTIONAL { ?film wdt:P577 ?d. }\n' +
      '  OPTIONAL { ?art schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} GROUP BY ?film ?filmLabel ORDER BY ?date LIMIT 400';
    const rows = await sparql(q);
    return rows.map((r) => {
      const qid = qidOf(r.film && r.film.value);
      if (!qid) return null;
      const dt = parseWDate(r.date && r.date.value);
      const props = ((r.props && r.props.value) || '').split(',');
      const roles = [];
      Object.keys(ROLE_LABELS).forEach((p) => {
        if (props.some((x) => x.endsWith('/' + p))) roles.push(ROLE_LABELS[p]);
      });
      return {
        qid: qid,
        title: (r.filmLabel && r.filmLabel.value) || qid,
        ymd: dt ? dt.ymd : null, year: dt ? dt.y : null,
        article: articleOf(r.article && r.article.value),
        poster: null,
        role: roles.join(' · '),
      };
    }).filter(Boolean);
  }

  // Batch-resolve Wikipedia lead images (film posters) for a set of articles.
  async function fetchPosters(titles) {
    const need = Array.from(new Set(titles.filter((t) => t && posterCache[t] === undefined)));
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      try {
        const url = WP_API + '?action=query&format=json&origin=*&redirects=1'
          + '&prop=pageimages&piprop=thumbnail&pithumbsize=360'
          + '&titles=' + encodeURIComponent(chunk.join('|'));
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const q = data.query || {};
        // Map requested title -> final title through normalization + redirects.
        const fwd = {};
        chunk.forEach((t) => { fwd[t] = t; });
        (q.normalized || []).concat(q.redirects || []).forEach((r) => {
          Object.keys(fwd).forEach((k) => { if (fwd[k] === r.from) fwd[k] = r.to; });
        });
        const byTitle = {};
        Object.keys(q.pages || {}).forEach((pid) => {
          const p = q.pages[pid];
          byTitle[p.title] = (p.thumbnail && p.thumbnail.source) || '';
        });
        chunk.forEach((t) => { posterCache[t] = byTitle[fwd[t]] || ''; });
      } catch (e) {
        chunk.forEach((t) => { if (posterCache[t] === undefined) posterCache[t] = ''; });
      }
    }
  }

  async function fetchFilmFacts(qid) {
    const F = 'wd:' + qid;
    const q =
      'SELECT ?date ?runtime ?imdb ?series ?seriesLabel ?dir ?dirLabel ?genre ?genreLabel ?article WHERE {\n' +
      '  OPTIONAL { ' + F + ' wdt:P577 ?date. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P2047 ?runtime. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P345 ?imdb. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P179 ?series. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P57 ?dir. }\n' +
      '  OPTIONAL { ' + F + ' wdt:P136 ?genre. }\n' +
      '  OPTIONAL { ?article schema:about ' + F + '; schema:isPartOf <https://en.wikipedia.org/>. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} LIMIT 400';
    const rows = await sparql(q);
    const facts = { ymd: null, year: null, runtime: null, imdb: null, seriesQ: null, seriesName: null,
      directors: [], genres: [], article: null };
    const dirs = new Set(), genres = new Set();
    rows.forEach((r) => {
      const dt = parseWDate(r.date && r.date.value);
      if (dt && (facts.ymd == null || dt.ymd < facts.ymd)) { facts.ymd = dt.ymd; facts.year = dt.y; }
      if (r.runtime && facts.runtime == null) facts.runtime = Math.round(+r.runtime.value);
      if (r.imdb && !facts.imdb) facts.imdb = r.imdb.value;
      if (r.series && !facts.seriesQ) {
        facts.seriesQ = qidOf(r.series.value);
        facts.seriesName = (r.seriesLabel && r.seriesLabel.value) || null;
      }
      if (r.dirLabel && r.dirLabel.value) dirs.add(r.dirLabel.value);
      if (r.genreLabel && r.genreLabel.value) genres.add(r.genreLabel.value);
      if (!facts.article) facts.article = articleOf(r.article && r.article.value);
    });
    facts.directors = Array.from(dirs);
    facts.genres = Array.from(genres).slice(0, 5);
    return facts;
  }

  async function fetchCast(qid) {
    const F = 'wd:' + qid;
    const q =
      'SELECT ?actor ?actorLabel ?char ?charLabel ?img WHERE {\n' +
      '  { ' + F + ' p:P161 ?st. ?st ps:P161 ?actor. }\n' +
      '  UNION { ' + F + ' p:P725 ?st. ?st ps:P725 ?actor. }\n' +
      '  OPTIONAL { ?st pq:P453 ?char. }\n' +
      '  OPTIONAL { ?actor wdt:P18 ?img. }\n' +
      '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n' +
      '} LIMIT 80';
    const rows = await sparql(q);
    const map = new Map();
    rows.forEach((r) => {
      const aq = qidOf(r.actor && r.actor.value);
      if (!aq) return;
      if (!map.has(aq)) {
        map.set(aq, {
          name: (r.actorLabel && r.actorLabel.value) || aq,
          img: r.img ? httpsize(r.img.value) + '?width=160' : null,
          roles: new Set(),
        });
      }
      if (r.charLabel && r.charLabel.value && !/^Q\d+$/.test(r.charLabel.value)) {
        map.get(aq).roles.add(r.charLabel.value);
      }
    });
    return Array.from(map.values()).slice(0, 30).map((c) => ({
      name: c.name, img: c.img, role: Array.from(c.roles).slice(0, 2).join(' / '),
    }));
  }

  async function fetchSummary(article) {
    if (!article) return null;
    try {
      const res = await fetch(WP_REST + encodeURIComponent(article.replace(/ /g, '_')));
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Data loading / cache
  // ---------------------------------------------------------------------------
  function persistData() { save(LS.data, { v: POOL_VERSION, meta: meta, films: films }); }
  function actorName(qid) {
    return (meta[qid] && meta[qid].name)
      || (ACTORS.find((a) => a.qid === qid) || {}).name || qid;
  }

  function loadData(force) {
    netFailed = false;
    if (force) { meta = {}; films = {}; }
    if (!Object.keys(meta).length) {
      fetchActorMeta().then((m) => { meta = m; persistData(); render(); }).catch(() => {});
    }
    ACTORS.forEach((a) => {
      if (films[a.qid] || loading.has(a.qid)) return;
      loading.add(a.qid);
      (async () => {
        try {
          const list = await fetchFilmography(a.qid);
          await fetchPosters(list.map((f) => f.article));
          list.forEach((f) => { if (f.article) f.poster = posterCache[f.article] || null; });
          films[a.qid] = list;
          persistData();
        } catch (e) { netFailed = true; }
        loading.delete(a.qid);
        render();
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Aggregation / filtering — chronological, oldest first
  // ---------------------------------------------------------------------------
  function allMovies() {
    const map = new Map();
    ACTORS.forEach((a) => {
      if (hidden.has(a.qid)) return;
      (films[a.qid] || []).forEach((f) => {
        if (!map.has(f.qid)) map.set(f.qid, {
          qid: f.qid, title: f.title, year: f.year, ymd: f.ymd,
          poster: f.poster, article: f.article, role: f.role || '', actors: [a.qid],
        });
        else map.get(f.qid).actors.push(a.qid);
      });
    });
    return Array.from(map.values());
  }
  function todayYMD() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function cutoffInt() {
    const d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    return cutoff.y * 10000 + cutoff.m * 100 + d;
  }
  function filteredMovies() {
    const cut = cutoffInt();
    return allMovies().filter((m) => m.ymd == null || m.ymd <= cut);
  }
  function sortMovies(arr) {
    const a = arr.slice();
    const dir = sortBy === 'new' ? -1 : 1;
    a.sort((x, y) => {
      const xy = x.ymd == null ? 99999999 : x.ymd;
      const yy = y.ymd == null ? 99999999 : y.ymd;
      return (xy - yy) * dir || (x.title < y.title ? -1 : 1);
    });
    return a;
  }
  function nextUnwatched(arr) {
    const dir = sortBy;
    sortBy = 'old';
    const order = sortMovies(arr);
    sortBy = dir;
    return order.find((m) => !watched.has(m.qid)) || null;
  }
  function buildGroups(arr) {
    const map = new Map();
    arr.forEach((m) => {
      let key, title;
      if (groupBy === 'source') { key = m.actors[0]; title = actorName(key); }
      else { const y = m.year || 0; key = 'y:' + y; title = y ? String(y) : 'Undated'; }
      if (!map.has(key)) map.set(key, { key: key, title: title, first: m.ymd || 99999999, movies: [] });
      const g = map.get(key);
      g.movies.push(m);
      if (m.ymd && m.ymd < g.first) g.first = m.ymd;
    });
    const groups = Array.from(map.values());
    const dir = sortBy === 'new' ? -1 : 1;
    groups.sort((a, b) => (a.first - b.first) * dir);
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function showStatus(icon, msg, actionLabel, actionFn) {
    xStatus.hidden = false;
    xStatus.querySelector('.status-icon').textContent = icon;
    xMsg.textContent = msg;
    if (actionLabel) { xAction.hidden = false; xAction.textContent = actionLabel; xAction.onclick = actionFn || null; }
    else { xAction.hidden = true; xAction.onclick = null; }
  }

  function renderPool() {
    const solo = ACTORS.length > 1 && ACTORS.filter((a) => !hidden.has(a.qid)).length === 1
      ? ACTORS.find((a) => !hidden.has(a.qid)).qid : null;
    poolChips.innerHTML = ACTORS.map((a) => {
      const off = hidden.has(a.qid);
      const img = meta[a.qid] && meta[a.qid].img;
      return '<span class="pool-chip' + (off ? ' off' : '') + (solo === a.qid ? ' solo' : '') + '" data-src="' + escapeHTML(a.qid) + '">'
        + '<span class="chip-ava round">'
        + (img ? '<img src="' + escapeHTML(img) + '" alt="" loading="lazy" />' : '👤')
        + '</span>'
        + '<span class="chip-name">' + escapeHTML(actorName(a.qid)) + '</span>'
        + '</span>';
    }).join('');
  }

  function renderFilters() {
    const rows = srcSwitches.querySelectorAll('.col-switch');
    if (rows.length !== ACTORS.length) {
      srcSwitches.innerHTML = '';
      ACTORS.forEach((a) => {
        const row = document.createElement('label');
        row.className = 'switch col-switch';
        row.innerHTML =
          '<input type="checkbox" class="switch-input"' + (hidden.has(a.qid) ? '' : ' checked') + ' />'
          + '<span class="switch-track" aria-hidden="true"></span>'
          + '<span class="switch-text"><span data-name="' + escapeHTML(a.qid) + '">' + escapeHTML(actorName(a.qid)) + '</span>'
          + ' <span class="col-n" data-n="' + escapeHTML(a.qid) + '"></span></span>';
        row.querySelector('input').addEventListener('change', () => toggleActor(a.qid));
        srcSwitches.appendChild(row);
      });
    } else {
      ACTORS.forEach((a, i) => { rows[i].querySelector('input').checked = !hidden.has(a.qid); });
    }
    ACTORS.forEach((a) => {
      const nameEl = srcSwitches.querySelector('[data-name="' + a.qid + '"]');
      if (nameEl) nameEl.textContent = actorName(a.qid);
      const n = srcSwitches.querySelector('[data-n="' + a.qid + '"]');
      if (n) n.textContent = films[a.qid] ? String(films[a.qid].length) : (loading.has(a.qid) ? '…' : '?');
    });

    // Date sliders.
    const years = [];
    allMovies().forEach((m) => { if (m.year && years.indexOf(m.year) < 0) years.push(m.year); });
    years.sort((a, b) => a - b);
    const curY = new Date().getFullYear();
    const minY = years.length ? years[0] : curY;
    const maxY = Math.max(curY, years.length ? years[years.length - 1] : curY);
    yearRange = [];
    for (let y = minY; y <= maxY; y++) yearRange.push(y);
    cutoff.y = Math.min(Math.max(cutoff.y, minY), maxY);
    fYear.max = String(yearRange.length - 1);
    fYear.value = String(yearRange.indexOf(cutoff.y));
    yrValue.textContent = String(cutoff.y);
    cutoff.m = Math.min(Math.max(cutoff.m, 1), 12);
    fMonth.value = String(cutoff.m);
    moValue.textContent = MONTHS[cutoff.m - 1];
    cutoff.d = Math.min(Math.max(cutoff.d, 1), daysInMonth(cutoff.y, cutoff.m));
    fDay.value = String(cutoff.d);
    dyValue.textContent = String(cutoff.d);

    const shown = ACTORS.filter((a) => !hidden.has(a.qid)).length;
    const t = todayYMD();
    const isToday = cutoff.y === t.y && cutoff.m === t.m && cutoff.d === t.d;
    const upto = isToday ? 'today' : cutoff.d + ' ' + MONTHS[cutoff.m - 1] + ' ' + cutoff.y;
    fltSummary.textContent = shown + '/' + ACTORS.length + ' actors · up to ' + upto;
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
    showWatchedChk.checked = showWatched;
  }
  function toggleActor(qid) {
    if (hidden.has(qid)) hidden.delete(qid); else hidden.add(qid);
    save(LS.hide, Array.from(hidden));
    render();
  }
  function commitCutoff() { save(LS.cutoff, cutoff); render(); }

  function render() {
    renderPool();
    fltEl.hidden = false;
    toolbar.hidden = false;
    selSort.value = sortBy; selGroup.value = groupBy;
    renderFilters();

    const flt = filteredMovies();
    const total = flt.length;
    const done = flt.filter((m) => watched.has(m.qid)).length;
    progressEl.hidden = false;
    progressFill.style.width = total ? (done / total * 100) + '%' : '0%';
    progressText.textContent = done + ' / ' + total + ' watched';

    const next = nextUnwatched(flt);
    if (next) {
      upnextEl.hidden = false;
      upnextPoster.innerHTML = posterHTML(next.poster, next.title, 'upnext-img');
      upnextTitle.textContent = next.title;
      upnextSub.textContent = [next.year, next.actors.map(actorName).join(', ')].filter(Boolean).join(' · ') || '—';
      upnextEl.dataset.qid = next.qid;
    } else {
      upnextEl.hidden = true;
    }

    if (!total) {
      sectionsEl.innerHTML = '';
      if (loading.size) {
        showStatus('⏳', 'Fetching filmographies for ' + loading.size + ' actor' + (loading.size === 1 ? '' : 's') + '…', null);
      } else if (netFailed && !Object.keys(films).length) {
        showStatus('📡', 'Couldn’t reach the movie database. Check your connection and retry.', 'Retry', () => loadData(false));
      } else {
        showStatus('🔍', 'Nothing matches the filters — actors switched off or released after the cutoff.', 'Reset filters', () => {
          cutoff = todayYMD(); save(LS.cutoff, cutoff);
          hidden = new Set(); save(LS.hide, []);
          render();
        });
      }
      return;
    }
    xStatus.hidden = true;

    const ordered = sortMovies(flt);
    if (groupBy === 'none') {
      const shown = showWatched ? ordered : ordered.filter((m) => !watched.has(m.qid));
      sectionsEl.innerHTML = '<div class="mcards">' + shown.map((m) => cardHTML(m, next)).join('') + '</div>';
      return;
    }

    let groups = buildGroups(ordered).map((g) => ({
      key: g.key, title: g.title, total: g.movies.length,
      done: g.movies.filter((m) => watched.has(m.qid)).length,
      movies: showWatched ? g.movies : g.movies.filter((m) => !watched.has(m.qid)),
    }));
    if (!showWatched) groups = groups.filter((g) => g.movies.length);

    sectionsEl.innerHTML = groups.map((g) => {
      const open = !collapsed.has(g.key);
      const body = open
        ? '<div class="mcards">' + g.movies.map((m) => cardHTML(m, next)).join('') + '</div>'
        : '';
      const allDone = g.done === g.total;
      return '<div class="section' + (open ? ' open' : '') + '">'
        + '<div class="section-head">'
        + '<button class="section-toggle" type="button" data-key="' + escapeHTML(g.key) + '" aria-expanded="' + open + '">'
        + '<span class="section-chev" aria-hidden="true">▸</span>'
        + '<span class="section-title">' + escapeHTML(g.title) + '</span>'
        + '<span class="section-count">' + g.done + ' / ' + g.total + '</span>'
        + '</button>'
        + '<button class="section-markall' + (allDone ? ' done' : '') + '" type="button" data-markkey="' + escapeHTML(g.key) + '" title="Mark all watched">✓</button>'
        + '</div>' + body + '</div>';
    }).join('');
  }

  function posterHTML(url, title, cls, fallbackIcon) {
    if (url) return '<img class="' + cls + '" loading="lazy" src="' + escapeHTML(url) + '" alt="" />';
    return '<span class="' + cls + ' poster-fallback" aria-hidden="true">' + (fallbackIcon || '🎬') + '</span>';
  }
  function fmtRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + (m ? m + 'm' : '') : m + 'm';
  }

  function cardHTML(m, next) {
    const isW = watched.has(m.qid);
    const isNext = next && next.qid === m.qid;
    const bits = [];
    if (m.year) bits.push(String(m.year));
    if (m.role && m.role !== 'Acted') bits.push(escapeHTML(m.role));
    if (groupBy !== 'source') bits.push(escapeHTML(m.actors.map(actorName).join(', ')));
    return '<div class="mcard' + (isW ? ' watched' : '') + (isNext ? ' next' : '') + '" data-qid="' + escapeHTML(m.qid) + '">'
      + '<div class="mposter">' + posterHTML(m.poster, m.title, 'mposter-img')
      + (isNext ? '<span class="next-badge">Up next</span>' : '') + '</div>'
      + '<div class="mmeta"><div class="mtitle">' + escapeHTML(m.title) + '</div>'
      + '<div class="msub">' + bits.join(' · ') + '</div></div>'
      + '<div class="mact">'
      + '<button class="vcheck" type="button" data-act="toggle" data-qid="' + escapeHTML(m.qid) + '" aria-label="Toggle watched">✓</button>'
      + '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Film detail modal
  // ---------------------------------------------------------------------------
  function openDetail(seed) {
    detail = {
      qid: seed.qid, title: seed.title, year: seed.year || null, ymd: seed.ymd || null,
      poster: seed.poster || null, article: seed.article || null,
    };
    detailModal.hidden = false;
    detailCard.scrollTop = 0;
    document.body.classList.add('modal-open');
    detailFacts.innerHTML = ''; detailActions.innerHTML = '';
    detailSaga.hidden = true; detailSaga.innerHTML = '';
    castHead.hidden = true; castGrid.innerHTML = '';
    detailLinks.innerHTML = '';
    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img');
    detailTitle.textContent = detail.title;
    detailSub.textContent = detail.year ? String(detail.year) : '';
    detailPlot.textContent = 'Loading details…';
    renderDetailActions();
    hydrateDetail(detail.qid);
  }
  function closeDetail() {
    detail = null;
    detailModal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  function renderDetailActions() {
    if (!detail) return;
    const isW = watched.has(detail.qid);
    detailActions.innerHTML =
      '<button class="btn ' + (isW ? '' : 'primary ') + 'small" type="button" data-dact="watch">'
      + (isW ? 'Unmark watched' : '✓ Mark watched') + '</button>';
  }

  async function hydrateDetail(qid) {
    const mine = qid;
    let facts = null;
    try { facts = await fetchFilmFacts(qid); } catch (e) { facts = null; }
    if (!detail || detail.qid !== mine) return;

    if (facts) {
      if (facts.ymd && !detail.ymd) { detail.ymd = facts.ymd; detail.year = facts.year; }
      if (facts.article && !detail.article) detail.article = facts.article;
    }

    const [cast, summary] = await Promise.all([
      fetchCast(qid).catch(() => []),
      fetchSummary(detail.article),
    ]);
    if (!detail || detail.qid !== mine) return;

    if (summary && !detail.poster) {
      const t = (summary.thumbnail && summary.thumbnail.source) || null;
      if (t) { detail.poster = t; if (detail.article) posterCache[detail.article] = t; }
    }

    detailPoster.innerHTML = posterHTML(detail.poster, detail.title, 'detail-img');
    detailSub.textContent = [detail.year, facts && facts.seriesName].filter(Boolean).join(' · ') || '';

    const factBits = [];
    if (facts && facts.directors.length) factBits.push('<span class="fact"><b>Director</b> ' + escapeHTML(facts.directors.join(', ')) + '</span>');
    if (facts && facts.runtime) factBits.push('<span class="fact"><b>Runtime</b> ' + fmtRuntime(facts.runtime) + '</span>');
    if (facts && facts.genres.length) factBits.push('<span class="fact"><b>Genres</b> ' + escapeHTML(facts.genres.join(', ')) + '</span>');
    detailFacts.innerHTML = factBits.join('');

    detailPlot.textContent = (summary && summary.extract) || 'No summary available.';

    if (facts && facts.seriesQ) {
      detailSaga.hidden = false;
      detailSaga.innerHTML = '<span class="saga-name">🎞 Part of <b>' + escapeHTML(facts.seriesName || 'a saga') + '</b></span>';
    }

    if (cast.length) {
      castHead.hidden = false;
      castGrid.innerHTML = cast.map((c) =>
        '<div class="cast-card">'
        + (c.img ? '<img class="cast-img" loading="lazy" src="' + escapeHTML(c.img) + '" alt="" />'
                 : '<span class="cast-img cast-fallback" aria-hidden="true">' + escapeHTML((c.name[0] || '?').toUpperCase()) + '</span>')
        + '<span class="cast-name">' + escapeHTML(c.name) + '</span>'
        + (c.role ? '<span class="cast-role">' + escapeHTML(c.role) + '</span>' : '')
        + '</div>').join('');
    }

    const links = [];
    if (facts && facts.imdb) links.push('<a class="btn ghost small" href="https://www.imdb.com/title/' + escapeHTML(facts.imdb) + '/" target="_blank" rel="noopener">IMDb ↗</a>');
    if (detail.article) links.push('<a class="btn ghost small" href="https://en.wikipedia.org/wiki/' + escapeHTML(detail.article.replace(/ /g, '_')) + '" target="_blank" rel="noopener">Wikipedia ↗</a>');
    links.push('<a class="btn ghost small" href="https://www.wikidata.org/wiki/' + escapeHTML(qid) + '" target="_blank" rel="noopener">Wikidata ↗</a>');
    detailLinks.innerHTML = links.join('');
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  // Chips: tap solos that actor (preset filter); tap the soloed chip to unsolo.
  poolChips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-src]');
    if (!chip) return;
    const qid = chip.getAttribute('data-src');
    const enabled = ACTORS.filter((a) => !hidden.has(a.qid));
    if (enabled.length === 1 && enabled[0].qid === qid) hidden = new Set();
    else hidden = new Set(ACTORS.filter((a) => a.qid !== qid).map((a) => a.qid));
    save(LS.hide, Array.from(hidden));
    render();
  });

  fltToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen; save(LS.filtersOpen, filtersOpen);
    fltBody.hidden = !filtersOpen;
    fltToggle.setAttribute('aria-expanded', String(filtersOpen));
    fltToggle.classList.toggle('open', filtersOpen);
  });
  srcAllBtn.addEventListener('click', () => { hidden = new Set(); save(LS.hide, []); render(); });
  srcNoneBtn.addEventListener('click', () => {
    hidden = new Set(ACTORS.map((a) => a.qid));
    save(LS.hide, Array.from(hidden));
    render();
  });
  fltReset.addEventListener('click', () => { cutoff = todayYMD(); save(LS.cutoff, cutoff); render(); });
  clearWatchedBtn.addEventListener('click', () => { if (watched.size) { watched = new Set(); save(LS.watched, []); render(); } });
  refreshBtn.addEventListener('click', () => { loadData(true); render(); });
  showWatchedChk.addEventListener('change', () => { showWatched = showWatchedChk.checked; save(LS.showWatched, showWatched); render(); });

  fYear.addEventListener('input', () => {
    cutoff.y = yearRange[Number(fYear.value)] || cutoff.y;
    cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    yrValue.textContent = String(cutoff.y); commitCutoff();
  });
  fMonth.addEventListener('input', () => {
    cutoff.m = Number(fMonth.value);
    cutoff.d = Math.min(cutoff.d, daysInMonth(cutoff.y, cutoff.m));
    moValue.textContent = MONTHS[cutoff.m - 1]; commitCutoff();
  });
  fDay.addEventListener('input', () => {
    cutoff.d = Math.min(Number(fDay.value), daysInMonth(cutoff.y, cutoff.m));
    dyValue.textContent = String(cutoff.d); commitCutoff();
  });

  selSort.addEventListener('change', () => { sortBy = selSort.value; save(LS.sort, sortBy); render(); });
  selGroup.addEventListener('change', () => { groupBy = selGroup.value; collapsed.clear(); save(LS.group, groupBy); render(); });

  upnextEl.addEventListener('click', () => {
    const m = allMovies().find((x) => x.qid === upnextEl.dataset.qid);
    if (m) openDetail(m);
  });

  sectionsEl.addEventListener('click', (e) => {
    const mark = e.target.closest('[data-markkey]');
    if (mark) {
      const key = mark.getAttribute('data-markkey');
      const g = buildGroups(sortMovies(filteredMovies())).find((x) => x.key === key);
      if (!g) return;
      const allW = g.movies.every((m) => watched.has(m.qid));
      g.movies.forEach((m) => { if (allW) watched.delete(m.qid); else watched.add(m.qid); });
      save(LS.watched, Array.from(watched));
      render();
      return;
    }
    const tog = e.target.closest('.section-toggle');
    if (tog) {
      const k = tog.getAttribute('data-key');
      if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k);
      render();
      return;
    }
    const act = e.target.closest('[data-act="toggle"]');
    if (act) {
      const qid = act.getAttribute('data-qid');
      if (watched.has(qid)) watched.delete(qid); else watched.add(qid);
      save(LS.watched, Array.from(watched));
      render();
      return;
    }
    const card = e.target.closest('.mcard');
    if (card) {
      const m = allMovies().find((x) => x.qid === card.getAttribute('data-qid'));
      if (m) openDetail(m);
    }
  });

  detailActions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dact="watch"]'); if (!b || !detail) return;
    if (watched.has(detail.qid)) watched.delete(detail.qid); else watched.add(detail.qid);
    save(LS.watched, Array.from(watched));
    renderDetailActions();
    render();
  });
  detailClose.addEventListener('click', closeDetail);
  detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !detailModal.hidden) closeDetail(); });

  function quit() {
    if (window.self !== window.top) { try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {} }
    else { location.href = '../../'; }
  }
  quitBtn.addEventListener('click', quit);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  render();
  loadData(false);

  (function hideLoading() {
    const loading2 = document.getElementById('app-loading');
    if (!loading2) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => { loading2.classList.add('hidden'); setTimeout(() => loading2.remove(), 500); }, remaining);
  })();
})();
