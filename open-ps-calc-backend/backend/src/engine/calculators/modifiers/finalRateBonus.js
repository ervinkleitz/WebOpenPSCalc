/**
 * finalRateBonus.js — JS port of core/calculators/modifiers/final_rate_bonus.py
 */
const { scaleFloor, floorAt, pmfStats } = require("../../pmf");

function calculateFinalRateBonus(isRanged, pmf, config, result) {
  const slRate = isRanged ? config.long_attack_damage_rate : config.short_attack_damage_rate;
  const slLabel = isRanged ? "Long" : "Short";

  pmf = scaleFloor(pmf, slRate, 100);
  let [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: `Final Rate Bonus (${slLabel})`, value: av, min_value: mn, max_value: mx, multiplier: slRate / 100,
    note: `${slLabel} attack damage rate: ${slRate}%`, formula: `dmg * ${slRate} // 100`,
    hercules_ref: "battle.c short/long_attack_damage_rate",
  });

  pmf = scaleFloor(pmf, config.weapon_damage_rate, 100);
  pmf = floorAt(pmf, 1);
  [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: "Final Rate Bonus (Weapon)", value: av, min_value: mn, max_value: mx, multiplier: config.weapon_damage_rate / 100,
    note: `Weapon damage rate: ${config.weapon_damage_rate}%`, formula: `dmg * ${config.weapon_damage_rate} // 100`,
    hercules_ref: "battle.c weapon_damage_rate",
  });
  return pmf;
}

module.exports = { calculateFinalRateBonus };
