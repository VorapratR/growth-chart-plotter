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
  engine.js               Pure LMS math (lmsAt, z<->value, pctFromZ, splice, …);
                          concatenated ahead of main.js, also require()d by tests
  main.js                 App logic (~1090 lines) — see "Code map" below
  data/
    tspe_lms_and_cdc.js   Height/weight LMS tables, 2–19y (TSPE + CDC reference)
    all_new_lms.js        BMI, head-circumference, 0–2y, weight-for-height LMS tables
  fonts/thai_fonts.js      IBM Plex Sans/Mono as base64 (used by the PDF exporter)
  vendor/                  jsPDF + svg2pdf.js (MIT), vendored inline, unmodified
tests/
  unit/                   node --test (zero deps): engine round-trips, table
                          integrity, boundary resolution, closed-loop vs the
                          digitized source curves in extraction/digitized_raw/
  e2e/app.spec.js          Playwright: demo→chart→results, velocity column,
                          persistence, multi-patient sidebar, migration, export
extraction/               How the reference data was produced (see below)
```

`npm test` runs the unit tests (no install needed beyond `node`); `npm run
test:all` also builds and runs the Playwright e2e suite (needs `npm ci` +
`npx playwright install chromium`).

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

Roughly top-to-bottom (the LMS engine itself — `lmsAt` cubic-Hermite
interpolation, `zFromValue`/`valueFromZ` Cole & Green, `pctFromZ`,
`splice()`/`fixed()` — is in `src/engine.js`, concatenated just before this
file):
1. Reference registry (`REFS`) — swappable TSPE/CDC tables for the 2–19y leg
2. Percentile / z-score band constants (`PCTS`, `PCT_Z`, `ZBAND`)
3. `indicators()` — composes `splice()`/`fixed()` into sex→x→{L,M,S} per indicator
4. `MODES` — the 4 chart-mode configs (domains, panels, labels)
5. State + persistence — `S` (open patient + view settings), the IndexedDB
   wrapper (`openDB`/`dbGetAll`/`dbPut`/…), `patientFromS`/`sFromPatient`,
   prefs load/save, `saveState`, migration, patient-list ops
   (`openPatient`/`newPatientAndOpen`/`deletePatient`/`restorePatient`),
   `renderSidebar`, `syncControls`
6. Chart rendering — `renderCombinedTwoScale` (dual-axis single-grid) and
   `renderStackedPanels` (2 separate panels), dispatched by `S.chartStyle`
7. Results table — `renderResults`, including `bmiClassification` (TSPE's
   official Overweight/Obesity rules)
8. UI wiring — mode/sex/style toggles, visit-row editing, demo data,
   sidebar events, JSON export/import, clear-all
9. PDF export — clones the live SVG, bakes computed CSS styles into literal
   attributes (svg2pdf can't resolve CSS custom properties), embeds Thai
   font, recreates the paper-form layout
10. `initApp()` — async startup (open DB → migrate → load patient + prefs
    → render)

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
- Patient switching must update `S._pid` *synchronously* — `applyPatient()`
  does the whole `sFromPatient` + form + render synchronously, then the
  IndexedDB write happens after. An earlier version awaited the DB first, so
  a keystroke landing right after "+ เพิ่มคนไข้" was saved onto the *previous*
  patient (the `#hn` input handler persists to whatever `S._pid` currently
  is). e2e test "manages multiple patients" guards this.
- An explicit `display:` in author CSS overrides the UA `[hidden]` rule, so
  `button.linky` needs its own `[hidden]{display:none}` — otherwise the
  "ดูที่ลบแล้ว" toggle (shown/hidden via the `hidden` property) never hides.
- Every IndexedDB failure path must be visible. `saveState()` raises the
  `#storageWarn` banner on a rejected write (not a `.catch(()=>{})` no-op);
  `initApp()` wraps the *whole* IDB block (Safari private mode / modern
  Firefox: `open()` succeeds, the *transactions* fail) and drops to the
  single-patient fallback; the `guard()` wrapper does the same for the
  patient-list ops. `guard()` calls its fn synchronously — `applyPatient`
  must still run before control returns (see the patient-switch note above).
- `patientFromS()` preserves the record's `deletedAt` — an earlier version
  hardcoded `null`, so any `saveState()` (or `initApp` falling back to
  `all[0]`) could resurrect a soft-deleted patient. `deletePatient()`
  switches away from the target *before* marking it deleted.
- `patientFromImport()` coerces `fh`/`mh` via `parseFloat` and normalises
  every visit row — a stray `"fh": "163"` (string) in an imported/edited
  JSON otherwise made `midParental()` do string concat (MPH in the millions).
- Sidebar sorts by `createdAt`, not `updatedAt`: every keystroke re-saves
  the open patient, so an `updatedAt` sort made the list jump while typing.

## Done since the original handoff

- **Growth velocity** — the results table (and the PDF) now show unit/year
  change between consecutive visits for the age-axis modes (`velocity()` in
  `main.js`; weight-for-height has no time axis so it's omitted there).
- **Automated tests** — `tests/unit/` (node --test, zero deps) covers the LMS
  engine, table integrity, the boundary cases listed below, the TSPE BMI
  classification criteria, growth-velocity edge cases, and a closed-loop
  check of the shipped tables against `extraction/digitized_raw/` (all six
  percentile/SDS files that map cleanly; tolerances are ~3–5× the measured
  residual). `tests/e2e/app.spec.js` (Playwright) covers the UI + persistence
  + export/import round-trip + a PDF smoke test. Both run in CI. `initApp()`
  sets `<html data-ready>` when startup finishes — e2e tests wait on that.

## Not yet done

- Only tested against Chromium (Playwright). Safari/Firefox were never
  actually verified — the sandbox this was built in couldn't download
  those browser engines (network-restricted). If something looks broken
  specifically on iOS Safari, start there.
- **Concurrent tabs**: `saveState()` writes the whole open-patient snapshot
  with no compare-and-swap, so two tabs editing the same patient is
  last-writer-wins with no conflict detection. `onversionchange`/`onblocked`
  are handled (a future `DB_VERSION` bump won't hang); a real CAS
  (reject a write whose stored `updatedAt` is newer than the loaded one)
  is not. Low priority for a single-clinician demo.
- **PDF table width**: adding the velocity column takes the height/weight
  PDF table to 12 columns at 7.5pt across A4 — band labels like `P25–P50`
  are near the edge of their cell. Fine on screen (scrolls); tighten the
  PDF font or drop a column if it actually overflows in practice.
- Data persistence — direction is client-side only (keeps the "data never
  leaves the browser" property, so it still ships on GitHub Pages):
  - **Phase 1 (done):** localStorage autosave of `S`.
  - **Phase 2 (done):** IndexedDB store `growthchart` / object store
    `patients` (one row per patient, visits embedded). `S` still holds the
    *open* patient plus view settings; `S._pid` maps it to a stored row.
    `saveState()` writes the open patient to IDB + view settings to
    `localStorage` (`growthchart:prefs:v1`) on every `renderAll()`.
    `initApp()` opens the DB, migrates the phase-1 blob once
    (`growthchart:migrated:v2` flag), and reopens the last patient.
    Sidebar "คนไข้" card: list / search / new / soft-delete (`deletedAt`)
    / restore. Export JSON now emits a `growthchart/v2` bundle of all live
    patients; "นำเข้า JSON" imports it (or a phase-1 single-patient file).
    If IndexedDB is unavailable (private mode) the sidebar is hidden and it
    degrades to single-patient / prefs-only.
  - **Phase 3 (todo, only if needed):** a sync layer at the `S` <-> storage
    boundary for real multi-device use.

## Deployment / CI

- `git` repo is `handoff/` itself (was previously nested under an unrelated
  `~/Desktop/.git` with no commits).
- `.github/workflows/ci.yml` — on every push/PR: `build-and-unit` job builds,
  asserts the bundle built and that the committed `dist/` matches a fresh
  build (so a `src/` edit without a rebuild fails the check), then runs the
  `node --test` unit suite; `e2e` job runs the Playwright suite in Chromium.
- `.github/workflows/deploy.yml` — on push to `main`, rebuilds and publishes
  `dist/` to GitHub Pages via `actions/deploy-pages`. Needs a one-time
  **Settings -> Pages -> Source: GitHub Actions** in the repo.
- `dist/index.html` is committed (keeps "clone and open the file" working);
  `build.sh` also writes `dist/.nojekyll`.
- `extraction/source_pdfs/*.pdf` (TSPE's published charts) are `.gitignore`d
  pending a redistribution decision — see `.gitignore` to include them.
