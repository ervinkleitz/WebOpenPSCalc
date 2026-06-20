/**
 * activeStatusBonus.js — JS port of core/calculators/modifiers/active_status_bonus.py
 * Pre-renewal flat/rate ATK bonuses from SC_* in the weapon-attack phase.
 */
const { loader } = require("../../dataLoader");
const { addFlat, scaleFloor, pmfStats } = require("../../pmf");
const { STANDARD } = require("../../serverProfiles");

function calculateActiveStatusBonus(weapon, build, skill, pmf, result, profile = STANDARD) {
  const activeStatusLevels = build.active_status_levels || {};
  let totalFlat = 0;
  let totalRate = 0;
  const appliedBonuses = [];

  for (const [scKey, level] of Object.entries(activeStatusLevels)) {
    const config = loader.getActiveStatusConfig(scKey);
    if (!config || !Object.keys(config).length) continue;

    const scType = config.type;
    let bonus = 0;

    if (scType === "flat_per_level") {
      bonus = level * (config.multiplier ?? 1);
    } else if (scType === "flat") {
      bonus = config.value || 0;
    }
    // complex_flat (SC_ENCHANTBLADE) / rate_chance (SC_GIANTGROWTH): NOT YET PORTED — see class docstring upstream.

    if (config.exclusions && config.exclusions.includes(skill.id)) bonus = 0;

    totalFlat += bonus;
    if (bonus) appliedBonuses.push(`${scKey} Lv${level} (+${bonus})`);
  }

  for (const [scKey, rate] of Object.entries(profile.rate_bonuses || {})) {
    if (scKey in activeStatusLevels) {
      totalRate += rate;
      appliedBonuses.push(`${scKey} PS +${rate}% damage`);
    }
  }

  let note, formula;
  if (appliedBonuses.length) {
    note = `Applied: ${appliedBonuses.join(", ")}`;
    formula = "dmg + flat bonuses; × rate% (PS profile)";
  } else if (!Object.keys(activeStatusLevels).length) {
    note = "No active statuses";
    formula = "dmg (no SC bonuses)";
  } else {
    note = "Applied: none";
    formula = "dmg (no matching SC bonuses)";
  }

  pmf = addFlat(pmf, totalFlat);
  if (totalRate) pmf = scaleFloor(pmf, 100 + totalRate, 100);

  const [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: "Active Status Bonuses", value: av, min_value: mn, max_value: mx,
    multiplier: totalRate ? (100 + totalRate) / 100 : 1.0,
    note, formula, hercules_ref: "battle.c battle_calc_weapon_attack (after add_mastery)",
  });
  return pmf;
}

module.exports = { calculateActiveStatusBonus };
