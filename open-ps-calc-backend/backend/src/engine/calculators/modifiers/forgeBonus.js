/**
 * forgeBonus.js — JS port of core/calculators/modifiers/forge_bonus.py
 * Forged weapon star crumb ATK bonus, applied after AttrFix and before CardFix.
 */
const { pmfStats } = require("../../pmf");

function calculateForgeBonus(weapon, div, pmf, result) {
  const sc = weapon.forge_sc_count;
  if (sc === 0 && !weapon.forge_ranked) return pmf;

  let star = sc * 5;
  if (star >= 15) star = 40;
  if (weapon.forge_ranked) star += 10;
  if (star === 0) return pmf;

  const flat = star * div;
  const outPmf = {};
  for (const [k, v] of Object.entries(pmf)) outPmf[Number(k) + flat] = v;

  const [mn, mx, av] = pmfStats(outPmf);
  result.add_step({
    name: "Forge Bonus", value: av, min_value: mn, max_value: mx,
    note: `${sc} crumb(s)${weapon.forge_ranked ? "+ Ranked" : ""} → star=${star}, ×div${div} = +${flat} flat`,
    formula: `star(${star}) × div(${div}) = +${flat}`,
    hercules_ref: "status.c:1634-1643; battle.c:5864",
  });
  return outPmf;
}

module.exports = { calculateForgeBonus };
