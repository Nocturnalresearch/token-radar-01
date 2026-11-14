# Token Radar

The tokens that don't exist yet — ranked by what a launch could be worth.

This entry reads the sealed DefiLlama snapshot (758 protocols, 2026-11-14), finds the ones that
still have no token and are not a wrapped, staked or bridged product of a token that already
trades, and ranks them by an implied launch value calibrated from the snapshot's own live-token
comparables. The deliverable is the dashboard: a sortable, filterable board, a detail view per
protocol with the full model derivation and a seven-step farm plan, a live-comparables tab, and
the method in full.

## Run it

```sh
# from this directory; /input holds snapshot.json, or pass --input <file|dir>
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, copies `dashboard/`
and `screenshots/` to the output directory, and writes `dossier.json` with the vendored
`vendor/makefun-board.ts`. Run it twice and the bytes are identical: the model is a pure
function of the snapshot. The three files at this root (`board.json`, `data.js`, `dossier.json`)
are the current outputs, for preview and inspection.

## The model (radar-2)

```
implied = TVL × multiple(category) × growth(7-day, clamped −60%..+120%, half weight)
               × maturity(age, 0.6 → 1.0 over 3 tokenless years)
```

- **The multiple is the snapshot's own market:** for each category, the median market-cap-per-TVL
  of the live-token protocols in that same category. A category with fewer than three live
  comparables, or none at all, uses the global median (0.2138× across 128 priced live
  protocols). No protocol name is ever special-cased, and the multiples are computed at run
  time from the snapshot handed in.
- **The board is the whole watchlist plus the whole early radar:** all 40 watchlist slugs, and
  every other rankable pre-token protocol below the $50M floor — 138 of them, 178 rows total.
  The exclusion rule is the house's own: no bridge, liquid staking or restaking, no exchange,
  no versioned pool, no wrapped/staked word in the name.
- **Farm plans** are seven steps derived from each protocol's own record (category family,
  TVL tier, age, chains), each with a cost and a time.

The dashboard re-does the arithmetic for every row and all 178 implied values agree; the
method tab prints the calibration table so any reader can check a number.

## The dashboard

Open `dashboard/index.html` with `data.js` beside it (both are at this root after a run). State
lives in the URL hash, so each view is one link:

- board: `dashboard/index.html`
- detail: `dashboard/index.html#p=steakhouse-financial`
- filtered: `dashboard/index.html#category=Risk%20Curators`
- live comparables: `dashboard/index.html#tab=live`
- method: `dashboard/index.html#tab=method`

## Screenshots

Taken at 1440×900 with headless Chrome against the built dashboard. To retake, build the
output directory first, then:

```sh
BASE="file://$PWD/out/dashboard/index.html"
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=6000 \
  --screenshot=screenshots/1-board.png "$BASE"
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=6000 \
  --screenshot=screenshots/2-detail.png "$BASE#p=steakhouse-financial"
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=6000 \
  --screenshot=screenshots/3-filtered.png "$BASE#category=Risk%20Curators"
```

Note: a headless `--screenshot` ignores a scripted scroll position, so the detail shot relies
on the detail panel sitting in the flow below the controls — it does, and it is visible inside
the 900px frame. Rebuild the output directory and re-copy `board.json`, `data.js` and
`dossier.json` to this root after retaking them.

## Layout

- `main.ts` — entrypoint: read snapshot → score → write board, data, dashboard, screenshots, dossier
- `lib/model.ts` — the model: calibration, ranking, farm plans, snapshot parsing, board checks
- `vendor/makefun-board.ts` — the kit's dossier library, copied as instructed
- `dashboard/` — `index.html`, `app.css`, `app.js` (static, no network)
- `screenshots/` — the three submission screenshots
