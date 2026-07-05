/**
 * pmf.js — JS port of pmf/operations.py and pmf/single_hit.py
 *
 * All functions operate on a Map-like plain object { [damageValue]: probability }
 * where probabilities sum to 1.0. Kept as plain objects (not Map) since these
 * get serialized to JSON for API responses.
 */

function uniformPmf(lo, hi) {
  const n = hi - lo + 1;
  const p = 1.0 / n;
  const out = {};
  for (let v = lo; v <= hi; v++) out[v] = p;
  return out;
}

function scaleFloor(pmf, num, denom) {
  if (num === denom) return pmf;
  const out = {};
  for (const [vStr, p] of Object.entries(pmf)) {
    const v = Number(vStr);
    const key = Math.floor((v * num) / denom);
    out[key] = (out[key] || 0) + p;
  }
  return out;
}

// Apply a uniform range of scaling numerators to the pmf: for each numerator
// num in [numLo, numHi] (step `step`, equally likely), result += floor(v*num/denom).
// Used where the scaling factor itself varies with the target's random soft DEF
// (MO_INVESTIGATE and def-ratio cards, where damage = pdef*(def1+vit_def)), so the
// output keeps a real min–max range instead of collapsing to the average factor.
function scaleFloorNumRange(pmf, numLo, numHi, step, denom) {
  if (numLo >= numHi) return scaleFloor(pmf, numLo, denom);
  const count = Math.floor((numHi - numLo) / step) + 1;
  const w = 1.0 / count;
  const out = {};
  for (let num = numLo; num <= numHi; num += step) {
    for (const [vStr, p] of Object.entries(pmf)) {
      const key = Math.floor((Number(vStr) * num) / denom);
      out[key] = (out[key] || 0) + p * w;
    }
  }
  return out;
}

function addFlat(pmf, flat) {
  if (flat === 0) return pmf;
  const out = {};
  for (const [vStr, p] of Object.entries(pmf)) {
    out[Number(vStr) + flat] = p;
  }
  return out;
}

function convolve(pmf, other) {
  const out = {};
  for (const [v1Str, p1] of Object.entries(pmf)) {
    const v1 = Number(v1Str);
    for (const [v2Str, p2] of Object.entries(other)) {
      const key = v1 + Number(v2Str);
      out[key] = (out[key] || 0) + p1 * p2;
    }
  }
  return out;
}

function subtractUniform(pmf, lo, hi) {
  if (lo === hi) return addFlat(pmf, -lo);
  const negUniform = uniformPmf(-hi, -lo);
  return convolve(pmf, negUniform);
}

function floorAt(pmf, n = 1) {
  const out = {};
  let floorMass = 0;
  for (const [vStr, p] of Object.entries(pmf)) {
    const v = Number(vStr);
    if (v >= n) out[v] = p;
    else floorMass += p;
  }
  if (floorMass > 0) out[n] = (out[n] || 0) + floorMass;
  return out;
}

function pmfStats(pmf) {
  const keys = Object.keys(pmf).map(Number);
  let mu = 0;
  for (const k of keys) mu += k * pmf[k];
  return [Math.min(...keys), Math.max(...keys), Math.floor(mu)];
}

function pmfMean(pmf) {
  let mu = 0;
  for (const [vStr, p] of Object.entries(pmf)) mu += Number(vStr) * p;
  return mu;
}

module.exports = {
  uniformPmf,
  scaleFloor,
  scaleFloorNumRange,
  addFlat,
  convolve,
  subtractUniform,
  floorAt,
  pmfStats,
  pmfMean,
};
