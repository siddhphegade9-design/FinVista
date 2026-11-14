'use strict';
/** Small, dependency-free statistics helpers. Money is integer paise throughout the insights modules. */

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

/** Population standard deviation (0 for fewer than 2 values). */
function stdDev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation. */
function mad(xs) {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Weighted mean where the oldest value has weight 1 and the newest weight n (recent months count more). */
function recencyWeightedMean(xs) {
  if (!xs.length) return 0;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += x * (i + 1); den += i + 1; });
  return num / den;
}

module.exports = { sum, mean, stdDev, median, mad, recencyWeightedMean };
