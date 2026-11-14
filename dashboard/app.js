// Token Radar's dashboard: a single static page (no network) that renders the snapshot the
// model's data.js hands it. State lives in the URL hash: #q, #category, #chain, #watchlist,
// #sort, #tab and #p (a selected slug), so a board, a filtered view and a detail view are each
// one plain link. Every number shown comes from the data: the page re-does the arithmetic only
// to prove the shown numbers agree with the model's own derivation.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) {
    document.querySelector('#board').innerHTML = '<p class="shell">This dashboard reads data.js, the dataset the model writes beside the page.</p>';
    return;
  }

  var BOARD_ROWS = DATA.rows;
  var LIVE_ROWS = DATA.live;
  var CALIBRATION = DATA.calibration || [];

  /* ---------- formatting ---------- */
  var NUM_FORMAT = new Intl.NumberFormat('en-US');
  function fmt(n) { return NUM_FORMAT.format(n); }
  function fmtUsd(n) { return '$' + fmt(n); }
  function fmtCompact(n) {
    if (n >= 1e9) return '$' + (+((n / 1e9).toFixed(2))) + 'B';
    if (n >= 1e6) return '$' + (+((n / 1e6).toFixed(1))) + 'M';
    if (n >= 1e3) return '$' + (+((n / 1e3).toFixed(1))) + 'K';
    return fmtUsd(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + (Math.round(n * 10) / 10) + '%';
  }
  function fmtAge(n) { return n === null || n === undefined ? '—' : fmt(n) + ' d'; }
  function fmtMult(m) { return m.toFixed(2) + '×'; }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- the shared arithmetic, re-done on the page so the numbers are checked ---------- */
  function recompute(row) {
    var growth = Math.min(120, Math.max(-60, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * 0.5;
    var age = row.age_days === null ? 365 : row.age_days;
    var maturity = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
    return {
      growth: growth,
      growthMult: growthMult,
      maturity: maturity,
      implied: Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity)),
    };
  }
  var mismatches = 0;
  BOARD_ROWS.forEach(function (r) { if (recompute(r).implied !== r.implied_value_usd) mismatches++; });

  /* ---------- state from the hash ---------- */
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var p = new URLSearchParams(h);
    return {
      q: (p.get('q') || '').trim(),
      category: p.get('category') || '',
      chain: p.get('chain') || '',
      watchlist: p.get('watchlist') === '1',
      sort: p.get('sort') || 'implied',
      tab: p.get('tab') || 'board',
      p: p.get('p') || '',
    };
  }
  function writeHash(state) {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.chain) p.set('chain', state.chain);
    if (state.watchlist) p.set('watchlist', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.p) p.set('p', state.p);
    var next = p.toString();
    history.replaceState(null, '', next ? '#' + next : location.pathname);
  }
  var state = readHash();

  /* ---------- derived lists ---------- */
  function categories() {
    var seen = {};
    var out = [];
    BOARD_ROWS.forEach(function (r) { if (r.category && !seen[r.category]) { seen[r.category] = 1; out.push(r.category); } });
    return out.sort();
  }
  function chains() {
    var seen = {};
    var out = [];
    BOARD_ROWS.forEach(function (r) { (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out.sort();
  }
  var topValue = BOARD_ROWS.length ? BOARD_ROWS[0].implied_value_usd : 1;

  function filteredRows() {
    var q = state.q.toLowerCase();
    return BOARD_ROWS.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlist && !r.watchlist) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  var SORTS = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    multiple: function (a, b) { return b.multiple - a.multiple; },
    name: function (a, b) { return a.name.localeCompare(b.name); },
  };

  function sortedRows(rows) { return rows.slice().sort(SORTS[state.sort] || SORTS.implied); }

  /* ---------- pieces of the page ---------- */
  function headerHtml() {
    return '<header class="top"><div class="brand"><span class="mark" aria-hidden="true">◆</span>' +
      '<span><span class="brand-name">Token Radar</span><span class="brand-sub">Pre-token protocols, ranked by launch value</span></span></div>' +
      '<div class="top-meta"><span class="pill">Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span class="pill">Model <b>' + esc(DATA.model_version) + '</b></span>' +
      '<span class="pill">Watchlist floor <b>' + fmtCompact(DATA.floor_usd) + '</b></span></div></header>';
  }

  function ledeHtml() {
    var totalTop = BOARD_ROWS.slice(0, 10).reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var watchCount = BOARD_ROWS.filter(function (r) { return r.watchlist; }).length;
    return '<section class="lede"><h1>The tokens that don&rsquo;t exist yet &mdash; <em>ranked by what a launch could be worth.</em></h1>' +
      '<p>Every protocol below holds real value locked and has no token, no CoinGecko listing and no symbol in the snapshot. ' +
      'The implied value is the snapshot&rsquo;s own market speaking: each category&rsquo;s multiple is the median market-cap-per-TVL ' +
      'of the live-token protocols in that same category, so a lending protocol is priced like lending, not like a bridge.</p>' +
      '<div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + watchCount + ' / ' + DATA.watchlist_size + '</b><small>every slug the house names</small></div>' +
      '<div class="fact"><span>Rows on the board</span><b>' + fmt(DATA.board_size) + '</b><small>' + fmt(DATA.early_size) + ' early radar rows beside the watchlist</small></div>' +
      '<div class="fact"><span>Top 10 implied</span><b>' + fmtCompact(totalTop) + '</b><small>summed, not cherry-picked</small></div>' +
      '<div class="fact"><span>Live comparables</span><b>' + fmt(DATA.calibration.reduce(function (s, c) { return s + c.comps; }, 0)) + '</b><small>protocols with a market cap on the tape</small></div>' +
      '</div></section>';
  }

  function controlsHtml() {
    var cats = categories();
    var chs = chains();
    var opts = function (list, current, label) {
      return '<option value="">' + label + '</option>' + list.map(function (c) {
        return '<option' + (c === current ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
    };
    return '<div class="controls" role="search">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, slug, category or chain" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category">' + opts(cats, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + opts(chs, state.chain, 'All chains') + '</select></div>' +
      '<div class="field"><label for="sort">Sort by</label><select id="sort">' +
      '<option value="implied"' + (state.sort === 'implied' ? ' selected' : '') + '>Implied value</option>' +
      '<option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>Locked value (TVL)</option>' +
      '<option value="growth"' + (state.sort === 'growth' ? ' selected' : '') + '>7-day change</option>' +
      '<option value="age"' + (state.sort === 'age' ? ' selected' : '') + '>Age, tokenless</option>' +
      '<option value="multiple"' + (state.sort === 'multiple' ? ' selected' : '') + '>Category multiple</option>' +
      '<option value="name"' + (state.sort === 'name' ? ' selected' : '') + '>Name A–Z</option>' +
      '</select></div>' +
      '<div class="field"><span class="sub">View</span><div class="tabs" role="group" aria-label="View">' +
      '<button type="button" data-tab="board" aria-pressed="' + (state.tab === 'board') + '">Board</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live comparables</button>' +
      '<button type="button" data-tab="method" aria-pressed="' + (state.tab === 'method') + '">Method</button></div></div>' +
      '<label class="check"><input type="checkbox" id="watchlist" ' + (state.watchlist ? 'checked' : '') + '> Watchlist only</label>' +
      '<span class="count" id="count"></span></div>';
  }

  function rowHtml(r) {
    var growth = r.change_7d === null ? '<span class="num">—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
    var bar = Math.max(1, Math.round((r.implied_value_usd / topValue) * 100));
    return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.p === r.slug) + '" tabindex="0">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ') || 'no chain listed') + '</span>' +
      (r.watchlist ? '<span class="tag watch">Watchlist</span>' : '') + '</td>' +
      '<td class="num">' + fmtCompact(r.tvl_usd) + '</td>' +
      '<td class="num">' + growth + '</td>' +
      '<td class="num" title="' + r.comps + ' live comparables' + (r.multiple_fallback ? ' — global median used' : '') + '">' + fmtMult(r.multiple) +
        '<span class="sub" style="color:var(--ink-faint);font-size:12px"> · ' + (r.multiple_fallback ? 'global' : r.comps + ' comps') + '</span></td>' +
      '<td class="num"><span class="implied"><span class="bar" aria-hidden="true"><i style="width:' + bar + '%"></i></span><b>' + fmtUsd(r.implied_value_usd) + '</b></span></td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '</tr>';
  }

  function boardHtml() {
    var rows = sortedRows(filteredRows());
    var body = rows.length ? rows.map(rowHtml).join('') :
      '<tr><td colspan="7"><div class="empty"><h2>Nothing matches those filters</h2><p>Loosen the search or clear the category and chain filters.</p>' +
      '<button class="button" id="reset">Show the whole board</button></div></td></tr>';
    return '<section class="panel" aria-label="Ranked board"><h2>The board</h2>' +
      '<p class="sub">Pre-token protocols, strongest implied value first. Click a row for its model derivation and farm plan.</p>' +
      '<div class="table-wrap"><table><caption>Columns: model rank, protocol, locked value, 7-day change, the multiple the model paid, the implied launch value, and how long it has run without a token.</caption>' +
      '<thead><tr><th class="num">#</th><th>Protocol</th><th class="num">TVL</th><th class="num">7-day</th><th class="num">Multiple</th><th class="num">Implied value</th><th class="num">Age</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></section>';
  }

  function liveHtml() {
    var rows = LIVE_ROWS.map(function (p) {
      return '<tr><td class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.category || 'uncategorised') + ' · ' + esc((p.chains || []).join(', ') || 'no chain listed') + '</span></td>' +
        '<td class="num">' + fmtCompact(p.tvl_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd === null ? '—' : fmtCompact(p.mcap_usd)) + '</td>' +
        '<td class="num">' + (p.ratio === null ? '—' : p.ratio.toFixed(3) + '×') + '</td>' +
        '<td class="num">' + fmtPct(p.change_7d) + '</td></tr>';
    }).join('');
    return '<section class="panel" aria-label="Live comparables"><h2>Live comparables</h2>' +
      '<p class="sub">The protocols that already trade, by market cap. Their market-cap-per-TVL is what the model calibrates on — this is the tape behind the multiples.</p>' +
      '<div class="table-wrap"><table><caption>The top ' + LIVE_ROWS.length + ' live-token protocols by market cap, with the ratio the calibration table is built from.</caption>' +
      '<thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">7-day</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></section>';
  }

  function methodHtml() {
    var cats = CALIBRATION.filter(function (c) {
      return BOARD_ROWS.some(function (r) { return r.category === c.category; });
    }).sort(function (a, b) { return b.multiple - a.multiple; });
    var calibRows = cats.map(function (c) {
      return '<tr class="' + (c.fallback ? 'fb' : '') + '"><td>' + esc(c.category) + '</td><td>' + c.comps + '</td><td>' +
        (c.median === null ? '—' : c.median.toFixed(4) + '×') + '</td><td>' + c.multiple.toFixed(4) + '×</td><td>' +
        (c.fallback ? 'global median' : 'category median') + '</td></tr>';
    }).join('');
    return '<section class="panel model" aria-label="How the ranking is built"><h2>How the ranking is built</h2>' +
      '<p class="sub">The model, in full, so any reader can check a number or re-run it.</p>' +
      '<div class="formula">implied = TVL × multiple(category) × growth(7-day, clamped −60%..+120%, half weight) × maturity(age, 0.6 → 1.0 over 3 years)</div>' +
      '<div class="method-cols"><div><h3>The calibration</h3>' +
      '<p>For each category, the multiple is the <b>median market-cap-per-TVL</b> of the live-token protocols in that same category in this snapshot. ' +
      'A category with fewer than three live comparables, or none at all, uses the global median instead — ' +
      'that stops one tiny protocol&rsquo;s token from setting a category&rsquo;s price, and it is why the snapshot&rsquo;s most extreme ratios (a single-token ' +
      'category at 400×) never reach the board.</p>' +
      '<p>The multiples are computed from the snapshot handed in, at run time, never from a list written into the model. ' +
      (mismatches === 0 ? 'This page re-did the arithmetic for every row and all ' + fmt(DATA.board_size) + ' implied values agree.' : mismatches + ' rows disagreed on re-check; the model&rsquo;s values are shown.') + '</p>' +
      '<h3>Who is on the board</h3><ul>' +
      '<li>Exactly the watchlist: every slug it names, in full. No watchlist row is ever dropped.</li>' +
      '<li>Every other pre-token protocol the house&rsquo;s own rule keeps: not a bridge, not liquid staking or restaking, not an exchange, not a versioned pool, and with no wrapped or staked word in its name — so a wrapped product of a token that already trades cannot sneak in.</li>' +
      '<li>Pre-token means all three are absent from the record: market cap, CoinGecko id and symbol.</li>' +
      '<li>Growth is clamped at −60% to +120% and counts at half weight; maturity runs 0.6 to 1.0 over three tokenless years, and an unknown age counts as 365 days.</li>' +
      '</ul></div>' +
      '<div><h3>Category multiples</h3><div class="table-wrap"><table class="calib"><caption>Categories on the board, highest multiple first. “Global median” rows fell back for too few comparables.</caption>' +
      '<thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median</th><th class="num">Used</th><th>Basis</th></tr></thead><tbody>' + calibRows + '</tbody></table></div>' +
      '<p class="footnote">Global median market-cap-per-TVL: <b>' + DATA.global_median.toFixed(4) + '×</b> across ' + fmt(DATA.calibration.reduce(function (s, c) { return s + c.comps; }, 0)) + ' live protocols with a market cap and a TVL.</p></div></div>' +
      '<p class="footnote" style="margin-top:14px">Limits, stated plainly: the snapshot is a single day&rsquo;s picture, so a protocol that airdropped before it or lists after it is scored on stale facts; ' +
      'TVL is a rough proxy for launch value and the multiple is a median, not a promise — a category&rsquo;s next launch can price far from its median. ' +
      'Nothing here is financial advice, and no farm step is a guarantee of an airdrop.</p></section>';
  }

  function detailHtml(r) {
    var v = recompute(r);
    var agree = v.implied === r.implied_value_usd;
    var ageNote = r.age_days === null ? 'listed without a date, counted as 365 days' : fmt(r.age_days) + ' days tokenless';
    var growthNote = r.change_7d === null ? 'no 7-day change recorded, counted as flat' : fmtPct(r.change_7d) + ' over 7 days';
    var steps = r.farm_steps.map(function (s) {
      var parts = s.split(' Cost: ');
      var text = parts[0] || s;
      var rest = parts[1] ? parts[1].split(' Time: ') : [];
      var cost = rest[0] || '';
      var time = rest[1] ? rest[1].replace(/\.$/, '') : '';
      return '<li><b>' + esc(text) + '</b><span class="cost">' + (cost ? 'Cost: ' + esc(cost) + ' · ' : '') + (time ? 'Time: ' + esc(time) : '') + '</span></li>';
    }).join('');
    return '<section class="detail" aria-label="Protocol detail" id="detail"><div class="detail-head"><div>' +
      '<span class="kicker">Rank ' + r.rank + ' · ' + esc(r.category || 'uncategorised') + (r.watchlist ? ' · watchlist' : '') + '</span>' +
      '<h2>' + esc(r.name) + '</h2><p>' + esc((r.chains || []).join(', ') || 'no chain listed') + ' · ' + ageNote + ' · ' + growthNote + '</p></div>' +
      '<button class="close" id="close-detail" type="button">Close ×</button></div>' +
      '<div class="detail-grid"><div class="detail-section"><h3>Why this implied value</h3>' +
      '<div class="equation">' +
      '<div><span>Locked value (TVL)</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
      '<div><span>Category multiple · ' + esc(r.category || 'uncategorised') + ' (' + (r.multiple_fallback ? 'global median, ' + r.comps + ' comps' : r.comps + ' live comps') + ')</span><b>' + fmtMult(r.multiple) + '</b></div>' +
      '<div><span>Growth · ' + fmtPct(v.growth) + ' clamped, half weight</span><b>' + v.growthMult.toFixed(4) + '×</b></div>' +
      '<div><span>Maturity · ' + ageNote + '</span><b>' + v.maturity.toFixed(4) + '×</b></div>' +
      '<div class="total"><span>Implied launch value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div></div>' +
      '<p class="checkline ' + (agree ? 'ok' : '') + '">' + (agree ? '✓ This page re-did the arithmetic and it agrees with the model exactly.' : 'The page&rsquo;s re-check disagreed with the model on this row; the model&rsquo;s value is shown.') + '</p>' +
      '<p class="checkline">Pre-token in the record: no market cap, no CoinGecko id, no symbol. Snapshot ' + esc(DATA.as_of) + ', source ' + esc(DATA.source) + '.</p>' +
      '</div><div class="detail-section"><h3>Farm plan · seven steps</h3><ol class="steps">' + steps + '</ol></div></div></section>';
  }

  function footerHtml() {
    return '<footer>Data: the sealed snapshot, <b>' + esc(DATA.as_of) + '</b>, from ' + esc(DATA.source) +
      ' (DefiLlama&rsquo;s protocol list, floor ' + fmtCompact(DATA.floor_usd) + '). Method: ' + esc(DATA.model_version) +
      ' — per-category median market-cap-per-TVL with a three-comparable minimum, clamped growth and maturity. ' +
      'Not financial advice; the implied values are a ranking, not a price target, and no farm step promises an airdrop.</footer>';
  }

  /* ---------- render ---------- */
  var root = document.querySelector('#board');
  function render(pushDetail) {
    var detail = state.p ? BOARD_ROWS.find(function (r) { return r.slug === state.p; }) : null;
    var count = state.tab === 'board' ? sortedRows(filteredRows()).length : null;
    var html = '<div class="shell">' + headerHtml() + ledeHtml() + controlsHtml() +
      (detail ? detailHtml(detail) : '') +
      (state.tab === 'board' ? boardHtml() : state.tab === 'live' ? liveHtml() : methodHtml()) +
      footerHtml() + '</div>';
    root.innerHTML = html;
    root.setAttribute('aria-busy', 'false');
    var countEl = document.getElementById('count');
    if (countEl && count !== null) countEl.textContent = 'Showing ' + fmt(count) + ' of ' + fmt(DATA.board_size) + ' rows';
    bind();
    if (pushDetail && detail) {
      var el = document.getElementById('detail');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value.trim(); state.p = ''; writeHash(state); render(false); var el = document.getElementById('q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
    ['category', 'chain', 'sort'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function () { state[id] = el.value; state.p = ''; writeHash(state); render(false); });
    });
    var wl = document.getElementById('watchlist');
    if (wl) wl.addEventListener('change', function () { state.watchlist = wl.checked; state.p = ''; writeHash(state); render(false); });
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { state.tab = btn.getAttribute('data-tab'); state.p = ''; writeHash(state); render(false); });
    });
    document.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      var pick = function () { state.p = tr.getAttribute('data-slug'); state.tab = 'board'; writeHash(state); render(true); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    var close = document.getElementById('close-detail');
    if (close) close.addEventListener('click', function () { state.p = ''; writeHash(state); render(false); });
    var reset = document.getElementById('reset');
    if (reset) reset.addEventListener('click', function () { state.q = ''; state.category = ''; state.chain = ''; state.watchlist = false; writeHash(state); render(false); });
  }

  window.addEventListener('hashchange', function () { state = readHash(); render(false); });

  // The detail panel sits in the flow below the controls, so a plain load shows it inside a
  // 1440x900 frame; a scroll-into-view is skipped here because a headless screenshot ignores
  // the scripted scroll position and the shot comes out with an empty top.
  render(false);
})();
