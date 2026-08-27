'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lmsAt, valueFromZ, splice, fixed } = require('../../src/engine.js');

const ROOT = path.join(__dirname, '..', '..');

/* The data files are plain `const REF_x = {...}` scripts (concatenated into
   the bundle, not modules). Evaluate them in a function scope and hand back
   the named bindings. */
function loadData() {
  const names = [
    'REF_TSPE2565', 'REF_CDC2000',
    'REF_LENGTH_0TO2_M', 'REF_LENGTH_0TO2_F', 'REF_WEIGHT_0TO2_M', 'REF_WEIGHT_0TO2_F',
    'REF_BMI_BOY_0_5', 'REF_BMI_BOY_5_19', 'REF_BMI_GIRL_0_5', 'REF_BMI_GIRL_5_19',
    'REF_HEADCIRC_M', 'REF_HEADCIRC_F', 'REF_WFH_M', 'REF_WFH_F',
  ];
  const code =
    fs.readFileSync(path.join(ROOT, 'src/data/tspe_lms_and_cdc.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(ROOT, 'src/data/all_new_lms.js'), 'utf8') + '\n' +
    `return { ${names.join(', ')} };`;
  return new Function(code)();
}
const D = loadData();
const PCT_Z = { 3: -1.880794, 10: -1.281552, 25: -0.674490, 50: 0, 75: 0.674490, 90: 1.281552, 97: 1.880794 };

/* ---- every table is well-formed ---- */
const FLAT_TABLES = {
  REF_LENGTH_0TO2_M: D.REF_LENGTH_0TO2_M, REF_LENGTH_0TO2_F: D.REF_LENGTH_0TO2_F,
  REF_WEIGHT_0TO2_M: D.REF_WEIGHT_0TO2_M, REF_WEIGHT_0TO2_F: D.REF_WEIGHT_0TO2_F,
  REF_BMI_BOY_0_5: D.REF_BMI_BOY_0_5, REF_BMI_BOY_5_19: D.REF_BMI_BOY_5_19,
  REF_BMI_GIRL_0_5: D.REF_BMI_GIRL_0_5, REF_BMI_GIRL_5_19: D.REF_BMI_GIRL_5_19,
  REF_HEADCIRC_M: D.REF_HEADCIRC_M, REF_HEADCIRC_F: D.REF_HEADCIRC_F,
  REF_WFH_M: D.REF_WFH_M, REF_WFH_F: D.REF_WFH_F,
};
for (const [tName, t] of Object.entries(D.REF_TSPE2565).map(([k, v]) => [`REF_TSPE2565.${k}`, v]))
  FLAT_TABLES[tName] = t;
for (const [tName, t] of Object.entries(D.REF_CDC2000).map(([k, v]) => [`REF_CDC2000.${k}`, v]))
  FLAT_TABLES[tName] = t;

test('every LMS table is [x,L,M,S] rows with strictly increasing x and positive M,S', () => {
  for (const [name, tab] of Object.entries(FLAT_TABLES)) {
    assert.ok(Array.isArray(tab) && tab.length >= 2, `${name}: not a non-trivial array`);
    for (let i = 0; i < tab.length; i++) {
      const row = tab[i];
      assert.equal(row.length, 4, `${name}[${i}]: expected 4 columns`);
      assert.ok(row.every(Number.isFinite), `${name}[${i}]: non-finite value`);
      assert.ok(row[2] > 0, `${name}[${i}]: M must be > 0`);
      assert.ok(row[3] > 0, `${name}[${i}]: S must be > 0`);
      if (i > 0) assert.ok(row[0] > tab[i - 1][0], `${name}[${i}]: x not strictly increasing`);
    }
  }
});

test('REF_TSPE2565 / REF_CDC2000 expose the height_/weight_ M+F keys main.js expects', () => {
  for (const ref of [D.REF_TSPE2565, D.REF_CDC2000])
    for (const k of ['height_M', 'height_F', 'weight_M', 'weight_F'])
      assert.ok(Array.isArray(ref[k]) && ref[k].length > 1, `missing ${k}`);
});

/* ---- the boundary cases HANDOFF.md explicitly says to re-verify ----
   Rebuild the same indicator composition main.js's indicators() uses. */
const yr2mo = x => x * 12;
const IND = {
  height: {
    M: splice(D.REF_LENGTH_0TO2_M, D.REF_TSPE2565.height_M, 24, yr2mo),
    F: splice(D.REF_LENGTH_0TO2_F, D.REF_TSPE2565.height_F, 24, yr2mo),
  },
  weight_age: {
    M: splice(D.REF_WEIGHT_0TO2_M, D.REF_TSPE2565.weight_M, 24, yr2mo),
    F: splice(D.REF_WEIGHT_0TO2_F, D.REF_TSPE2565.weight_F, 24, yr2mo),
  },
  bmi: {
    M: splice(D.REF_BMI_BOY_0_5, D.REF_BMI_BOY_5_19, 60, yr2mo),
    F: splice(D.REF_BMI_GIRL_0_5, D.REF_BMI_GIRL_5_19, 60, yr2mo),
  },
  hc: { M: fixed(D.REF_HEADCIRC_M, yr2mo), F: fixed(D.REF_HEADCIRC_F, yr2mo) },
};

test('indicators resolve at age 0, the 24mo and 60mo splice seams, and age 19y', () => {
  for (const sex of ['M', 'F']) {
    for (const ind of ['height', 'weight_age', 'bmi']) {
      for (const ageYr of [0, 1.999, 2.0, 2.001, 4.999, 5.0, 5.001, 18.99, 19.0]) {
        const p = IND[ind][sex](ageYr);
        assert.ok(p && Number.isFinite(p.M), `${ind} ${sex} @ ${ageYr}y did not resolve`);
      }
    }
    for (const ageYr of [0, 2.5, 4.999, 5.0]) {
      const p = IND.hc[sex](ageYr);
      assert.ok(p && Number.isFinite(p.M), `hc ${sex} @ ${ageYr}y did not resolve`);
    }
  }
});

test('a value just past age 19y is out of range (null), not a silent extrapolation', () => {
  assert.equal(IND.height.M(19.5), null);
  assert.equal(IND.bmi.F(20), null);
});

test('P50 height rises monotonically with age across the whole 0-19y span', () => {
  let prev = -Infinity;
  for (let ageYr = 0; ageYr <= 19; ageYr += 0.5) {
    const p = IND.height.M(ageYr);
    if (!p) continue;
    const m = p.M;
    assert.ok(m > prev, `height M @ ${ageYr}y (${m}) did not exceed previous (${prev})`);
    prev = m;
  }
});

/* ---- closed-loop: shipped engine vs the digitized source curves ----
   For each digitized (x, value) point on a printed percentile/SDS line,
   predict value = valueFromZ(lmsAt(table, x), z) and measure the gap.
   HANDOFF.md: typical error < 0.05 unit, up to ~0.3 near seams. */
function closedLoop(rawFile, table, xToTableX, keyToZ) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'extraction/digitized_raw', rawFile), 'utf8'));
  const errs = [];
  let resolved = 0, total = 0;
  for (const [key, pts] of Object.entries(raw)) {
    const z = keyToZ(key);
    if (z === undefined) continue;
    for (const [x, actual] of pts) {
      total++;
      const p = lmsAt(table, xToTableX(x));
      if (!p) continue;
      resolved++;
      errs.push(Math.abs(valueFromZ(p, z) - actual));
    }
  }
  errs.sort((a, b) => a - b);
  return { median: errs[errs.length >> 1], p95: errs[Math.floor(errs.length * 0.95)], max: errs[errs.length - 1], resolvedFrac: resolved / total };
}

test('closed-loop: head circumference (boys & girls) reproduce the source curves', () => {
  for (const [file, table] of [['boys_hc_raw.json', D.REF_HEADCIRC_M], ['girls_hc_raw.json', D.REF_HEADCIRC_F]]) {
    const r = closedLoop(file, table, x => x * 12, k => PCT_Z[k]);
    assert.ok(r.resolvedFrac > 0.8, `${file}: only ${(r.resolvedFrac * 100) | 0}% of points in table domain`);
    assert.ok(r.median < 0.15, `${file}: median error ${r.median.toFixed(3)} cm too high`);
    assert.ok(r.p95 < 0.6, `${file}: p95 error ${r.p95.toFixed(3)} cm too high`);
  }
});

test('closed-loop: weight-for-height (boys & girls) reproduce the source curves', () => {
  for (const [file, table] of [['boys_wfh_raw.json', D.REF_WFH_M], ['girls_wfh_raw.json', D.REF_WFH_F]]) {
    const r = closedLoop(file, table, x => x, k => PCT_Z[k]);
    assert.ok(r.resolvedFrac > 0.8, `${file}: only ${(r.resolvedFrac * 100) | 0}% of points in table domain`);
    assert.ok(r.median < 0.2, `${file}: median error ${r.median.toFixed(3)} kg too high`);
    assert.ok(r.p95 < 1.0, `${file}: p95 error ${r.p95.toFixed(3)} kg too high`);
  }
});

test('closed-loop: BMI 0-5y (boys & girls) reproduce the source SDS curves', () => {
  for (const [file, table] of [['Boy-0-5_bmi_raw.json', D.REF_BMI_BOY_0_5], ['Girl-0-5_bmi_raw.json', D.REF_BMI_GIRL_0_5]]) {
    const r = closedLoop(file, table, x => x * 12, k => (Number.isNaN(+k) ? undefined : +k));
    assert.ok(r.resolvedFrac > 0.8, `${file}: only ${(r.resolvedFrac * 100) | 0}% resolved`);
    assert.ok(r.median < 0.2, `${file}: median error ${r.median.toFixed(3)} BMI too high`);
    assert.ok(r.p95 < 0.7, `${file}: p95 error ${r.p95.toFixed(3)} BMI too high`);
  }
});
