/* ---------------------------------------------------------------
   LMS engine — pure math, no DOM. Concatenated into the bundle
   ahead of main.js (which uses these as globals) and also require()d
   directly by tests/unit/. Keep it dependency- and side-effect-free.
----------------------------------------------------------------*/

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

/* Node/test entry point only -- `typeof module` is "undefined" in the browser
   bundle, so this block is skipped there. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lmsAt, zFromValue, valueFromZ, erfc, pctFromZ, ageYears, splice, fixed };
}
