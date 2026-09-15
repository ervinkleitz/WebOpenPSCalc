/**
 * critAtkRate.js — JS port of core/calculators/modifiers/crit_atk_rate.py
 * Applies sd->bonus.crit_atk_rate to the crit branch only, pre-defense.
 */
const { STANDARD } = require("../../serverProfiles");
const { scaleFloor, pmfStats } = require("../../pmf");

function calculateCritAtkRate(build, pmf, result, opts = {}) {
  const { weapon = null, profile = STANDARD, skill = null, gb = null } = opts;
  const rate = build.bonus_crit_atk_rate;
  let [mn, mx, av] = pmfStats(pmf);

  if (rate === 0) {
    result.add_step({ name: "Crit ATK Rate", value: av, min_value: mn, max_value: mx, note: "bonus.crit_atk_rate = 0", formula: "no change", hercules_ref: "battle.c:5333" });
  } else {
    pmf = scaleFloor(pmf, 100 + rate, 100);
    [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Crit ATK Rate", value: av, min_value: mn, max_value: mx, multiplier: (100 + rate) / 100, note: `bonus.crit_atk_rate = ${rate}%`, formula: `damage * (100 + ${rate}) / 100`, hercules_ref: "battle.c:5333" });
  }

  // PS Brutality status (Bonechewer Card): its own multiplier, not added into
  // crit_atk_rate above. Crit damage on PS comes in three separate buckets that stack
  // multiplicatively: gear (above), this status, and Katar Mastery Lv10 (below).
  const statusRate = build.bonus_status_crit_atk_rate || 0;
  if (statusRate !== 0) {
    pmf = scaleFloor(pmf, 100 + statusRate, 100);
    [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Brutality Crit Bonus", value: av, min_value: mn, max_value: mx, multiplier: (100 + statusRate) / 100, note: `Brutality status (Bonechewer Card) [PS]: ×${(100 + statusRate) / 100} crit damage, separate from gear crit damage and Katar Mastery`, formula: `damage * (100 + ${statusRate}) / 100`, hercules_ref: "PS item API: Bonechewer Card" });
  }

  const skillName = skill != null ? skill.name : "";
  const mastery = gb != null ? gb.effective_mastery : build.mastery_levels;
  if (
    profile.mechanic_flags.has("AS_KATAR_KATAR_CRIT_DMG_BONUS") &&
    weapon != null && weapon.weapon_type === "Katar" &&
    (mastery.AS_KATAR || 0) === 10 &&
    !["AS_SONICBLOW", "AS_GRIMTOOTH"].includes(skillName)
  ) {
    pmf = scaleFloor(pmf, 150, 100);
    [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "AS_KATAR Crit Bonus", value: av, min_value: mn, max_value: mx, multiplier: 1.5, note: "AS_KATAR lv10 [PS]: ×1.5 crit damage", formula: "damage * 150 / 100", hercules_ref: "PS-4" });
  }

  return pmf;
}

module.exports = { calculateCritAtkRate };
