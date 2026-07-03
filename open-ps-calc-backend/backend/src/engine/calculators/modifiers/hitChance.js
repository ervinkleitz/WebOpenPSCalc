/**
 * hitChance.js — JS port of core/calculators/modifiers/hit_chance.py
 */
function calculateHitChance(status, target, config) {
  const targetScs = target.target_active_scs;
  if (targetScs.SC_STONE || targetScs.SC_FREEZE || targetScs.SC_STUN || targetScs.SC_SLEEP || targetScs.SC_QUAGMIRE) {
    return [100.0, 0.0];
  }

  const mobFlee = target.flee > 0 ? target.flee : target.level + target.agi;
  let hitrate = 80 + status.hit - mobFlee;
  hitrate = Math.max(config.min_hitrate, Math.min(config.max_hitrate, hitrate));

  const flee2 = target.luk + 10;
  const perfectDodgePct = flee2 / 10.0;

  return [hitrate, perfectDodgePct];
}

module.exports = { calculateHitChance };
