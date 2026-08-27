# Growth Chart Plotter (TSPE, demo)

A single-file, fully offline growth-chart web app for Thai pediatric growth
references — height/length & weight for age, BMI for age, head circumference,
and weight-for-height. Digitized from the Thai Society for Pediatric
Endocrinology (TSPE) "New Thai Growth Chart" and BMI Z-score chart PDFs.

**[Live demo →](https://YOUR_USERNAME.github.io/YOUR_REPO/)**
*(replace with your actual GitHub Pages URL after publishing)*

## What it does

- Key in a patient's sex, DOB, and measurements → get a plotted growth chart
  and automatic percentile / z-score calculation (LMS method, Cole & Green).
- Four chart types: height/weight-for-age, BMI-for-age, head circumference,
  weight-for-height.
- Combined single-grid view (matches the original TSPE paper layout, dual
  cm/kg axis) or separate stacked panels — toggle either way.
- Export a filled-in PDF report, or raw JSON.
- 100% client-side. No backend, no network calls, no analytics. Patient data
  never leaves the browser tab — nothing is transmitted or stored anywhere.

## ⚠️ Important limitations — read before clinical use

- **The reference curves are *not* official TSPE data.** They were
  reconstructed by extracting the vector paths from TSPE's published PDF
  charts and re-fitting LMS (L, M, S) parameters from the seven printed
  percentile lines. Closed-loop validation against the source PDFs shows
  <0.15 unit error almost everywhere (well under the printed line
  thickness), except right at the 24-month and 60-month splice seams (BMI
  chart), where error briefly reaches ~0.3 kg/m² — that's a real
  discontinuity in TSPE's own source charts (recumbent-length vs
  standing-height, and 0–5y vs 5–19y BMI criteria), not a digitization bug.
- **This is a demo/prototype**, not a validated medical device. Do not use
  it for real clinical decisions without independently verifying the
  reference tables against TSPE's official data.
- The PDF export recreates the *layout* of the TSPE paper form (colors,
  axis style, field labout) but does **not** use TSPE's actual logo
  artwork, which is their intellectual property.

## Hosting this yourself

The shipped app is a single static HTML file (`dist/index.html`, ~1.6 MB —
fonts, PDF library, reference data all bundled inline). It works by just
opening that file in a browser, or on any static host (Netlify, Vercel, S3,
…) — nothing in it is GitHub-Pages-specific.

### GitHub Pages (automated)

This repo ships two GitHub Actions workflows:

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | every push / PR | runs `build.sh`, checks the bundle built and that `dist/` is up to date |
| `.github/workflows/deploy.yml` | push to `main` (or manual run) | rebuilds and publishes `dist/` to GitHub Pages |

One-time setup after forking:

```
1. Settings → Pages → Build and deployment → Source: GitHub Actions
2. Push to main (or run the "Deploy to GitHub Pages" workflow manually)
3. Served at https://YOUR_USERNAME.github.io/YOUR_REPO/
```

### Building locally

`./build.sh` regenerates `dist/index.html` from `src/`. It needs `bash`,
`node` (for a post-build `node --check` syntax pass) and `python3`. No
`npm install` — there are no dependencies to fetch.

## Third-party code bundled inline

| Component | License | Purpose |
|---|---|---|
| [jsPDF](https://github.com/parallax/jsPDF) | MIT | PDF generation |
| [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) | MIT | Embeds the chart SVG into the PDF as vector graphics |
| [IBM Plex Sans Thai / IBM Plex Mono](https://github.com/IBM/plex) | SIL OFL 1.1 | UI and PDF fonts (embedded as base64, so the app needs no font CDN) |

## Data sources

- Thai Society for Pediatric Endocrinology (TSPE), *New Thai Growth Chart*
  and *BMI Chart for Thai Children*, 2022/2565.
- Underlying standards: WHO Growth Standard (2006) for 0–5y, National
  Growth References for children aged 5–19 years (2020, Bureau of
  Nutrition, Dept. of Health, Thai Ministry of Public Health).
