/**
 * critChance.js — JS port of core/calculators/modifiers/crit_chance.py
 */
const { getProfile, STANDARD } = require("../../serverProfiles");

const KN_AUTOCOUNTER = 8;
const SN_SHARPSHOOTING = 280;
const MA_SHARPSHOOTING = 357;
const NJ_KIRIKAGE = 543;

const VANILLA_CRIT_ELIGIBLE = new Set(["KN_AUTOCOUNTER", "SN_SHARPSHOOTING", "MA_SHARPSHOOTING", "NJ_KIRIKAGE"]);
const PS_CRIT_ELIGIBLE = new Set(["AS_SONICBLOW", "AS_GRIMTOOTH", "GS_TRACKING", "PS_PR_HOLYSTRIKE"]);

function isCritEligible(skillId, skillName, server = "standard") {
  if (skillId === 0) return true;
  if (getProfile(server) !== STANDARD) {
    return VANILLA_CRIT_ELIGIBLE.has(skillName) || PS_CRIT_ELIGIBLE.has(skillName);
  }
  return VANILLA_CRIT_ELIGIBLE.has(skillName);
}

function calculateCritChance(status, weapon, skill, target, config, server = "standard") {
  if (!isCritEligible(skill.id, skill.name, server)) return [false, 0.0];

  let cri = status.cri;

  if (weapon.weapon_type === "Katar") cri <<= 1;

  if (!getProfile(server).mechanic_flags.has("PS_CRIT_SHIELD_DISABLED")) {
    cri -= target.luk * 2;
  }

  if ("SC_SLEEP" in target.target_active_scs) cri <<= 1;

  if (skill.id === KN_AUTOCOUNTER) {
    if (config.auto_counter_type) return [true, 100.0];
    cri <<= 1;
  } else if (skill.id === SN_SHARPSHOOTING || skill.id === MA_SHARPSHOOTING) {
    cri += 200;
  } else if (skill.id === NJ_KIRIKAGE) {
    cri += 250 + 50 * skill.level;
  }

  cri = Math.max(config.critical_min, cri);
  const critChance = Math.max(0.0, cri / 10.0);
  return [true, critChance];
}

module.exports = { isCritEligible, calculateCritChance };
