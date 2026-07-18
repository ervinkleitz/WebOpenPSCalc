/**
 * forgeBonus.js — JS port of core/calculators/modifiers/forge_bonus.py
 * Forged weapon star crumb ATK bonus, applied after AttrFix and before CardFix.
 */
const { pmfStats } = require("../../pmf");

// Monk line that gets the Call Spirits sphere ATK bonus (Monk 15, Champion 4016).
const MONK_LINE_JOBS = new Set([15, 4016]);

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

/**
 * Spirit Sphere ATK bonus (Monk line). PS wiki: each sphere grants +3 ATK
 * "similar to forged weapons imbued with Star Crumb" — a flat, per-hit add that
 * ignores enemy DEF & flee, is affected by cards but not elements. So it's applied
 * at the same pipeline position as the Star Crumb forge bonus (after AttrFix/DEF,
 * before CardFix), NOT folded into base ATK (which would wrongly scale it by the
 * skill ratio and, on Asura, by ×(8+SP/10)). Vanilla Hercules applies it as
 * ATK_ADD(div * spiritball * 3) right next to the Star Crumb add (battle.c:5439-5441).
 * `div` is the skill's hit count (Finger Offensive throws N ⇒ div=N; most skills div=1).
 */
function calculateSpiritSphereBonus(build, div, pmf, result) {
  const spheres = Math.max(0, Math.min(15, build.spirit_spheres || 0));
  if (spheres <= 0 || !MONK_LINE_JOBS.has(build.job_id)) return pmf;

  const flat = spheres * 3 * div;
  const outPmf = {};
  for (const [k, v] of Object.entries(pmf)) outPmf[Number(k) + flat] = v;

  const [mn, mx, av] = pmfStats(outPmf);
  result.add_step({
    name: "Spirit Sphere Bonus", value: av, min_value: mn, max_value: mx,
    note: `${spheres} sphere(s) × 3 ATK × div${div} = +${flat} flat (Star Crumb-like; ignores DEF/flee)`,
    formula: `spheres(${spheres}) × 3 × div(${div}) = +${flat}`,
    hercules_ref: "battle.c:5439-5441; wiki.payonstories.com/Call_Spirits",
  });
  return outPmf;
}

module.exports = { calculateForgeBonus, calculateSpiritSphereBonus };
