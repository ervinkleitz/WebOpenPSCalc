/**
 * refineFix.js — JS port of core/calculators/modifiers/refine_fix.py
 * Adds the deterministic refine bonus (atk2) after defense.
 */
const { loader } = require("../../dataLoader");
const { addFlat, pmfStats } = require("../../pmf");

// Hercules excludes the post-DEF refine atk2 for these two skills (battle.c:5372).
// Keyed by name — NOT id — because the numeric ids drifted (263/264 are actually
// MO_TRIPLEATTACK/MO_BODYRELOCATION here; Investigate/Asura are 266/271), which
// previously suppressed refine on the wrong skills. masteryFix/defenseFix also key by name.
const REFINE_SKIP_SKILLS = new Set(["MO_INVESTIGATE", "MO_EXTREMITYFIST"]);

function calculateRefineFix(weapon, skill, pmf, result) {
  if (REFINE_SKIP_SKILLS.has(skill.name)) {
    result.add_step({ name: "Refine Bonus", value: 0, note: "Suppressed for MO_INVESTIGATE/MO_EXTREMITYFIST", formula: "0", hercules_ref: "battle.c:5372" });
    return pmf;
  }

  const refineBonus = loader.getRefineBonus(weapon.level, weapon.refine);
  if (refineBonus === 0) {
    result.add_step({ name: "Refine Bonus", value: 0, note: "No refine bonus", formula: "atk2 = 0", hercules_ref: "battle.c:5803-5805" });
    return pmf;
  }

  pmf = addFlat(pmf, refineBonus);
  const [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: "Refine Bonus", value: av, min_value: mn, max_value: mx,
    note: `+${weapon.refine} refine on Lv ${weapon.level} weapon → flat +${refineBonus}`,
    formula: `damage + atk2(${refineBonus})`, hercules_ref: "battle.c:5797-5805",
  });
  return pmf;
}

module.exports = { calculateRefineFix };
