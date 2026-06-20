/**
 * config.js — JS port of core/config.py
 */
function createBattleConfig(overrides = {}) {
  return {
    weapon_damage_rate: 100,
    short_attack_damage_rate: 100,
    long_attack_damage_rate: 100,
    critical_rate: 100,
    critical_min: 10,
    enable_critical: true,
    max_aspd: 190,
    enable_perfect_flee: true,

    min_hitrate: 5,
    max_hitrate: 100,

    vit_penalty_target: 0,
    vit_penalty_count: 3,
    vit_penalty_num: 5,
    vit_penalty_type: 0,

    ...overrides,
  };
}

module.exports = { createBattleConfig };
