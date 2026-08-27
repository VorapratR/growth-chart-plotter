'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bandOfPct, bandOfZ, bmiClassification, bandOfBmi, velocity, fmtVelocity, VEL_MIN_YEARS,
} = require('../../src/engine.js');

/* ---- TSPE official BMI-for-age Overweight / Obesity criteria ----
   Source chart rules:
     age < 5y : Overweight = SDS > +2 (to +3),  Obesity = SDS > +3
     age >= 5y: Overweight = SDS > +1  OR BMI >= 23,  Obesity = SDS > +2 OR BMI >= 25
   The cutoffs are strict `>` on z and `>=` on the absolute BMI. */
test('bmiClassification — under 5 years, z-score only', () => {
  assert.equal(bmiClassification(3, 15, 1.9), null);
  assert.equal(bmiClassification(3, 15, 2.0), null);          // exactly +2 is NOT overweight (strict >)
  assert.equal(bmiClassification(3, 15, 2.01), 'Overweight');
  assert.equal(bmiClassification(3, 15, 3.0), 'Overweight');  // exactly +3 is still overweight, not obese
  assert.equal(bmiClassification(3, 15, 3.01), 'Obesity');
  assert.equal(bmiClassification(4.99, 40, 0), null);         // absolute BMI is irrelevant under 5
});

test('bmiClassification — 5 years and over, z OR absolute BMI (more severe wins)', () => {
  assert.equal(bmiClassification(5, 18, 1.0), null);
  assert.equal(bmiClassification(5, 18, 1.01), 'Overweight'); // z just over +1
  assert.equal(bmiClassification(10, 18, 2.0), 'Overweight'); // z exactly +2 -> not yet obese
  assert.equal(bmiClassification(10, 18, 2.01), 'Obesity');
  assert.equal(bmiClassification(12, 22.9, -1), null);        // low z, BMI just under 23
  assert.equal(bmiClassification(12, 23, -1), 'Overweight');  // BMI cutoff is inclusive
  assert.equal(bmiClassification(12, 24.9, -1), 'Overweight');
  assert.equal(bmiClassification(12, 25, -1), 'Obesity');     // BMI >= 25 -> obese regardless of z
  assert.equal(bmiClassification(15, 26, 0.2), 'Obesity');    // z says normal, BMI says obese -> obese
});

test('the age 5 boundary flips which rule set applies', () => {
  // z = +1.5, BMI 24: under 5 -> nothing (only >+2 counts); at 5 -> overweight (z>+1 and BMI>=23)
  assert.equal(bmiClassification(4.99, 24, 1.5), null);
  assert.equal(bmiClassification(5.0, 24, 1.5), 'Overweight');
});

test('bandOfBmi returns the classification (flagged) or falls back to the z band', () => {
  assert.deepEqual(bandOfBmi(10, 30, 3), ['Obesity', true]);
  assert.deepEqual(bandOfBmi(10, 16, 0), bandOfZ(0));         // normal -> plain z band, not flagged
  assert.equal(bandOfBmi(10, 16, 0)[1], false);
});

test('bandOfPct edges and out-of-range flags', () => {
  assert.deepEqual(bandOfPct(2.9), ['< P3', true]);
  assert.deepEqual(bandOfPct(3), ['P3–P10', false]);          // exactly P3 is in-band
  assert.deepEqual(bandOfPct(50), ['P50–P75', false]);
  assert.deepEqual(bandOfPct(97), ['P90–P97', false]);
  assert.deepEqual(bandOfPct(97.1), ['> P97', true]);
});

test('bandOfZ edges and out-of-range flags', () => {
  assert.deepEqual(bandOfZ(-3.1), ['< -3 SD', true]);
  assert.deepEqual(bandOfZ(-3), ['-3 to -2 SD', false]);
  assert.deepEqual(bandOfZ(0), ['0 to 1 SD', false]);
  assert.deepEqual(bandOfZ(3), ['2 to 3 SD', false]);
  assert.deepEqual(bandOfZ(3.1), ['> +3 SD', true]);
});

/* ---- growth velocity ---- */
test('velocity: annualized rate over a valid interval', () => {
  const rate = velocity({ x: 6.0, val: 116 }, 7.0, 122);      // +6 cm over 1.0 y
  assert.ok(Math.abs(rate - 6) < 1e-9);
});

test('velocity: short intervals are rejected (no noise amplification)', () => {
  const twoDays = 2 / 365.2425;
  assert.equal(velocity({ x: 5, val: 110 }, 5 + twoDays, 110.2), null);
  assert.equal(velocity({ x: 5, val: 110 }, 5 + VEL_MIN_YEARS - 1e-6, 111), null);
  assert.ok(velocity({ x: 5, val: 110 }, 5 + VEL_MIN_YEARS + 1e-6, 111) !== null);
});

test('velocity: negative-age endpoints are rejected', () => {
  assert.equal(velocity({ x: -0.5, val: 50 }, 1.0, 76), null);   // anchor before DOB
  assert.equal(velocity({ x: 0.5, val: 68 }, -0.2, 55), null);   // current visit before DOB
});

test('velocity: missing / non-finite value and no previous visit', () => {
  assert.equal(velocity(null, 5, 110), null);
  assert.equal(velocity({ x: 4, val: 100 }, 5, NaN), null);
});

test('fmtVelocity: sign, rounding, and no negative zero', () => {
  assert.equal(fmtVelocity(null), '—');
  assert.equal(fmtVelocity(6.44), '+6.4');
  assert.equal(fmtVelocity(-2.17), '-2.2');
  assert.equal(fmtVelocity(-0.04), '0.0');    // rounds to zero -> unsigned, not "-0.0"
  assert.equal(fmtVelocity(0.04), '0.0');
});
