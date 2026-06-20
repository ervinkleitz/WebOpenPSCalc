/**
 * dpsCalculator.js — JS port of core/calculators/dps_calculator.py
 */
function calculateDps(attacks) {
  let totalDmg = 0;
  let totalTime = 0;
  for (const a of attacks) {
    totalDmg += a.chance * a.avg_damage;
    totalTime += a.chance * (a.pre_delay + a.post_delay);
  }
  if (totalTime === 0) return 0.0;
  return (totalDmg / totalTime) * 1000;
}

module.exports = { calculateDps };
