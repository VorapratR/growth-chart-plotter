/* ---------------------------------------------------------------
   1. Reference registry (age/height-for-2-19y tables, swappable)
----------------------------------------------------------------*/
const REFS = {
  tspe2565: { label: 'TSPE 2565 (Thai)', tables: REF_TSPE2565 },
  cdc2000: { label: 'CDC 2000 (US, reference)', tables: REF_CDC2000 }
};

/* ---------------------------------------------------------------
   2. LMS engine
----------------------------------------------------------------*/
const PCTS = [3, 10, 25, 50, 75, 90, 97];
const PCT_Z = { 3: -1.880794, 10: -1.281552, 25: -0.674490, 50: 0, 75: 0.674490, 90: 1.281552, 97: 1.880794 };
const ZBAND = [-3, -2, -1.5, -1, 0, 1, 1.5, 2, 3];

function lmsAt(tab, x) {
  const n = tab.length, EPS = 0.1;
  if (x < tab[0][0] - EPS || x > tab[n - 1][0] + EPS) return null;
  x = Math.max(tab[0][0], Math.min(tab[n - 1][0], x));
  let i = 0;
  while (i < n - 2 && tab[i + 1][0] < x) i++;
  const x0 = tab[i][0], x1 = tab[i + 1][0], h = x1 - x0;
  const t = h === 0 ? 0 : (x - x0) / h;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const out = [];
  for (let k = 1; k <= 3; k++) {
    const y0 = tab[i][k], y1 = tab[i + 1][k];
    const pm = tab[i - 1] || tab[i], pn = tab[i + 2] || tab[i + 1];
    const m0 = (y1 - pm[k]) / (x1 - pm[0]) * h;
    const m1 = (pn[k] - y0) / (pn[0] - x0) * h;
    out.push(h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1);
  }
  return { L: out[0], M: out[1], S: out[2] };
}
function zFromValue(p, x) {
  return Math.abs(p.L) < 1e-7 ? Math.log(x / p.M) / p.S
                              : (Math.pow(x / p.M, p.L) - 1) / (p.L * p.S);
}
function valueFromZ(p, z) {
  return Math.abs(p.L) < 1e-7 ? p.M * Math.exp(p.S * z)
                              : p.M * Math.pow(1 + p.L * p.S * z, 1 / p.L);
}
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const pctFromZ = z => 100 * 0.5 * erfc(-z / Math.SQRT2);

function ageYears(dob, when) {
  const a = new Date(dob), b = new Date(when);
  if (isNaN(a) || isNaN(b)) return null;
  return (b - a) / 86400000 / 365.2425;
}

/* splice two tables at a boundary x -- deliberately NOT smoothed across the
   seam: TSPE's own 0-2y (recumbent length) vs 2-19y (standing height) and
   0-5y vs 5-19y BMI charts have a real small jump at the boundary (different
   measurement method / source study), so each side is queried independently
   from its own native table rather than merged into one interpolation run. */
function splice(lowTab, highTab, splitXMonths, toMonths) {
  return x => {
    if (x == null) return null;
    const xm = toMonths ? toMonths(x) : x;
    const primary = xm < splitXMonths ? lowTab : highTab;
    const secondary = xm < splitXMonths ? highTab : lowTab;
    return lmsAt(primary, xm) || lmsAt(secondary, xm);
  };
}
function fixed(tab, toMonths) {
  return x => x == null ? null : lmsAt(tab, toMonths ? toMonths(x) : x);
}

/* ---------------------------------------------------------------
   3. Indicators: sex -> (x) -> {L,M,S}|null
   x is age-in-months, except *_wfh where x is height-in-cm.
----------------------------------------------------------------*/
function indicators(ref) {
  const yr2mo = x => x * 12;
  return {
    height: {
      M: splice(REF_LENGTH_0TO2_M, ref.tables.height_M, 24, yr2mo),
      F: splice(REF_LENGTH_0TO2_F, ref.tables.height_F, 24, yr2mo)
    },
    weight_age: {
      M: splice(REF_WEIGHT_0TO2_M, ref.tables.weight_M, 24, yr2mo),
      F: splice(REF_WEIGHT_0TO2_F, ref.tables.weight_F, 24, yr2mo)
    },
    bmi: {
      M: splice(REF_BMI_BOY_0_5, REF_BMI_BOY_5_19, 60, yr2mo),
      F: splice(REF_BMI_GIRL_0_5, REF_BMI_GIRL_5_19, 60, yr2mo)
    },
    hc: { M: fixed(REF_HEADCIRC_M, yr2mo), F: fixed(REF_HEADCIRC_F, yr2mo) },
    weight_height: { M: fixed(REF_WFH_M), F: fixed(REF_WFH_F) }
  };
}

/* ---------------------------------------------------------------
   4. Mode configuration
----------------------------------------------------------------*/
const MODES = {
  ht_wt: {
    label: 'ส่วนสูง/น้ำหนักตามอายุ',
    hint: 'กราฟรวมแบบต้นฉบับ TSPE — สูง (ซม., แกนซ้าย) และน้ำหนัก (กก., แกนขวา) วางบนกริดเดียวกัน · ต่อข้อมูล 0–2 ปี (นอนวัด) กับ 2–19 ปี (ยืนวัด) อัตโนมัติ — จุดต่อที่ 24 เดือนมี “รอยต่อ” เล็กน้อยตามธรรมชาติของสองมาตรฐานนี้',
    xKind: 'age', xMin: 0, xMax: 19, xUnit: 'ปี', needsDob: true, needsParents: true, refSwappable: true,
    combinable: true, combinedDomains: { height: [20, 190], weight: [0, 120] },
    panels: [
      { key: 'height', title: 'ส่วนสูง/ความยาว', shortTitle: 'สูง/ยาว', unit: 'ซม.', band: 'pct', indicator: 'height',
        yOf: v => parseFloat(v.ht), showMph: true },
      { key: 'weight_age', title: 'น้ำหนัก', unit: 'กก.', band: 'pct', indicator: 'weight_age',
        yOf: v => parseFloat(v.wt) }
    ]
  },
  bmi: {
    label: 'BMI ตามอายุ',
    hint: 'ต่อข้อมูล BMI 0–5 ปี กับ 5–19 ปี อัตโนมัติที่ 5 ขวบ · เส้นเป็น z-score band (SDS) ไม่ใช่ percentile',
    xKind: 'age', xMin: 0, xMax: 19, xUnit: 'ปี', needsDob: true, needsParents: false, refSwappable: false,
    panels: [
      { key: 'bmi', title: 'BMI', unit: 'kg/m²', band: 'z', indicator: 'bmi',
        yOf: v => { const h = parseFloat(v.ht), w = parseFloat(v.wt); return (h > 0 && isFinite(w)) ? w / (h / 100) ** 2 : NaN; } }
    ]
  },
  hc: {
    label: 'เส้นรอบศีรษะ',
    hint: 'ใช้ได้เฉพาะช่วงอายุ 0–5 ปี (ตามข้อมูลต้นฉบับ TSPE)',
    xKind: 'age', xMin: 0, xMax: 5, xUnit: 'ปี', needsDob: true, needsParents: false, refSwappable: false,
    panels: [
      { key: 'hc', title: 'เส้นรอบศีรษะ', unit: 'ซม.', band: 'pct', indicator: 'hc',
        yOf: v => parseFloat(v.hc) }
    ]
  },
  wfh: {
    label: 'น้ำหนักตามส่วนสูง',
    hint: 'ไม่ใช้วันเกิด — แกน X คือส่วนสูงที่วัดได้จริงในแต่ละครั้ง (ใช้ประเมิน wasting/stunting โดยไม่ผูกกับอายุ)',
    xKind: 'height', xMin: 85, xMax: { M: 180, F: 170 }, xUnit: 'ซม.', needsDob: false, needsParents: false, refSwappable: false,
    panels: [
      { key: 'weight_height', title: 'น้ำหนักตามส่วนสูง', unit: 'กก.', band: 'pct', indicator: 'weight_height',
        yOf: v => parseFloat(v.wt) }
    ]
  }
};

function xOfVisit(mode, v) {
  if (mode.xKind === 'height') { const h = parseFloat(v.ht); return isFinite(h) ? h : null; }
  return S.dob && v.date ? ageYears(S.dob, v.date) : null;
}
function sortedVisits(mode) {
  return S.visits
    .map(v => ({ v, x: xOfVisit(mode, v) }))
    .filter(o => o.x != null && isFinite(o.x))
    .sort((a, b) => a.x - b.x)
    .map(o => o.v);
}
function modeXMax(mode, sex) {
  return typeof mode.xMax === 'object' ? mode.xMax[sex] : mode.xMax;
}

/* ---------------------------------------------------------------
   5. State
----------------------------------------------------------------*/
const S = {
  mode: 'ht_wt', sex: 'F', hn: '', dob: '', fh: null, mh: null, ref: 'tspe2565', chartStyle: 'combined',
  visits: [{ date: '', ht: '', wt: '', hc: '' }]
};
const midParental = () => (S.fh && S.mh) ? (S.fh + S.mh + (S.sex === 'M' ? 13 : -13)) / 2 : null;
const curIndicators = () => indicators(REFS[S.ref]);
const curMode = () => MODES[S.mode];

/* ---------------------------------------------------------------
   6. Chart (generalized: 1 or 2 stacked panels, age or height x-axis,
      percentile or z-score bands)
----------------------------------------------------------------*/
const X0 = 52, X1 = 842;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function xOf(mode, sex, xval) {
  const xMax = modeXMax(mode, sex);
  return X0 + (xval - mode.xMin) / (xMax - mode.xMin) * (X1 - X0);
}

function bandList(bandType) {
  return bandType === 'z'
    ? ZBAND.map(z => ({ z, label: (z > 0 ? '+' : '') + z, bold: Number.isInteger(z) }))
    : PCTS.map(p => ({ z: PCT_Z[p], label: 'P' + p, bold: p === 3 || p === 50 || p === 97 }));
}

function niceDomain(getP, bands, xMin, xMax) {
  let lo = Infinity, hi = -Infinity;
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (xMax - xMin) * i / steps;
    for (const b of bands) {
      const p = getP(x); if (!p) continue;
      const v = valueFromZ(p, b.z);
      if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  if (!isFinite(lo)) return [0, 1];
  const span = hi - lo, pad = span * 0.06;
  const step = span > 60 ? 10 : span > 25 ? 5 : span > 10 ? 2 : 1;
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step];
}

function renderChart() {
  const svg = document.getElementById('svg');
  const mode = curMode(), sex = S.sex, ind = curIndicators();
  const useCombined = mode.combinable && S.chartStyle === 'combined';
  const out = useCombined ? renderCombinedTwoScale(mode, sex, ind) : renderStackedPanels(mode, sex, ind);
  svg.setAttribute('viewBox', `0 0 900 706`);
  svg.innerHTML = out;
}

/* Original-TSPE-style combined chart: height and weight overlaid on ONE grid box
   with independent left(cm)/right(kg) scales, like the real paper form -- instead
   of two separate stacked panels. */
function renderCombinedTwoScale(mode, sex, ind) {
  const xMax = modeXMax(mode, sex);
  const mph = midParental();
  const y0 = 32, panelH = 706 - y0 - 24;
  // Narrower plot area than the single-panel modes: the combined chart needs
  // extra right-margin room for BOTH the weight axis numbers AND the P-label
  // tags for both curve families (single-panel charts only need one or the
  // other, so they can use the full width).
  const X1C = 760;
  const xOfC = xval => X0 + (xval - mode.xMin) / (xMax - mode.xMin) * (X1C - X0);
  const [Ph, Pw] = mode.panels;
  const getH = ind[Ph.indicator][sex], getW = ind[Pw.indicator][sex];
  const [hLo, hHi] = mode.combinedDomains.height;
  const [wLo, wHi] = mode.combinedDomains.weight;
  const yOfH = v => y0 + panelH - (v - hLo) / (hHi - hLo) * panelH;
  const yOfW = v => y0 + panelH - (v - wLo) / (wHi - wLo) * panelH;
  let out = '';

  out += `<rect x="${X0}" y="${y0}" width="${X1C - X0}" height="${panelH}" fill="var(--paper)"/>`;

  // Dense neutral "graph paper" grid (texture only, not tied to either scale --
  // mirrors the fine printed grid on the original form) + the usual age grid.
  let gmin = '', gmaj = '';
  const nRows = 40, majorEvery = 5;
  for (let i = 0; i <= nRows; i++) {
    const yy = y0 + panelH * i / nRows;
    (i % majorEvery === 0 ? (gmaj += `M${X0} ${yy.toFixed(1)}H${X1C}`) : (gmin += `M${X0} ${yy.toFixed(1)}H${X1C}`));
  }
  const xMinorRaw = 0.5, xMajorRaw = 1;
  for (let a = mode.xMin; a <= xMax + 1e-9; a += xMinorRaw) {
    const isMaj = Math.abs(Math.round(a / xMajorRaw) * xMajorRaw - a) < xMinorRaw / 2;
    const xp = xOfC(a);
    (isMaj ? (gmaj += `M${xp} ${y0}V${y0 + panelH}`) : (gmin += `M${xp} ${y0}V${y0 + panelH}`));
  }
  out += `<path d="${gmin}" stroke="var(--rule-min)" stroke-width=".5" fill="none"/>`;
  out += `<path d="${gmaj}" stroke="var(--rule-maj)" stroke-width=".7" fill="none" opacity=".65"/>`;
  out += `<rect x="${X0}" y="${y0}" width="${X1C - X0}" height="${panelH}" fill="none" stroke="var(--rule-maj)" stroke-width="1"/>`;

  const hStep = 10, wStep = 10;
  for (let v = Math.ceil(hLo / hStep) * hStep; v <= hHi + 1e-9; v += hStep)
    out += `<text x="${X0 - 8}" y="${yOfH(v) + 3.5}" text-anchor="end" font-size="9" fill="var(--muted)">${v}</text>`;
  for (let v = Math.ceil(wLo / wStep) * wStep; v <= wHi + 1e-9; v += wStep)
    out += `<text x="${X1C + 38}" y="${yOfW(v) + 3.5}" text-anchor="start" font-size="9" fill="var(--muted)">${v}</text>`;

  for (let a = mode.xMin; a <= xMax + 1e-9; a += xMajorRaw)
    out += `<text x="${xOfC(a)}" y="${y0 + panelH + 13}" text-anchor="middle" font-size="9" fill="var(--muted)">${+a.toFixed(2)}</text>`;
  out += `<text x="${(X0 + X1C) / 2}" y="${y0 + panelH + 24}" text-anchor="middle" font-size="8.5" fill="var(--muted)">อายุ (ปี)</text>`;

  out += `<text x="${X0 - 8}" y="${y0 - 7}" text-anchor="end" font-size="9" fill="var(--muted)">ซม.</text>`;
  out += `<text x="${X1C + 38}" y="${y0 - 7}" text-anchor="start" font-size="9" fill="var(--muted)">กก.</text>`;
  out += `<text x="${X0 + 8}" y="${y0 - 7}" font-size="10.5" font-weight="600" fill="var(--curve-mid)" font-family="IBM Plex Sans Thai,sans-serif">ส่วนสูง/ความยาวและน้ำหนักตามอายุ</text>`;
  // legend as actual vector shapes (not font glyphs) so it survives PDF export
  // even though the embedded PDF font has no bullet/square glyphs
  const legX = X0 + 8, legY = y0 - 18;
  out += `<circle cx="${legX}" cy="${legY - 3}" r="3.2" fill="var(--ink)"/><text x="${legX + 8}" y="${legY}" font-size="8" fill="var(--muted)">${esc(Ph.title)}</text>`;
  out += `<rect x="${legX + 72}" y="${legY - 6.2}" width="6.4" height="6.4" fill="var(--ink)"/><text x="${legX + 82}" y="${legY}" font-size="8" fill="var(--muted)">${esc(Pw.title)}</text>`;

  const tags = [];
  function drawFamily(getP, yOf, dom, tagSuffix) {
    for (const b of bandList('pct')) {
      let d = '', started = false, lastGood = null;
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const x = mode.xMin + (xMax - mode.xMin) * i / steps;
        const p = getP(x); if (!p) { started = false; continue; }
        const v = valueFromZ(p, b.z);
        if (!isFinite(v) || v < dom[0] || v > dom[1]) { started = false; continue; }
        d += (started ? 'L' : 'M') + xOfC(x).toFixed(1) + ' ' + yOf(v).toFixed(1);
        started = true; lastGood = v;
      }
      out += `<path d="${d}" fill="none" stroke="var(--curve)" stroke-width="${b.bold ? 1.5 : .8}" opacity="${b.bold ? .95 : .6}" stroke-linejoin="round"/>`;
      if (lastGood != null) tags.push({ label: b.label + tagSuffix, y: yOf(lastGood) });
    }
  }
  drawFamily(getH, yOfH, [hLo, hHi], '·H');
  drawFamily(getW, yOfW, [wLo, wHi], '·W');
  tags.sort((a, c) => a.y - c.y);
  for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 9) tags[i].y = tags[i - 1].y + 9;
  for (const t of tags)
    out += `<text x="${X1C + 4}" y="${t.y + 3}" font-size="7.2" fill="var(--curve-mid)" opacity=".9">${esc(t.label)}</text>`;

  if (mph && mph - 5 >= hLo && mph + 5 <= hHi) {
    const yT = yOfH(mph + 5), yB = yOfH(mph - 5), x = X0 + 10;
    out += `<path d="M${x} ${yT}h9V${yB}h-9" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`;
    out += `<text x="${x + 13}" y="${yOfH(mph) + 3}" font-size="8.5" fill="var(--ink)">MPH ${mph.toFixed(1)}</text>`;
  }

  function drawPatient(yOf, dom, getVal, shape) {
    const pts = [];
    for (const v of sortedVisits(mode)) {
      const xv = xOfVisit(mode, v);
      const val = getVal(v);
      if (!isFinite(val) || xv < mode.xMin || xv > xMax || val < dom[0] || val > dom[1]) continue;
      pts.push([xOfC(xv), yOf(val)]);
    }
    if (pts.length > 1) {
      const poly = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      out += `<polyline points="${poly}" fill="none" stroke="#fff" stroke-width="3.4" opacity=".85"/>`;
      out += `<polyline points="${poly}" fill="none" stroke="var(--ink)" stroke-width="1.4"/>`;
    }
    for (const [px, py] of pts) {
      out += shape === 'circle'
        ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--ink)" stroke="#fff" stroke-width="1.6"/>`
        : `<rect x="${(px - 3.6).toFixed(1)}" y="${(py - 3.6).toFixed(1)}" width="7.2" height="7.2" fill="var(--ink)" stroke="#fff" stroke-width="1.6"/>`;
    }
  }
  drawPatient(yOfH, [hLo, hHi], Ph.yOf, 'circle');
  drawPatient(yOfW, [wLo, wHi], Pw.yOf, 'square');

  return out;
}

function renderStackedPanels(mode, sex, ind) {
  const xMax = modeXMax(mode, sex);
  const mph = mode.panels.some(p => p.showMph) ? midParental() : null;
  const nP = mode.panels.length;
  const gap = 12, y0start = 32, totalH = 706 - y0start - 24;
  const panelH = nP === 2 ? (totalH - gap) / 2 : totalH;
  let out = '';

  mode.panels.forEach((P, idx) => {
    const y0 = y0start + idx * (panelH + gap);
    const getP = ind[P.indicator][sex];
    const bands = bandList(P.band);
    const [lo, hi] = niceDomain(getP, bands, mode.xMin, xMax);
    const yOf = v => y0 + panelH - (v - lo) / (hi - lo) * panelH;
    const pxPerUnit = panelH / (hi - lo);
    const minor = [0.1, 0.2, 0.5, 1, 2, 5].find(s => s * pxPerUnit >= 5.5) || 10;
    const major = minor * (minor < 1 ? 10 : minor < 5 ? 5 : 5);
    const xSpanUnits = xMax - mode.xMin;
    const xMinorRaw = mode.xKind === 'height' ? 2 : (xSpanUnits <= 5 ? 0.25 : 0.5);
    const xMajorRaw = mode.xKind === 'height' ? 10 : 1;

    out += `<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${panelH}" fill="var(--paper)"/>`;
    let gmin = '', gmaj = '';
    for (let v = Math.ceil(lo / minor) * minor; v <= hi + 1e-9; v += minor) {
      const isMaj = Math.abs(Math.round(v / major) * major - v) < minor / 2;
      (isMaj ? (gmaj += `M${X0} ${yOf(v)}H${X1}`) : (gmin += `M${X0} ${yOf(v)}H${X1}`));
    }
    for (let a = mode.xMin; a <= xMax + 1e-9; a += xMinorRaw) {
      const isMaj = Math.abs(Math.round(a / xMajorRaw) * xMajorRaw - a) < xMinorRaw / 2;
      const xp = xOf(mode, sex, a);
      (isMaj ? (gmaj += `M${xp} ${y0}V${y0 + panelH}`) : (gmin += `M${xp} ${y0}V${y0 + panelH}`));
    }
    out += `<path d="${gmin}" stroke="var(--rule-min)" stroke-width=".5" fill="none"/>`;
    out += `<path d="${gmaj}" stroke="var(--rule-maj)" stroke-width=".7" fill="none" opacity=".65"/>`;
    out += `<rect x="${X0}" y="${y0}" width="${X1 - X0}" height="${panelH}" fill="none" stroke="var(--rule-maj)" stroke-width="1"/>`;

    for (let v = Math.ceil(lo / major) * major; v <= hi + 1e-9; v += major)
      out += `<text x="${X0 - 8}" y="${yOf(v) + 3.5}" text-anchor="end" font-size="9" fill="var(--muted)">${+v.toFixed(2)}</text>`;
    for (let a = mode.xMin; a <= xMax + 1e-9; a += xMajorRaw)
      out += `<text x="${xOf(mode, sex, a)}" y="${y0 + panelH + 13}" text-anchor="middle" font-size="9" fill="var(--muted)">${+a.toFixed(2)}</text>`;
    if (idx === mode.panels.length - 1)
      out += `<text x="${X1}" y="${y0 + panelH + 22}" text-anchor="end" font-size="8.5" fill="var(--muted)">${mode.xKind === 'height' ? 'ส่วนสูง (ซม.)' : 'อายุ (ปี)'}</text>`;
    out += `<text x="${X0 - 8}" y="${y0 - 7}" text-anchor="end" font-size="9" fill="var(--muted)">${P.unit}</text>`;
    out += `<text x="${X0 + 8}" y="${y0 - 7}" font-size="11" font-weight="600" fill="var(--curve-mid)" font-family="IBM Plex Sans Thai,sans-serif">${P.title}</text>`;

    const tags = [];
    for (const b of bands) {
      let d = '', started = false, lastGood = null;
      const steps = 200;
      for (let i = 0; i <= steps; i++) {
        const x = mode.xMin + (xMax - mode.xMin) * i / steps;
        const p = getP(x); if (!p) { started = false; continue; }
        const v = valueFromZ(p, b.z);
        if (!isFinite(v) || v < lo || v > hi) { started = false; continue; }
        d += (started ? 'L' : 'M') + xOf(mode, sex, x).toFixed(1) + ' ' + yOf(v).toFixed(1);
        started = true; lastGood = v;
      }
      out += `<path d="${d}" fill="none" stroke="var(--curve)" stroke-width="${b.bold ? 1.5 : .8}" opacity="${b.bold ? .95 : .6}" stroke-linejoin="round"/>`;
      if (lastGood != null) tags.push({ label: b.label, y: yOf(lastGood) });
    }
    tags.sort((a, c) => a.y - c.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 10) tags[i].y = tags[i - 1].y + 10;
    for (const t of tags)
      out += `<text x="${X1 + 5}" y="${t.y + 3}" font-size="8.5" fill="var(--curve-mid)" opacity=".9">${esc(t.label)}</text>`;

    if (P.showMph && mph && mph - 5 >= lo && mph + 5 <= hi) {
      const yT = yOf(mph + 5), yB = yOf(mph - 5), x = X1 - 16;
      out += `<path d="M${x} ${yT}h9V${yB}h-9" fill="none" stroke="var(--ink)" stroke-width="1.1"/>`;
      out += `<path d="M${x + 4} ${yOf(mph)}h9" stroke="var(--ink)" stroke-width="1.6"/>`;
      out += `<text x="${x - 4}" y="${yOf(mph) - 4}" text-anchor="end" font-size="8.5" fill="var(--ink)">MPH ${mph.toFixed(1)}</text>`;
    }

    const pts = [];
    for (const v of sortedVisits(mode)) {
      const xv = xOfVisit(mode, v);
      const val = P.yOf(v);
      if (!isFinite(val) || xv < mode.xMin || xv > xMax || val < lo || val > hi) continue;
      pts.push([xOf(mode, sex, xv), yOf(val)]);
    }
    if (pts.length > 1) {
      const poly = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      out += `<polyline points="${poly}" fill="none" stroke="#fff" stroke-width="3.4" opacity=".85"/>`;
      out += `<polyline points="${poly}" fill="none" stroke="var(--ink)" stroke-width="1.4"/>`;
    }
    for (const [px, py] of pts)
      out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--ink)" stroke="#fff" stroke-width="1.6"/>`;
  });

  return out;
}

/* ---------------------------------------------------------------
   7. Results table
----------------------------------------------------------------*/
function bandOfPct(p) {
  const edges = [3, 10, 25, 50, 75, 90, 97];
  if (p < 3) return ['< P3', true];
  if (p > 97) return ['> P97', true];
  for (let i = 0; i < edges.length - 1; i++) if (p < edges[i + 1]) return [`P${edges[i]}–P${edges[i + 1]}`, false];
  return ['P90–P97', false];
}
function bandOfZ(z) {
  if (z < -3) return ['< -3 SD', true];
  if (z > 3) return ['> +3 SD', true];
  const edges = [-3, -2, -1, 0, 1, 2, 3];
  for (let i = 0; i < edges.length - 1; i++) if (z < edges[i + 1]) return [`${edges[i]} to ${edges[i + 1]} SD`, false];
  return ['2 to 3 SD', false];
}
/* Official TSPE BMI-for-age criteria (printed on the source charts):
   0-5y:  Overweight = SDS >+2 to +3, Obesity = SDS >+3
   5-19y: Overweight = SDS >+1 to +2 OR BMI 23-24.9, Obesity = SDS >+2 OR BMI ≥25
          ("ให้วินิจฉัยตามเกณฑ์ที่รุนแรงกว่า" -- whichever criterion is more severe wins) */
function bmiClassification(ageYr, bmiVal, z) {
  if (ageYr < 5) {
    if (z > 3) return 'Obesity';
    if (z > 2) return 'Overweight';
    return null;
  }
  if (z > 2 || bmiVal >= 25) return 'Obesity';
  if (z > 1 || bmiVal >= 23) return 'Overweight';
  return null;
}
function bandOfBmi(ageYr, bmiVal, z) {
  const cls = bmiClassification(ageYr, bmiVal, z);
  return cls ? [cls, true] : bandOfZ(z);
}

function renderResults() {
  const box = document.getElementById('results');
  const mode = curMode(), ind = curIndicators();
  const rows = [];
  for (const v of sortedVisits(mode)) {
    const xv = xOfVisit(mode, v);
    const cells = mode.panels.map(P => {
      const val = P.yOf(v);
      if (!isFinite(val)) return { v: '—', z: '—', pc: '—', b: '' };
      const p = ind[P.indicator][S.sex](xv);
      if (!p) return { v: val.toFixed(1), z: 'นอกช่วง', pc: '—', b: '' };
      const z = zFromValue(p, val);
      if (P.band === 'z') {
        const [lbl, bad] = P.indicator === 'bmi' ? bandOfBmi(xv, val, z) : bandOfZ(z);
        return { v: val.toFixed(1), z: (z >= 0 ? '+' : '') + z.toFixed(2), pc: '—', b: `<span class="band${bad ? ' out' : ''}">${lbl}</span>` };
      }
      const pc = pctFromZ(z), [lbl, bad] = bandOfPct(pc);
      return { v: val.toFixed(1), z: (z >= 0 ? '+' : '') + z.toFixed(2), pc: pc.toFixed(1), b: `<span class="band${bad ? ' out' : ''}">${lbl}</span>` };
    });
    const xLabel = mode.xKind === 'height' ? xv.toFixed(1) : xv.toFixed(2);
    let row = `<td>${esc(v.date || '—')}</td><td>${xLabel}</td>`;
    cells.forEach((c, i) => { row += `<td>${c.v}</td><td>${c.z}</td>` + (mode.panels[i].band === 'z' ? '' : `<td>${c.pc}</td>`) + `<td>${c.b}</td>`; });
    rows.push(`<tr>${row}</tr>`);
  }
  if (!rows.length) { box.innerHTML = '<p class="empty">ใส่ข้อมูลเพื่อดูผล</p>'; return; }
  let head = `<th>วันที่</th><th>${mode.xKind === 'height' ? 'ส่วนสูง' : 'อายุ (ปี)'}</th>`;
  mode.panels.forEach(P => { head += `<th>${esc(P.title)}</th><th>Z</th>` + (P.band === 'z' ? '' : '<th>%ile</th>') + `<th>ช่วง</th>`; });
  box.innerHTML = `<table class="out"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/* ---------------------------------------------------------------
   8. UI
----------------------------------------------------------------*/
function visitFieldsForMode() {
  const mode = curMode();
  const cols = [{ k: 'date', label: 'วันที่วัด', type: 'date', w: '30%' }];
  if (mode.xKind === 'height' || mode.panels.some(p => p.indicator === 'height' || p.indicator === 'bmi'))
    cols.push({ k: 'ht', label: 'สูง (ซม.)', type: 'number' });
  if (mode.panels.some(p => p.indicator === 'weight_age' || p.indicator === 'bmi' || p.indicator === 'weight_height'))
    cols.push({ k: 'wt', label: 'นน. (กก.)', type: 'number' });
  if (mode.panels.some(p => p.indicator === 'hc'))
    cols.push({ k: 'hc', label: 'รอบศีรษะ (ซม.)', type: 'number' });
  return cols;
}

function renderVisitHead() {
  const cols = visitFieldsForMode();
  document.getElementById('visitHead').innerHTML =
    `<tr>${cols.map(c => `<th style="${c.w ? 'width:' + c.w : ''}">${c.label}</th>`).join('')}<th></th></tr>`;
}
function renderVisits() {
  const mode = curMode();
  const cols = visitFieldsForMode();
  document.getElementById('visitRows').innerHTML = S.visits.map((v, i) => {
    const age = (mode.xKind === 'age' && S.dob && v.date) ? ageYears(S.dob, v.date) : null;
    const dateWarn = age != null && age < 0;
    const tds = cols.map(c => {
      const warnAttr = (c.k === 'date' && dateWarn)
        ? ' class="warn-cell" title="วันที่วัดอยู่ก่อนวันเกิด — ตรวจสอบข้อมูล"' : '';
      return `<td${warnAttr}><input type="${c.type}" ${c.type === 'number' ? 'step="0.1"' : ''} data-i="${i}" data-k="${c.k}" value="${esc(v[c.k] || '')}" placeholder="—"></td>`;
    }).join('');
    return `<tr>${tds}<td><button class="mini" type="button" data-del="${i}" aria-label="ลบแถว">×</button></td></tr>`;
  }).join('');
}

function renderAll() {
  document.body.dataset.sex = S.sex;
  const mode = curMode();
  document.getElementById('dobField').style.display = mode.needsDob ? '' : 'none';
  document.getElementById('parentHeightField').style.display = mode.needsParents ? '' : 'none';
  document.getElementById('mphField').style.display = mode.needsParents ? '' : 'none';
  document.getElementById('refCard').style.display = mode.refSwappable ? '' : 'none';
  document.getElementById('styleField').style.display = mode.combinable ? '' : 'none';
  document.getElementById('modeHint').textContent = mode.hint;
  if (mode.refSwappable) {
    document.getElementById('refBadge').textContent = 'REF: ' + REFS[S.ref].label;
  } else {
    document.getElementById('refBadge').textContent = 'REF: TSPE (digitized)';
  }
  const mph = mode.needsParents ? midParental() : null;
  document.getElementById('mphOut').textContent = mph ? mph.toFixed(1) + ' ซม.' : '—';
  document.getElementById('chartTitle').textContent =
    (S.hn ? esc(S.hn) + ' · ' : '') + (S.sex === 'F' ? 'หญิง' : 'ชาย') + ' · ' + mode.label;
  document.getElementById('formulaNote').innerHTML = mode.panels[0].band === 'z'
    ? 'ค่าที่แสดงคือ z-score (SDS) ตรงจากตาราง LMS ที่สกัดจากกราฟ BMI Z-score ต้นฉบับของ TSPE โดยตรง'
    : 'z-score คำนวณด้วยวิธี LMS (Cole &amp; Green): <code>z = ((X/M)^L − 1) / (L·S)</code> เมื่อ L≠0 และ <code>z = ln(X/M)/S</code> เมื่อ L=0';
  renderChart();
  renderResults();
}

document.getElementById('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]'); if (!b) return;
  S.mode = b.dataset.mode;
  [...e.currentTarget.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  renderVisitHead(); renderVisits(); renderAll();
});
document.getElementById('sexSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-sex]'); if (!b) return;
  S.sex = b.dataset.sex;
  [...e.currentTarget.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  renderAll();
});
document.getElementById('styleSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-style]'); if (!b) return;
  S.chartStyle = b.dataset.style;
  [...e.currentTarget.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  renderAll();
});
for (const [id, key, num] of [['hn', 'hn', 0], ['dob', 'dob', 0], ['fh', 'fh', 1], ['mh', 'mh', 1]])
  document.getElementById(id).addEventListener('input', e => {
    S[key] = num ? (parseFloat(e.target.value) || null) : e.target.value;
    if (id === 'dob') renderVisits();
    renderAll();
  });

document.getElementById('visitRows').addEventListener('input', e => {
  const t = e.target; if (!t.dataset.k) return;
  S.visits[+t.dataset.i][t.dataset.k] = t.value;
  renderAll();
});
document.getElementById('visitRows').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'); if (!b) return;
  S.visits.splice(+b.dataset.del, 1);
  if (!S.visits.length) S.visits.push({ date: '', ht: '', wt: '', hc: '' });
  renderVisits(); renderAll();
});
document.getElementById('addRow').addEventListener('click', () => {
  S.visits.push({ date: '', ht: '', wt: '', hc: '' }); renderVisits();
});

const DEMOS = {
  ht_wt: () => ({
    sex: 'F', hn: '68-04027', dob: '2015-06-20', fh: 163, mh: 162,
    visits: [
      { date: '2024-07-15', ht: '126.5', wt: '27.0', hc: '' },
      { date: '2025-01-20', ht: '129.8', wt: '29.4', hc: '' },
      { date: '2025-07-18', ht: '133.0', wt: '31.8', hc: '' },
      { date: '2026-01-16', ht: '136.9', wt: '34.9', hc: '' }
    ]
  }),
  bmi: () => ({
    sex: 'M', hn: '68-04027', dob: '2020-03-10', fh: null, mh: null,
    visits: [
      { date: '2023-03-10', ht: '95.0', wt: '17.5', hc: '' },
      { date: '2024-03-10', ht: '102.5', wt: '20.8', hc: '' },
      { date: '2025-03-10', ht: '109.0', wt: '23.9', hc: '' },
      { date: '2026-03-10', ht: '115.5', wt: '27.6', hc: '' }
    ]
  }),
  hc: () => ({
    sex: 'M', hn: '68-04027', dob: '2025-09-01', fh: null, mh: null,
    visits: [
      { date: '2025-10-01', ht: '', wt: '', hc: '37.2' },
      { date: '2025-12-01', ht: '', wt: '', hc: '40.5' },
      { date: '2026-03-01', ht: '', wt: '', hc: '42.8' },
      { date: '2026-06-01', ht: '', wt: '', hc: '44.6' }
    ]
  }),
  wfh: () => ({
    sex: 'F', hn: '68-04027', dob: '', fh: null, mh: null,
    visits: [
      { date: '2025-07-18', ht: '133.0', wt: '31.8', hc: '' },
      { date: '2026-01-16', ht: '136.9', wt: '34.9', hc: '' }
    ]
  })
};
document.getElementById('btnDemo').addEventListener('click', () => {
  const d = DEMOS[S.mode]();
  Object.assign(S, d);
  hn.value = S.hn; dob.value = S.dob; fh.value = S.fh ?? ''; mh.value = S.mh ?? '';
  [...document.getElementById('sexSeg').children].forEach(x => x.setAttribute('aria-pressed', x.dataset.sex === S.sex));
  renderVisitHead(); renderVisits(); renderAll();
});
document.getElementById('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (S.hn ? S.hn.replace(/[^\w-]/g, '_') : 'growth') + '_' + S.mode + '.json';
  a.click(); URL.revokeObjectURL(a.href);
});
document.getElementById('btnPrint').addEventListener('click', () => window.print());

document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileLms').click());
document.getElementById('fileLms').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const need = ['height_M', 'height_F', 'weight_M', 'weight_F'];
    if (!need.every(k => Array.isArray(j[k]) && j[k].length > 1 && j[k][0].length === 4))
      throw new Error('ต้องมีคีย์ ' + need.join(', ') + ' และแต่ละแถวเป็น [อายุเดือน, L, M, S]');
    const id = 'imported';
    REFS[id] = { label: (j.label || f.name.replace(/\.json$/, '')), tables: j };
    const sel = document.getElementById('refSel');
    if (!sel.querySelector(`option[value="${id}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${id}">${esc(REFS[id].label)}</option>`);
    sel.value = id; S.ref = id; renderAll();
  } catch (err) {
    alert('นำเข้าไม่ได้: ' + err.message);
  }
  e.target.value = '';
});
document.getElementById('refSel').addEventListener('change', e => { S.ref = e.target.value; renderAll(); });

/* ---------------------------------------------------------------
   9. PDF export
----------------------------------------------------------------*/
const TITLES = {
  ht_wt: sex => `${sex === 'M' ? 'Boys' : 'Girls'}: Height/Length and Weight for Age`,
  bmi: sex => `${sex === 'M' ? 'Boys' : 'Girls'}: BMI Z-score (SDS) for Age`,
  hc: sex => `${sex === 'M' ? 'Boys' : 'Girls'} aged 0-5 years: Head Circumference`,
  wfh: sex => `${sex === 'M' ? 'Boys' : 'Girls'} aged 2-19 years: Weight for Height`
};

document.getElementById('btnPdf').addEventListener('click', async () => {
  const btn = document.getElementById('btnPdf');
  const origLabel = btn.textContent;
  btn.textContent = 'กำลังสร้าง…'; btn.disabled = true;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('ไม่พบไลบรารี jsPDF');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    if (window.__thaiFontsB64) {
      doc.addFileToVFS('IBMPlexSansThai-Regular.ttf', window.__thaiFontsB64.regular);
      doc.addFont('IBMPlexSansThai-Regular.ttf', 'ThaiSans', 'normal');
      doc.addFileToVFS('IBMPlexSansThai-Bold.ttf', window.__thaiFontsB64.bold);
      doc.addFont('IBMPlexSansThai-Bold.ttf', 'ThaiSans', 'bold');
    }
    const FONT = window.__thaiFontsB64 ? 'ThaiSans' : 'helvetica';

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    const mode = curMode();
    const mph = mode.needsParents ? midParental() : null;
    const sexTh = S.sex === 'F' ? 'หญิง' : 'ชาย';

    const bg = S.sex === 'F' ? [253, 240, 244] : [235, 246, 251];
    doc.setFillColor(...bg); doc.rect(0, 0, pageW, pageH, 'F');

    doc.setFont(FONT, 'bold'); doc.setFontSize(15);
    doc.text(TITLES[S.mode](S.sex), margin, 18);
    doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(90);
    doc.text('THAI SOCIETY for PEDIATRIC ENDOCRINOLOGY (recreated layout, demo)', pageW - margin, 14, { align: 'right' });
    doc.text('Reference: ' + (mode.refSwappable ? REFS[S.ref].label : 'TSPE (digitized from source PDF)'), pageW - margin, 19, { align: 'right' });
    doc.setTextColor(0);

    doc.setFontSize(10);
    let y = 27;
    doc.text(`ชื่อ/HN: ${S.hn || '-'}     เพศ: ${sexTh}` + (mode.needsDob ? `     DOB: ${S.dob || '-'}` : ''), margin, y);
    y += 6;
    if (mode.needsParents) {
      doc.text(`ส่วนสูงพ่อ: ${S.fh ?? '-'} ซม.   ส่วนสูงแม่: ${S.mh ?? '-'} ซม.   Mid-parental height: ${mph ? mph.toFixed(1) + ' ซม.' : '-'}`, margin, y);
      y += 6;
    }
    y += 2;

    const svgEl = document.getElementById('svg');
    const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity',
      'opacity', 'stroke-linejoin', 'stroke-linecap', 'font-family', 'font-size', 'font-weight', 'text-anchor'];
    function bakeStyles(srcEl, dstEl) {
      const cs = getComputedStyle(srcEl);
      for (const prop of STYLE_PROPS) { const v = cs.getPropertyValue(prop); if (v) dstEl.setAttribute(prop, v.trim()); }
      if (window.__thaiFontsB64 && (srcEl.tagName === 'text' || srcEl.tagName === 'tspan')) {
        dstEl.setAttribute('font-family', 'ThaiSans');
        const w = parseInt(cs.getPropertyValue('font-weight'), 10) || 400;
        dstEl.setAttribute('font-weight', w >= 600 ? 'bold' : 'normal');
      }
      dstEl.removeAttribute('class');
      const sk = srcEl.children, dk = dstEl.children;
      for (let i = 0; i < sk.length; i++) bakeStyles(sk[i], dk[i]);
    }
    const svgClone = svgEl.cloneNode(true);
    bakeStyles(svgEl, svgClone);
    const svgW = pageW - margin * 2;
    const vb = svgEl.viewBox.baseVal;
    const svgH = svgW * (vb.height / vb.width);
    await doc.svg(svgClone, { x: margin, y, width: svgW, height: svgH });
    y += svgH + 8;

    doc.setFont(FONT, 'bold'); doc.setFontSize(10);
    doc.text('ผลการคำนวณ', margin, y); y += 5;
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5);
    const xColLabel = mode.xKind === 'height' ? 'สูง(ซม)' : 'อายุ(ปี)';
    let headers = ['วันที่', xColLabel];
    mode.panels.forEach(P => { headers.push(P.shortTitle || P.title, 'Z', P.band === 'z' ? 'ช่วง' : '%ile', P.band === 'z' ? null : 'ช่วง'); });
    headers = headers.filter(h => h !== null);
    const colW = (pageW - margin * 2) / headers.length;
    const colX = headers.map((_, i) => margin + i * colW);
    headers.forEach((h, i) => doc.text(h, colX[i], y));
    y += 1.5;
    doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(margin, y, pageW - margin, y);
    y += 4;

    const ind = curIndicators();
    for (const v of sortedVisits(mode)) {
      const xv = xOfVisit(mode, v);
      const row = [v.date || '-', mode.xKind === 'height' ? xv.toFixed(1) : xv.toFixed(2)];
      for (const P of mode.panels) {
        const val = P.yOf(v);
        const p = isFinite(val) ? ind[P.indicator][S.sex](xv) : null;
        const z = p ? zFromValue(p, val) : null;
        row.push(isFinite(val) ? val.toFixed(1) : '-');
        row.push(z != null ? (z >= 0 ? '+' : '') + z.toFixed(2) : '-');
        if (z == null) { row.push('-'); if (P.band !== 'z') row.push('-'); }
        else if (P.band === 'z') row.push((P.indicator === 'bmi' ? bandOfBmi(xv, val, z) : bandOfZ(z))[0]);
        else { const pc = pctFromZ(z); row.push(pc.toFixed(1)); row.push(bandOfPct(pc)[0]); }
      }
      row.forEach((c, i) => doc.text(String(c), colX[i], y));
      y += 5;
      if (y > pageH - 20) { doc.addPage(); doc.setFillColor(...bg); doc.rect(0, 0, pageW, pageH, 'F'); y = 16; }
    }

    doc.setFontSize(6.5); doc.setTextColor(140);
    doc.text('สร้างจาก Growth Chart Plotter (โปรแกรมสาธิต) · z-score/percentile คำนวณด้วยวิธี LMS (Cole & Green) จากตาราง LMS ที่สกัดจากกราฟต้นฉบับของ TSPE (ไม่ใช่ตารางทางการ) · ไม่ใช่เอกสารทางการแพทย์ฉบับสมบูรณ์ และไม่ได้ใช้โลโก้/ลิขสิทธิ์ของ TSPE',
      margin, pageH - 8, { maxWidth: pageW - margin * 2 });

    const fname = (S.hn ? S.hn.replace(/[^\w-]/g, '_') : 'growth-chart') + '_' + S.mode + '.pdf';
    doc.save(fname);
  } catch (err) {
    console.error(err);
    alert('สร้าง PDF ไม่สำเร็จ: ' + err.message);
  } finally {
    btn.textContent = origLabel; btn.disabled = false;
  }
});

renderVisitHead();
renderVisits();
renderAll();
