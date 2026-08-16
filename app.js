(function () {
  'use strict';

  // The ledger is read-only in the browser: all writes happen through
  // Claude Code sessions that update data/expenses/** + files/ and push;
  // data/expenses.json is the deploy-time aggregate of those files.
  const DATA_URL = 'data/expenses.json';
  const MIN_SPLASH_MS = 3000;
  const splashStart = performance.now();

  const $ = (id) => document.getElementById(id);

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- State ----
  let data = null;
  let categoriesById = {};
  // One project at a time; the header picker switches, remembered locally.
  const PROJECT_KEY = 'expenses-project';
  let currentProject = null;

  function visibleExpenses() {
    return data.expenses.filter((e) => e.project === currentProject);
  }

  // Expenses view: period scope + grouping + free-text search, cursors UTC.
  let scope = 'all'; // all | daily | weekly | monthly | annual
  let grouping = 'none'; // none | month | week
  let searchQuery = '';
  // Expenses whose only match for the current query is inside a
  // document's extracted text — flagged in the list so the hit makes sense.
  let textMatchIds = new Set();
  const today = new Date();
  const cursor = {
    day: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
    month: today.getUTCMonth(), // 0-based
    year: today.getUTCFullYear(),
  };

  // Reports view: one year at a time.
  let reportYear = today.getUTCFullYear();

  // ---- Currency ----
  // meta.fixedRates maps currency -> units per 1 EUR (MKD is pegged at 61.5).
  function toEUR(amount, currency) {
    if (currency === 'EUR') return amount;
    const rate = data.meta.fixedRates[currency];
    return rate ? amount / rate : null;
  }

  function fmtMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'MKD' ? 0 : 2,
        maximumFractionDigits: currency === 'MKD' ? 0 : 2,
      }).format(amount);
    } catch (_) {
      return amount.toLocaleString() + ' ' + currency;
    }
  }

  function fmtEURCompact(amount) {
    return '€' + new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(amount));
  }

  function sumUp(expenses) {
    const byCurrency = {};
    let eur = 0;
    let convertible = true;
    for (const e of expenses) {
      byCurrency[e.currency] = (byCurrency[e.currency] || 0) + e.amount;
      const v = toEUR(e.amount, e.currency);
      if (v === null) convertible = false;
      else eur += v;
    }
    return { byCurrency, eur: convertible ? eur : null };
  }

  function currencyOrder(byCurrency) {
    return Object.keys(byCurrency).sort((a, b) => {
      if (a === 'EUR') return -1;
      if (b === 'EUR') return 1;
      return a.localeCompare(b);
    });
  }

  function totalsHtml(sums) {
    const rows = currencyOrder(sums.byCurrency).map((cur) => `
      <div class="total-row">
        <span class="cur cur-${escapeHTML(cur.toLowerCase())}">${escapeHTML(cur)}</span>
        <span class="amt">${escapeHTML(fmtMoney(sums.byCurrency[cur], cur))}</span>
      </div>
    `);
    if (!rows.length) return '<div class="empty">No expenses in this period.</div>';
    const multi = Object.keys(sums.byCurrency).length > 1;
    if (multi && sums.eur !== null) {
      rows.push(`
        <div class="total-row equiv">
          <span class="cur">combined ≈</span>
          <span class="amt">${escapeHTML(fmtMoney(sums.eur, 'EUR'))}</span>
        </div>
      `);
    }
    return `<div class="totals">${rows.join('')}</div>`;
  }

  function sumsInlineHtml(sums) {
    const parts = currencyOrder(sums.byCurrency)
      .map((cur) => `<span class="sum">${escapeHTML(fmtMoney(sums.byCurrency[cur], cur))}</span>`);
    if (!parts.length) return '<span class="sum">—</span>';
    if (Object.keys(sums.byCurrency).length > 1 && sums.eur !== null) {
      parts.push(`<span class="sum-equiv">≈ ${escapeHTML(fmtMoney(sums.eur, 'EUR'))}</span>`);
    }
    return parts.join('');
  }

  // ---- Dates (stored ISO UTC, shown in the viewer's locale format) ----
  function dateOf(e) {
    return new Date(e.date + 'T00:00:00Z');
  }

  function fmtDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function fmtDayLong(d) {
    return d.toLocaleDateString(undefined, {
      timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function fmtUploaded(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setUTCDate(c.getUTCDate() + n);
    return c;
  }

  // ISO-8601 week: Monday-first, week 1 holds the year's first Thursday.
  function isoWeekOf(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (t.getUTCDay() + 6) % 7; // Mon = 0
    t.setUTCDate(t.getUTCDate() - day + 3); // shift to Thursday
    const year = t.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week = 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return { year, week };
  }

  function mondayOf(d) {
    const day = (d.getUTCDay() + 6) % 7;
    return addDays(d, -day);
  }

  function monthName(year, month) {
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
      timeZone: 'UTC', month: 'long',
    });
  }

  function monthShort(year, month) {
    return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
      timeZone: 'UTC', month: 'short',
    });
  }

  // ---- Expense rendering ----
  function fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function expenseHtml(e) {
    const cat = categoriesById[e.category];
    const icon = cat ? cat.icon : '🧾';
    const catName = cat ? cat.name : e.category;

    // Full record block: EUR equivalent, full date, category, then the
    // category's own detail fields.
    const recordRows = [];
    if (e.currency !== 'EUR') {
      const eur = toEUR(e.amount, e.currency);
      if (eur !== null) {
        recordRows.push(['EUR equivalent', `≈ ${fmtMoney(eur, 'EUR')} (at ${data.meta.fixedRates[e.currency]}/EUR)`]);
      }
    }
    recordRows.push(['Date', fmtDayLong(dateOf(e))]);
    recordRows.push(['Category', `${icon} ${catName}`]);
    if (e.allowDuplicate) recordRows.push(['Duplicate', 'Confirmed intentional duplicate']);
    if (cat && Array.isArray(cat.fields) && e.details) {
      for (const f of cat.fields) {
        if (e.details[f.key] !== undefined && e.details[f.key] !== '') {
          recordRows.push([f.label, e.details[f.key]]);
        }
      }
    }
    const fields = `<dl class="exp-fields">${recordRows
      .map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join('')}</dl>`;

    let files = '';
    if (Array.isArray(e.attachments) && e.attachments.length) {
      // Stored under a GUID; label + download name are the original
      // filename. Tapping the name previews, the arrow downloads, and
      // "See details" opens the transcribed document text.
      files = `<div class="exp-files">${e.attachments.map((a, i) => `
        <div class="exp-file-row" data-exp="${escapeHTML(e.id)}" data-idx="${i}">
          <div class="exp-file-main">
            <a class="exp-file" href="${escapeHTML(a.file)}">
              <span aria-hidden="true">📎</span>
              <span class="fname">${escapeHTML(a.originalName)}</span>
            </a>
            <div class="exp-file-sub">
              ${escapeHTML([a.mime || '', fmtSize(a.size), a.uploaded ? 'uploaded ' + fmtUploaded(a.uploaded) : ''].filter(Boolean).join(' · '))}
              ${a.extractedText ? '<button type="button" class="exp-text-btn">See details</button>' : ''}
            </div>
          </div>
          <a class="exp-dl" href="${escapeHTML(a.file)}" download="${escapeHTML(a.originalName)}"
             aria-label="Download ${escapeHTML(a.originalName)}">⬇</a>
        </div>
      `).join('')}</div>`;
    }

    return `
      <div class="exp" data-id="${escapeHTML(e.id)}">
        <div class="exp-head">
          <span class="exp-icon" aria-hidden="true">${escapeHTML(icon)}</span>
          <div class="exp-main">
            <div class="exp-vendor">${escapeHTML(e.vendor)}</div>
            <div class="exp-sub">${escapeHTML(catName)}${e.description ? ' · ' + escapeHTML(e.description) : ''}</div>
            ${textMatchIds.has(e.id) ? '<div class="exp-hit">📎 matches document text</div>' : ''}
          </div>
          <div class="exp-right">
            <div class="exp-amt">${escapeHTML(fmtMoney(e.amount, e.currency))}</div>
            <div class="exp-date">${escapeHTML(fmtDate(e.date))}</div>
          </div>
        </div>
        <div class="exp-detail">
          ${e.description ? `<p class="exp-desc">${escapeHTML(e.description)}</p>` : ''}
          ${fields}
          ${files}
          <div class="exp-id">${escapeHTML(e.id)}</div>
        </div>
      </div>
    `;
  }

  function expenseListHtml(expenses) {
    if (!expenses.length) return '<div class="empty">No expenses in this period.</div>';
    return `<div class="expense-list">${expenses.map(expenseHtml).join('')}</div>`;
  }

  function newestFirst(expenses) {
    return expenses.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // ---- Overview: gradient hero + category pills + recent ----
  function renderOverview() {
    const sums = sumUp(visibleExpenses());
    $('hero-total').textContent = sums.eur !== null ? fmtMoney(sums.eur, 'EUR') : '—';
    $('hero-sub').textContent = currencyOrder(sums.byCurrency)
      .map((c) => fmtMoney(sums.byCurrency[c], c)).join('  ·  ');

    const now = new Date();
    const mKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthSums = sumUp(visibleExpenses().filter((e) => e.date.startsWith(mKey)));
    $('hero-month').textContent = monthSums.eur ? `≈ ${fmtEURCompact(monthSums.eur)}` : '€0';
    $('hero-count').textContent = String(visibleExpenses().length);

    const cats = data.categories.map((c) => {
      const items = visibleExpenses().filter((e) => e.category === c.id);
      return { cat: c, items };
    }).filter((x) => x.items.length);
    cats.sort((a, b) => (sumUp(b.items).eur || 0) - (sumUp(a.items).eur || 0));

    $('category-breakdown').innerHTML = cats.length ? cats.map(({ cat, items }) => `
      <div class="cat-pill">
        <span class="cat-pill-icon" aria-hidden="true">${escapeHTML(cat.icon)}</span>
        <div>
          <div class="cat-pill-name">${escapeHTML(cat.name)} · ${items.length}</div>
          <div class="cat-pill-amt">≈ ${escapeHTML(fmtEURCompact(sumUp(items).eur || 0))}</div>
        </div>
      </div>
    `).join('') : '<div class="empty">Nothing yet.</div>';

    $('recent-list').innerHTML = expenseListHtml(newestFirst(visibleExpenses()).slice(0, 5));
  }

  // ---- Expenses view: period scope, skip-empty navigation, grouping ----
  function scopeRange() {
    switch (scope) {
      case 'daily': {
        const from = isoDate(cursor.day);
        return { from, to: isoDate(addDays(cursor.day, 1)), label: fmtDayLong(cursor.day) };
      }
      case 'weekly': {
        const mon = mondayOf(cursor.day);
        const { year, week } = isoWeekOf(mon);
        return {
          from: isoDate(mon),
          to: isoDate(addDays(mon, 7)),
          label: `W${week} ${year} · ${fmtDate(isoDate(mon))} – ${fmtDate(isoDate(addDays(mon, 6)))}`,
        };
      }
      case 'monthly': {
        const from = new Date(Date.UTC(cursor.year, cursor.month, 1));
        const to = new Date(Date.UTC(cursor.year, cursor.month + 1, 1));
        return { from: isoDate(from), to: isoDate(to), label: `${monthName(cursor.year, cursor.month)} ${cursor.year}` };
      }
      case 'annual':
        return { from: `${cursor.year}-01-01`, to: `${cursor.year + 1}-01-01`, label: String(cursor.year) };
      default:
        return null; // all
    }
  }

  // Empty periods are skipped: prev/next jump to the nearest period
  // that actually has expenses.
  function currentPeriodKey() {
    switch (scope) {
      case 'daily': return isoDate(cursor.day);
      case 'weekly': return isoDate(mondayOf(cursor.day));
      case 'monthly': return `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
      default: return String(cursor.year);
    }
  }

  function periodKeysWithData() {
    const keys = new Set();
    for (const e of visibleExpenses()) {
      switch (scope) {
        case 'daily': keys.add(e.date); break;
        case 'weekly': keys.add(isoDate(mondayOf(dateOf(e)))); break;
        case 'monthly': keys.add(e.date.slice(0, 7)); break;
        default: keys.add(e.date.slice(0, 4));
      }
    }
    return Array.from(keys).sort();
  }

  function neighborPeriodKey(dir) {
    const keys = periodKeysWithData();
    const cur = currentPeriodKey();
    if (dir > 0) return keys.find((k) => k > cur) || null;
    let prev = null;
    for (const k of keys) { if (k < cur) prev = k; else break; }
    return prev;
  }

  function movePeriod(dir) {
    const key = neighborPeriodKey(dir);
    if (!key) return;
    switch (scope) {
      case 'daily':
      case 'weekly':
        cursor.day = new Date(key + 'T00:00:00Z');
        break;
      case 'monthly':
        cursor.year = Number(key.slice(0, 4));
        cursor.month = Number(key.slice(5, 7)) - 1;
        break;
      default:
        cursor.year = Number(key);
    }
    renderExpensesView();
  }

  function groupRowsHtml(buckets) {
    // buckets: [{ name, expenses }] — independent accordions, several
    // can stay open at once; empty buckets are never rendered.
    if (!buckets.length) return '<div class="empty">No expenses in this period.</div>';
    return `<div class="period-rows">${buckets.map((b) => `
      <div class="p-group">
        <button type="button" class="period-row" aria-expanded="false">
          <span class="p-chev" aria-hidden="true">▸</span>
          <span class="p-name">${escapeHTML(b.name)}</span>
          <span class="p-count">${b.expenses.length} exp.</span>
          <span class="p-sums">${sumsInlineHtml(sumUp(b.expenses))}</span>
        </button>
        <div class="p-panel">${expenseListHtml(newestFirst(b.expenses))}</div>
      </div>
    `).join('')}</div>`;
  }

  // ---- Search transliteration fold ----
  // Query and indexed text both collapse to one canonical Latin form,
  // so Latin input finds Cyrillic text and vice versa: 'beton' → «Бетон»,
  // 'xhevat' or 'dzevat' → «ЏЕВАТ», 'klinicki' → «КЛИНИЧКИ».
  // To support another language or spelling convention later, just add
  // rows to CYR_MAP (character → canonical) and/or FOLD_DIGRAPHS
  // (multi-letter spelling → canonical) — nothing else changes.
  const CYR_MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'z', з: 'z',
    ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n',
    њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's', ђ: 'd', ћ: 'c', й: 'j',
    ы: 'y', э: 'e', ю: 'ju', я: 'ja', щ: 'st', ъ: '', ь: '',
  };
  const FOLD_DIGRAPHS = [
    // Macedonian romanizations
    ['zh', 'z'], ['ch', 'c'], ['sh', 's'], ['gj', 'g'], ['kj', 'k'], ['dz', 'dz'],
    // Albanian conventions
    ['xh', 'dz'], ['ll', 'l'], ['rr', 'r'], ['q', 'k'],
  ];

  function foldSearch(s) {
    // NFD + strip accents handles diacritics generically (ë, ç, š, ž…)
    // and also decomposes ѓ→г, ќ→к before the Cyrillic map runs.
    let t = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/[Ѐ-ӿ]/g, (ch) => (CYR_MAP[ch] !== undefined ? CYR_MAP[ch] : ch));
    for (const [from, to] of FOLD_DIGRAPHS) t = t.split(from).join(to);
    return t;
  }

  // Free-text search across everything we know about an expense,
  // including the verbatim document text of its attachments. Every
  // whitespace-separated term must match somewhere.
  function searchHaystacks(e) {
    const cat = categoriesById[e.category];
    const core = foldSearch([
      e.vendor, e.description, cat ? cat.name : e.category,
      e.date, String(e.amount), e.currency,
      ...Object.values(e.details || {}),
      ...(e.attachments || []).map((a) => a.originalName),
    ].join('\n'));
    const docs = foldSearch((e.attachments || []).map((a) => a.extractedText || '').join('\n'));
    return { core, docs };
  }

  function applySearch(expenses) {
    textMatchIds = new Set();
    const terms = foldSearch(searchQuery).split(/\s+/).filter(Boolean);
    if (!terms.length) return expenses;
    return expenses.filter((e) => {
      const { core, docs } = searchHaystacks(e);
      let docOnly = false;
      for (const t of terms) {
        const inCore = core.includes(t);
        if (!inCore && !docs.includes(t)) return false;
        if (!inCore) docOnly = true;
      }
      if (docOnly) textMatchIds.add(e.id);
      return true;
    });
  }

  function renderExpensesView() {
    const range = scopeRange();
    const nav = $('exp-period-nav');
    nav.hidden = !range;
    if (range) {
      $('period-label').textContent = range.label;
      $('period-prev').disabled = neighborPeriodKey(-1) === null;
      $('period-next').disabled = neighborPeriodKey(1) === null;
    }

    const filtered = applySearch(range
      ? visibleExpenses().filter((e) => e.date >= range.from && e.date < range.to)
      : visibleExpenses());

    const sums = sumUp(filtered);
    $('exp-totals').innerHTML = `
      <div class="totals-head">${filtered.length} expense${filtered.length === 1 ? '' : 's'}</div>
      ${totalsHtml(sums)}
    `;

    const box = $('expense-list');
    if (grouping === 'none') {
      box.innerHTML = expenseListHtml(newestFirst(filtered));
      return;
    }

    // Bundle into month / ISO-week buckets, newest bucket first.
    const buckets = new Map();
    for (const e of filtered) {
      let key;
      let name;
      if (grouping === 'month') {
        key = e.date.slice(0, 7);
        const [y, m] = key.split('-');
        name = `${monthName(Number(y), Number(m) - 1)} ${y}`;
      } else {
        const { year, week } = isoWeekOf(dateOf(e));
        key = `${year}-W${String(week).padStart(2, '0')}`;
        name = `W${week} ${year}`;
      }
      if (!buckets.has(key)) buckets.set(key, { name, expenses: [] });
      buckets.get(key).expenses.push(e);
    }
    const ordered = Array.from(buckets.keys()).sort().reverse()
      .map((k) => buckets.get(k));
    box.innerHTML = groupRowsHtml(ordered);
  }

  // ---- Reports: aggregations & charts ----
  const VIZ_EUR = 'var(--viz-1)';
  const VIZ_MKD = 'var(--viz-2)';

  function yearsWithData() {
    return Array.from(new Set(visibleExpenses().map((e) => e.date.slice(0, 4)))).sort();
  }

  function eurEquiv(e) {
    const v = toEUR(e.amount, e.currency);
    return v === null ? 0 : v;
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) {
      if (m * pow >= v) return m * pow;
    }
    return 10 * pow;
  }

  function kpiTile(label, value, sub) {
    return `
      <div class="kpi">
        <div class="kpi-label">${escapeHTML(label)}</div>
        <div class="kpi-value">${escapeHTML(value)}</div>
        ${sub ? `<div class="kpi-sub">${escapeHTML(sub)}</div>` : ''}
      </div>
    `;
  }

  // Vertical column chart: 12 months, stacked by currency (EUR-equivalent
  // heights). SVG with a fixed viewBox; scales to the card width.
  function monthlyChartSvg(yearExpenses, year, width) {
    const perMonth = Array.from({ length: 12 }, () => ({ EUR: 0, MKD: 0 }));
    for (const e of yearExpenses) {
      const m = Number(e.date.slice(5, 7)) - 1;
      const bucket = e.currency === 'EUR' ? 'EUR' : 'MKD';
      perMonth[m][bucket] += eurEquiv(e);
    }
    const maxTotal = Math.max(...perMonth.map((m) => m.EUR + m.MKD));
    if (maxTotal <= 0) return '<div class="empty">No expenses this year.</div>';
    const yMax = niceCeil(maxTotal);

    // Drawn at the container's real pixel width so tick text renders at
    // its CSS size instead of scaling down with a fixed viewBox.
    const W = Math.max(300, width || 680);
    const H = 250;
    const M = { top: 10, right: 6, bottom: 26, left: 52 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const slotW = plotW / 12;
    const barW = Math.min(24, slotW * 0.55);
    const y = (v) => M.top + plotH - (v / yMax) * plotH;

    let svg = '';
    // Hairline gridlines at 0, ½, 1 of the scale + tick labels.
    for (const frac of [0, 0.5, 1]) {
      const gy = y(yMax * frac);
      svg += `<line x1="${M.left}" y1="${gy}" x2="${W - M.right}" y2="${gy}" class="viz-grid"/>`;
      svg += `<text x="${M.left - 8}" y="${gy + 4}" class="viz-tick" text-anchor="end">${fmtEURCompact(yMax * frac)}</text>`;
    }

    perMonth.forEach((m, i) => {
      const cx = M.left + slotW * i + slotW / 2;
      const x = cx - barW / 2;
      const total = m.EUR + m.MKD;
      // EUR sits on the baseline, MKD stacks above with a 2px surface gap;
      // only the topmost segment gets the 4px rounded data-end.
      if (total > 0) {
        const hEUR = (m.EUR / yMax) * plotH;
        const hMKD = (m.MKD / yMax) * plotH;
        const gap = m.EUR > 0 && m.MKD > 0 ? 2 : 0;
        const baseY = M.top + plotH;
        if (m.EUR > 0) {
          const topSeg = m.MKD <= 0;
          svg += barRect(x, baseY - hEUR, barW, hEUR, topSeg ? 4 : 0, VIZ_EUR);
        }
        if (m.MKD > 0) {
          svg += barRect(x, baseY - hEUR - gap - hMKD, barW, hMKD, 4, VIZ_MKD);
        }
      }
      // Month letter + invisible full-height hover target.
      svg += `<text x="${cx}" y="${H - 8}" class="viz-tick" text-anchor="middle">${monthShort(year, i).slice(0, 1)}</text>`;
      const tip = `${monthName(year, i)} ${year} — ${total > 0
        ? `≈ ${fmtEURCompact(total)}${m.EUR > 0 ? ` · EUR ${fmtEURCompact(m.EUR)}` : ''}${m.MKD > 0 ? ` · MKD ≈ ${fmtEURCompact(m.MKD)}` : ''}`
        : 'no expenses'}`;
      svg += `<rect x="${M.left + slotW * i}" y="${M.top}" width="${slotW}" height="${plotH + M.bottom}" fill="transparent" data-tip="${escapeHTML(tip)}"/>`;
    });

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spend, EUR equivalent">${svg}</svg>`;
  }

  // Column with a rounded top (data end) and square baseline.
  function barRect(x, yTop, w, h, r, fill) {
    if (h <= 0) return '';
    const rr = Math.min(r, h, w / 2);
    if (rr <= 0) {
      return `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${fill}"/>`;
    }
    return `<path d="M${x},${yTop + h} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} L${x + w - rr},${yTop} Q${x + w},${yTop} ${x + w},${yTop + rr} L${x + w},${yTop + h} Z" fill="${fill}"/>`;
  }

  // Horizontal bars in HTML: one series (magnitude), single hue, value
  // at the bar tip. Mobile-friendly by construction.
  function categoryChartHtml(yearExpenses) {
    const byCat = new Map();
    for (const e of yearExpenses) {
      byCat.set(e.category, (byCat.get(e.category) || 0) + eurEquiv(e));
    }
    if (!byCat.size) return '<div class="empty">No expenses this year.</div>';
    const rows = Array.from(byCat.entries())
      .map(([id, v]) => ({ cat: categoriesById[id], v }))
      .sort((a, b) => b.v - a.v);
    const max = rows[0].v;
    return `<div class="hbars">${rows.map(({ cat, v }) => `
      <div class="hbar" data-tip="${escapeHTML(`${cat ? cat.name : '?'} — ≈ ${fmtEURCompact(v)}`)}">
        <div class="hbar-label">${escapeHTML(cat ? `${cat.icon} ${cat.name}` : '?')}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1.5, (v / max) * 100)}%"></div></div>
        <div class="hbar-value">${escapeHTML(fmtEURCompact(v))}</div>
      </div>
    `).join('')}</div>`;
  }

  // Part-to-whole: one stacked horizontal bar, two segments + legend.
  function currencyChartHtml(yearExpenses) {
    const sums = sumUp(yearExpenses);
    const eurPart = sums.byCurrency.EUR || 0;
    let mkdPart = 0;
    for (const [cur, amt] of Object.entries(sums.byCurrency)) {
      if (cur !== 'EUR') mkdPart += toEUR(amt, cur) || 0;
    }
    const total = eurPart + mkdPart;
    if (total <= 0) return '<div class="empty">No expenses this year.</div>';
    const pctEUR = (eurPart / total) * 100;
    return `
      <div class="split-bar" role="img" aria-label="Share of spend by invoice currency">
        ${eurPart > 0 ? `<div class="split-seg" style="width:${pctEUR}%;background:${VIZ_EUR}" data-tip="${escapeHTML(`EUR invoices — ${fmtMoney(eurPart, 'EUR')} · ${Math.round(pctEUR)}%`)}"></div>` : ''}
        ${mkdPart > 0 ? `<div class="split-seg" style="width:${100 - pctEUR}%;background:${VIZ_MKD}" data-tip="${escapeHTML(`MKD invoices — ${fmtMoney(sums.byCurrency.MKD || 0, 'MKD')} ≈ ${fmtEURCompact(mkdPart)} · ${Math.round(100 - pctEUR)}%`)}"></div>` : ''}
      </div>
      <div class="viz-legend">
        <span class="legend-item"><span class="legend-swatch" style="background:${VIZ_EUR}"></span>EUR invoices · ${escapeHTML(fmtMoney(eurPart, 'EUR'))} (${Math.round(pctEUR)}%)</span>
        <span class="legend-item"><span class="legend-swatch" style="background:${VIZ_MKD}"></span>MKD invoices · ${escapeHTML(fmtMoney(sums.byCurrency.MKD || 0, 'MKD'))} (${Math.round(100 - pctEUR)}%)</span>
      </div>
    `;
  }

  function renderReports() {
    const years = yearsWithData();
    const yr = String(reportYear);
    $('year-label').textContent = yr;
    $('year-prev').disabled = !years.some((y) => y < yr);
    $('year-next').disabled = !years.some((y) => y > yr);

    const yearExpenses = visibleExpenses().filter((e) => e.date.startsWith(yr + '-'));

    // KPI row.
    const sums = sumUp(yearExpenses);
    const monthsWithData = new Set(yearExpenses.map((e) => e.date.slice(0, 7))).size;
    let largest = null;
    for (const e of yearExpenses) {
      if (!largest || eurEquiv(e) > eurEquiv(largest)) largest = e;
    }
    const largestValue = largest
      ? (largest.currency === 'EUR' ? fmtEURCompact(largest.amount) : fmtMoney(largest.amount, largest.currency))
      : '—';
    $('kpis').innerHTML = yearExpenses.length ? [
      kpiTile('Total spent', sums.eur !== null ? fmtEURCompact(sums.eur) : '—', `≈ EUR equivalent, ${yr}`),
      kpiTile('Expenses', String(yearExpenses.length), `across ${monthsWithData} month${monthsWithData === 1 ? '' : 's'}`),
      kpiTile('Monthly average', sums.eur !== null && monthsWithData ? fmtEURCompact(sums.eur / monthsWithData) : '—', '≈ per active month'),
      kpiTile('Largest expense', largestValue, largest ? largest.vendor : ''),
    ].join('') : '<div class="empty">No expenses this year.</div>';

    // Charts.
    $('chart-monthly').innerHTML = monthlyChartSvg(yearExpenses, reportYear, $('chart-monthly').clientWidth);
    $('legend-monthly').innerHTML = yearExpenses.length ? `
      <span class="legend-item"><span class="legend-swatch" style="background:${VIZ_EUR}"></span>EUR invoices</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${VIZ_MKD}"></span>MKD invoices (converted)</span>
    ` : '';
    $('chart-category').innerHTML = categoryChartHtml(yearExpenses);
    $('chart-currency').innerHTML = currencyChartHtml(yearExpenses);
  }

  function moveYear(dir) {
    const years = yearsWithData();
    const yr = String(reportYear);
    const target = dir > 0
      ? years.find((y) => y > yr)
      : years.filter((y) => y < yr).pop();
    if (!target) return;
    reportYear = Number(target);
    renderReports();
  }

  // ---- Chart tooltip (hover + tap on [data-tip]) ----
  const tip = $('viz-tip');

  function showTip(target, clientX, clientY) {
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const pad = 12;
    const r = tip.getBoundingClientRect();
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t, e.clientX, e.clientY);
  });

  // ---- Wiring ----
  function setView(view) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === 'view-' + view);
    });
  }

  $('bottom-nav').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    setView(tab.dataset.view);
    // The monthly chart is sized to its container, which is 0 while the
    // reports view is hidden — redraw once it's actually visible.
    if (tab.dataset.view === 'reports' && data) renderReports();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (data && document.querySelector('#view-reports.active')) renderReports();
    }, 150);
  });

  $('scope-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    scope = btn.dataset.scope;
    $('scope-pills').querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b === btn));
    renderExpensesView();
  });

  $('group-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    grouping = btn.dataset.group;
    $('group-pills').querySelectorAll('.pill').forEach((b) => b.classList.toggle('active', b === btn));
    renderExpensesView();
  });

  let searchTimer = 0;
  $('exp-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      renderExpensesView();
    }, 150);
  });

  $('period-prev').addEventListener('click', () => movePeriod(-1));
  $('period-next').addEventListener('click', () => movePeriod(1));
  $('year-prev').addEventListener('click', () => moveYear(-1));
  $('year-next').addEventListener('click', () => moveYear(1));

  // Month/week bundles toggle their accordion; several can stay open.
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.period-row');
    if (!row) return;
    const open = row.parentElement.classList.toggle('open');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Expand / collapse expense rows (skip clicks on attachment rows).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.exp-file-row')) return;
    const head = e.target.closest('.exp-head');
    if (head) head.parentElement.classList.toggle('open');
  });

  // ---- Attachment preview / document-text lightbox ----
  const lightbox = $('lightbox');
  let lbAtt = null;

  function findAttachment(expId, idx) {
    const exp = data.expenses.find((x) => x.id === expId);
    return exp && Array.isArray(exp.attachments) ? exp.attachments[Number(idx)] || null : null;
  }

  function previewKind(mime, file) {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf') return 'pdf';
    const ext = (file.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].indexOf(ext) !== -1) return 'image';
    if (ext === 'pdf') return 'pdf';
    return null;
  }

  function lightboxBody(att, mode) {
    if (mode === 'text') {
      return `<pre class="lb-text">${escapeHTML(att.extractedText || '')}</pre>`;
    }
    const kind = previewKind(att.mime, att.file);
    if (kind === 'image') return `<img src="${escapeHTML(att.file)}" alt="${escapeHTML(att.originalName)}">`;
    if (kind === 'pdf') return `<iframe src="${escapeHTML(att.file)}" title="${escapeHTML(att.originalName)}"></iframe>`;
    return '<div class="lb-fallback">No inline preview for this file type — use Download.</div>';
  }

  function openLightbox(att, mode) {
    if (!att) return;
    lbAtt = att;
    if (mode === 'text' && !att.extractedText) mode = 'preview';
    $('lb-name').textContent = att.originalName;
    const dl = $('lb-download');
    dl.href = att.file;
    dl.setAttribute('download', att.originalName);
    const toggles = $('lb-toggles');
    toggles.hidden = !att.extractedText;
    toggles.querySelectorAll('.lb-toggle').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    $('lb-body').innerHTML = lightboxBody(att, mode);
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbAtt = null;
    $('lb-body').innerHTML = '';
    document.body.style.overflow = '';
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest('.exp-file-row');
    if (!row) return;
    const att = findAttachment(row.dataset.exp, row.dataset.idx);
    if (e.target.closest('.exp-text-btn')) {
      openLightbox(att, 'text');
      return;
    }
    const preview = e.target.closest('.exp-file');
    if (preview) {
      e.preventDefault();
      openLightbox(att, 'preview');
    }
  });

  $('lb-toggles').addEventListener('click', (e) => {
    const btn = e.target.closest('.lb-toggle');
    if (btn && lbAtt) openLightbox(lbAtt, btn.dataset.mode);
  });

  $('lb-close').addEventListener('click', closeLightbox);
  lightbox.querySelector('.lb-backdrop').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  // ---- Project picker ----
  const picker = $('picker');

  function projectOf(id) {
    return data.projects.find((p) => p.id === id);
  }

  // Re-render everything against the current project.
  function applyProject() {
    const proj = projectOf(currentProject);
    $('project-name').textContent = proj ? proj.name : 'Expenses';

    // Snap the reports year to the newest year that has data here.
    const years = yearsWithData();
    if (years.length && !years.includes(String(reportYear))) {
      reportYear = Number(years[years.length - 1]);
    }

    $('foot-note').textContent =
      `${visibleExpenses().length} expenses in this project · updated via Claude Code sessions · MKD pegged at ${data.meta.fixedRates.MKD} per EUR`;

    renderOverview();
    renderExpensesView();
    renderReports();
  }

  function openPicker() {
    $('picker-list').innerHTML = data.projects.map((p) => {
      const count = data.expenses.filter((e) => e.project === p.id).length;
      const active = p.id === currentProject;
      return `
        <button type="button" class="picker-item${active ? ' active' : ''}" data-project="${escapeHTML(p.id)}">
          <span class="picker-item-icon" aria-hidden="true">${escapeHTML(p.icon || '📁')}</span>
          <span class="picker-item-body">
            <span class="picker-item-name">${escapeHTML(p.name)}</span>
            <span class="picker-item-meta">${count} expense${count === 1 ? '' : 's'}</span>
          </span>
          ${active ? '<span class="picker-item-check" aria-hidden="true">✓</span>' : ''}
        </button>
      `;
    }).join('');
    picker.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closePicker() {
    picker.hidden = true;
    document.body.style.overflow = '';
  }

  $('hdr-project-btn').addEventListener('click', openPicker);
  picker.querySelector('.picker-backdrop').addEventListener('click', closePicker);

  $('picker-list').addEventListener('click', (e) => {
    const item = e.target.closest('.picker-item');
    if (!item) return;
    closePicker();
    if (item.dataset.project === currentProject) return;
    currentProject = item.dataset.project;
    try { localStorage.setItem(PROJECT_KEY, currentProject); } catch (_) {}
    applyProject();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !picker.hidden) closePicker();
  });

  function hideSplash() {
    const wait = Math.max(0, MIN_SPLASH_MS - (performance.now() - splashStart));
    setTimeout(() => {
      const splash = $('app-loading');
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 500);
    }, wait);
  }

  async function load() {
    try {
      // Unique query per load: GitHub Pages' CDN caches by full URL for
      // ~10 minutes, so without this a freshly merged expense can take
      // that long to appear even though cache:'no-store' skips the
      // browser cache.
      const res = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      categoriesById = {};
      for (const c of data.categories) categoriesById[c.id] = c;

      // Restore the remembered project, falling back to the first one.
      let saved = null;
      try { saved = localStorage.getItem(PROJECT_KEY); } catch (_) {}
      currentProject = data.projects.some((p) => p.id === saved)
        ? saved
        : data.projects[0].id;

      applyProject();
    } catch (err) {
      const banner = $('banner');
      banner.hidden = false;
      banner.textContent = 'Could not load the ledger (' + err.message + ').';
    }
    hideSplash();
  }

  load();
})();
