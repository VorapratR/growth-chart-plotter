# Growth Chart Plotter — handoff notes

Thai pediatric growth-chart web app. Single self-contained HTML file, no
backend, no build tooling required to *run* it — but source is split out
here for anyone continuing development. Built iteratively in a long chat
session; these notes are the condensed version of what happened and why.

## Quick start

```
dist/index.html      ← open directly in a browser, this is the whole app
```

To edit: change files under `src/`, then run `./build.sh` to regenerate
`dist/index.html`. That script is the entire "build system" — it's a
straight concatenation in a fixed order (head → body → vendor libs → fonts
→ data → main.js). No npm install needed to build; `node` is only used by
build.sh for a post-build syntax check.

## Project layout

```
dist/index.html        Final bundled app (what you ship / deploy)
build.sh                Regenerates dist/index.html from src/
src/
  head.html             <head>: CSS, embedded @font-face (base64)
  body.html              <body> markup: layout, forms, chart/results containers
  main.js                 All app logic (~800 lines) — see "Code map" below
  data/
    tspe_lms_and_cdc.js   Height/weight LMS tables, 2–19y (TSPE + CDC reference)
    all_new_lms.js        BMI, head-circumference, 0–2y, weight-for-height LMS tables
  fonts/thai_fonts.js      IBM Plex Sans/Mono as base64 (used by the PDF exporter)
  vendor/                  jsPDF + svg2pdf.js (MIT), vendored inline, unmodified
extraction/               How the reference data was produced (see below)
```

## What this app does

Four chart modes, one shared LMS (Cole & Green) engine:

| Mode | X axis | Y | Notes |
|---|---|---|---|
| Height/weight-for-age | age, 0–19y | cm & kg | splices a 0–2y (length) table with a 2–19y (height) table at 24mo; toggle between one combined dual-scale chart (mimics the original TSPE paper form) or two stacked panels |
| BMI-for-age | age, 0–19y | BMI | z-score bands (not percentile); splices 0–5y/5–19y tables at 60mo; applies TSPE's official Overweight/Obesity classification rules |
| Head circumference | age, 0–5y | cm | percentile bands |
| Weight-for-height | height, 90–180cm | kg | no DOB needed; independent of age |

PDF export embeds the live chart as vector SVG (via svg2pdf.js) with Thai
fonts baked into the PDF itself, recreating the TSPE paper form's layout
(not their actual logo — that's their IP, not reproduced).

## Where the data comes from — important caveats

**None of the reference curves are official TSPE data.** TSPE publishes
growth charts as *PDF images*, not machine-readable LMS tables. The
`extraction/` pipeline reconstructs LMS parameters by:

1. Opening each source PDF with PyMuPDF and pulling out the vector paths
   of the printed percentile/SDS curves directly (`get_drawings()`).
2. Calibrating pixel→value using the axis tick labels' text positions
   (also extracted from the PDF, cross-checked left-axis vs right-axis
   independently as a sanity check).
3. Re-fitting L, M, S per age-point via nonlinear least-squares against
   the ~7–9 digitized percentile/z curves at that age
   (`fit_lms2.py`).

Validated by a closed-loop check: run the *shipped* JS engine against the
raw digitized points and measure the gap. Typical error is **<0.05 units**
(cm/kg/BMI) — well under printed line thickness — except right at the
24mo/60mo splice seams, where error briefly reaches ~0.3 (BMI), which
is a **real discontinuity in TSPE's own source charts**, not a
digitization bug (recumbent-length vs standing-height, different studies
pre/post age 5).

If you can get the actual official LMS tables from TSPE/สำนักโภชนาการ,
swap them in — `main.js`'s `indicators()` function and the `REF_*` table
format (`[x, L, M, S]` rows) are the only things that need to match.

**Known gap:** `extraction/digitize_ht_wt.py` (the very first extraction
script, for the 2–19y height/weight chart specifically) was lost to a
sandbox reset partway through development and was never recreated — only
its *output* (`src/data/tspe_lms_and_cdc.js`) survives. The other four
`digitize_*.py` scripts follow the identical method and are a complete
reference for reconstructing it if needed.

## Code map (`src/main.js`)

Roughly top-to-bottom:
1. Reference registry (`REFS`) — swappable TSPE/CDC tables for the 2–19y leg
2. LMS engine — `lmsAt` (cubic-Hermite interpolation over the LMS table),
   `zFromValue`/`valueFromZ` (Cole & Green formula), `pctFromZ`
3. `splice()`/`fixed()` — wrap two age-banded tables (or one) into a single
   lookup function per sex/indicator
4. `MODES` — the 4 chart-mode configs (domains, panels, labels)
5. Chart rendering — `renderCombinedTwoScale` (dual-axis single-grid) and
   `renderStackedPanels` (2 separate panels), dispatched by
   `S.chartStyle`
6. Results table — `renderResults`, including `bmiClassification` (TSPE's
   official Overweight/Obesity rules)
7. UI wiring — mode/sex/style toggles, visit-row editing, demo data
8. PDF export — clones the live SVG, bakes computed CSS styles into literal
   attributes (svg2pdf can't resolve CSS custom properties), embeds Thai
   font, recreates the paper-form layout

## Known bugs fixed along the way (useful context, don't re-break these)

- `lmsAt`'s table-boundary check needs an epsilon (currently `0.1`, in
  the table's native unit — months for age tables, cm for
  weight-for-height). The PDF-digitized tables' *actual* first/last data
  points are often a few hundredths off the nominal boundary (0, 19y,
  24mo, etc. — sub-day precision from the original extraction), so an
  exact `x < tab[0][0]` check incorrectly rejects real boundary values
  (e.g. a literal birth-day measurement, or exactly-19-year-old patients).
  This was found twice at different boundaries — if you touch this check,
  re-verify age=0, age=19, and both splice seams (24mo, 60mo) all still
  resolve for both sexes across every table.
- `xOfVisit` must return `null` (not `NaN`) for unparseable input —
  downstream code checks `== null`, and a stray `NaN` silently poisons
  the whole render chain (corrupt SVG path data, literal "null" text in
  table cells, etc.) without throwing anywhere obvious.
- Chart line renders reuse the *last successfully-plotted point* for the
  end-of-curve label position, rather than a separate query at exactly
  `xMax` — the same boundary-precision issue above means a fresh query
  at exactly `xMax` can fail even though the curve itself rendered fine
  via 200 sampled points that stop just short of it.
- `renderAll()` deliberately does *not* call `renderVisits()` (that would
  destroy input focus on every keystroke while editing the visit table).
  DOB changes need `renderVisits()` called explicitly to refresh the
  negative-age warning highlighting — see the `dob` input handler.
- CSS Grid: grid items default to `min-width:auto`, which lets a wide
  child (the chart's `min-width:900px`) force the *entire grid track*
  wider, including the sidebar — breaks mobile layout entirely if you
  remove the `min-width:0` on `.wrap > div`.

## Not yet done

- Growth velocity (rate of change between consecutive visits, e.g. cm/yr)
  — flagged as wanted, not implemented.
- Only tested against Chromium (Playwright). Safari/Firefox were never
  actually verified — the sandbox this was built in couldn't download
  those browser engines (network-restricted). If something looks broken
  specifically on iOS Safari, start there.
- No automated test suite — verification throughout was ad hoc Playwright
  scripts + closed-loop numeric checks against the digitized data,
  none of which are saved/committed anywhere. Worth formalizing if this
  keeps growing. CI (below) currently only checks that the bundle builds.
- Data persistence — direction is client-side only (keeps the "data never
  leaves the browser" property, so it still ships on GitHub Pages):
  - **Phase 1 (done):** `saveState()` / `loadState()` / `syncControls()` in
    `src/main.js` autosave `S` to `localStorage` on every `renderAll()` and
    restore it on startup. "ล้างข้อมูลทั้งหมด" button wipes it.
  - **Phase 2 (todo):** IndexedDB multi-patient store — split `S` into
    `patient` + `visit` records, patient-list sidebar, search, soft-delete.
  - The `S` <-> storage boundary is where a future backend-sync layer would
    attach, if a real multi-device need ever appears.

## Deployment / CI

- `git` repo is `handoff/` itself (was previously nested under an unrelated
  `~/Desktop/.git` with no commits).
- `.github/workflows/ci.yml` — runs `build.sh` on every push/PR, asserts the
  bundle built and that the committed `dist/` matches a fresh build (so a
  `src/` edit without a rebuild fails the check).
- `.github/workflows/deploy.yml` — on push to `main`, rebuilds and publishes
  `dist/` to GitHub Pages via `actions/deploy-pages`. Needs a one-time
  **Settings -> Pages -> Source: GitHub Actions** in the repo.
- `dist/index.html` is committed (keeps "clone and open the file" working);
  `build.sh` also writes `dist/.nojekyll`.
- `extraction/source_pdfs/*.pdf` (TSPE's published charts) are `.gitignore`d
  pending a redistribution decision — see `.gitignore` to include them.
