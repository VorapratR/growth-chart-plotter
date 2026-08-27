'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lmsAt, zFromValue, valueFromZ, erfc, pctFromZ, ageYears, splice, fixed } = require('../../src/engine.js');

/* A synthetic LMS table: [xMonths, L, M, S], strictly increasing x. */
const TAB = [
  [0, 1, 50, 0.04],
  [12, 0.8, 76, 0.038],
  [24, 0.6, 88, 0.037],
  [36, 0.5, 96, 0.037],
  [60, 0.2, 110, 0.038],
];

test('valueFromZ at z=0 returns M', () => {
  for (const row of TAB) {
    const p = { L: row[1], M: row[2], S: row[3] };
    assert.ok(Math.abs(valueFromZ(p, 0) - p.M) < 1e-9);
  }
});

test('zFromValue / valueFromZ round-trip (L != 0)', () => {
  const p = { L: 0.7, M: 90, S: 0.05 };
  for (const z of [-3, -2, -1.5, -0.5, 0, 0.5, 1.5, 2, 3]) {
    assert.ok(Math.abs(zFromValue(p, valueFromZ(p, z)) - z) < 1e-9, `z=${z}`);
  }
});

test('zFromValue / valueFromZ round-trip (L == 0 -> lognormal branch)', () => {
  const p = { L: 0, M: 16.5, S: 0.09 };
  for (const z of [-3, -1, 0, 1, 2.5]) {
    assert.ok(Math.abs(zFromValue(p, valueFromZ(p, z)) - z) < 1e-9, `z=${z}`);
  }
});

test('lmsAt returns the exact node value at a table x', () => {
  const p = lmsAt(TAB, 24);
  assert.equal(p.L, 0.6);
  assert.equal(p.M, 88);
  assert.equal(p.S, 0.037);
});

test('lmsAt interpolates monotonically between nodes for M', () => {
  const a = lmsAt(TAB, 12).M, mid = lmsAt(TAB, 18).M, b = lmsAt(TAB, 24).M;
  assert.ok(a < mid && mid < b, `${a} < ${mid} < ${b}`);
});

test('lmsAt boundary epsilon: just-outside within 0.1 still resolves, further out is null', () => {
  assert.ok(lmsAt(TAB, -0.05) !== null, 'x = -0.05 (within EPS of 0) should resolve');
  assert.ok(lmsAt(TAB, 60.09) !== null, 'x = 60.09 (within EPS of 60) should resolve');
  assert.equal(lmsAt(TAB, -0.5), null, 'x = -0.5 is out of range');
  assert.equal(lmsAt(TAB, 61), null, 'x = 61 is out of range');
});

test('lmsAt clamps the interpolation input to the table domain at the epsilon edge', () => {
  // a value 0.09 past the last node must not extrapolate past the node value
  assert.equal(lmsAt(TAB, 60.09).M, lmsAt(TAB, 60).M);
});

test('pctFromZ matches known standard-normal points', () => {
  // erfc() is the Numerical Recipes rational approximation (~1e-7 fractional
  // error), so allow a small slack -- still far tighter than display precision.
  assert.ok(Math.abs(pctFromZ(0) - 50) < 1e-4);
  assert.ok(Math.abs(pctFromZ(1.2815515655) - 90) < 1e-3);
  assert.ok(Math.abs(pctFromZ(-1.8807936081) - 3) < 1e-3);
  assert.ok(Math.abs(pctFromZ(1.959963985) - 97.5) < 1e-3);
});

test('pctFromZ is strictly increasing and bounded (0, 100)', () => {
  let prev = -1;
  for (let z = -4; z <= 4; z += 0.25) {
    const p = pctFromZ(z);
    assert.ok(p > 0 && p < 100, `z=${z} -> ${p}`);
    assert.ok(p > prev, `not increasing at z=${z}`);
    prev = p;
  }
});

test('erfc(0) === 1 and erfc is symmetric as 2 - erfc(-x)', () => {
  assert.ok(Math.abs(erfc(0) - 1) < 1e-6);
  for (const x of [0.3, 1, 2.2]) {
    assert.ok(Math.abs(erfc(x) + erfc(-x) - 2) < 1e-6, `x=${x}`);
  }
});

test('ageYears computes elapsed years and rejects bad input', () => {
  assert.ok(Math.abs(ageYears('2020-01-01', '2021-01-01') - 1) < 0.01);
  assert.ok(Math.abs(ageYears('2015-06-20', '2025-06-20') - 10) < 0.02);
  assert.equal(ageYears('not-a-date', '2021-01-01'), null);
  assert.equal(ageYears('2020-01-01', 'nope'), null);
  assert.ok(ageYears('2021-01-01', '2020-01-01') < 0, 'measurement before DOB -> negative');
});

test('splice picks the native table on each side of the seam and falls back across it', () => {
  const low = [[0, 1, 49, 0.04], [12, 1, 74, 0.038], [24, 1, 87, 0.037]];   // 0-2y
  const high = [[24, 1, 88, 0.037], [60, 1, 110, 0.038], [228, 1, 176, 0.04]]; // 2-19y
  const yr2mo = x => x * 12;
  const f = splice(low, high, 24, yr2mo);
  assert.ok(Math.abs(f(1).M - 74) < 1e-6, 'age 1y -> low table');           // 12 months
  assert.ok(Math.abs(f(5).M - 110) < 1e-6, 'age 5y -> high table');         // 60 months
  // a point only the OTHER table covers still resolves via the fallback
  assert.ok(f(0.5) !== null && f(19) !== null);
  assert.equal(f(null), null);
});

test('fixed wraps a single table and passes null through', () => {
  const f = fixed(TAB);
  assert.equal(f(24).M, 88);
  assert.equal(f(null), null);
  const g = fixed(TAB, x => x * 12);
  assert.equal(g(2).M, 88);   // 2 -> 24 months
});
