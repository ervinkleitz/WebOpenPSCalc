/**
 * hitChance.js — JS port of core/calculators/modifiers/hit_chance.py
 */

// Per-skill accuracy bonuses. PR-Hercules battle.c "Hit skill modifiers" switch
// applies these as a percentage of the (pre-clamp) hitRATE, NOT of HIT — the
// engine comment there notes "it is proven that bonus is applied on final
// hitrate, not hit". Each entry returns the bonus % for the given skill level.
// Payon Stories reworked Holy Cross to grant a 20% accuracy bonus (per the PS
// skill DB: "This skill has a 20% accuracy bonus."); vanilla RO gives it none.
const SKILL_HITRATE_PCT_BONUS = {
  CR_HOLYCROSS: () => 20,
};

function calculateHitChance(status, target, config, skillName, skillLevel) {
  const targetScs = target.target_active_scs;
  // "Can't-move" statuses make the target unable to evade → guaranteed hit.
  // Quagmire is NOT one of these: it only lowers AGI/DEX (and thus flee),
  // handled as a flee reduction in the calculate route, not as auto-hit.
  if (targetScs.SC_STONE || targetScs.SC_FREEZE || targetScs.SC_STUN || targetScs.SC_SLEEP) {
    return [100.0, 0.0];
  }

  const mobFlee = target.flee > 0 ? target.flee : target.level + target.agi;
  let hitrate = 80 + status.hit - mobFlee;

  // Skill accuracy bonus (% of hitrate), applied before the clamp — matches the
  // battle.c ordering (hitrate += hitrate * pct / 100, then cap_value).
  const bonusFn = skillName && SKILL_HITRATE_PCT_BONUS[skillName];
  if (bonusFn) hitrate += Math.floor((hitrate * bonusFn(skillLevel || 1)) / 100);

  hitrate = Math.max(config.min_hitrate, Math.min(config.max_hitrate, hitrate));

  const flee2 = target.luk + 10;
  const perfectDodgePct = flee2 / 10.0;

  return [hitrate, perfectDodgePct];
}

module.exports = { calculateHitChance };
