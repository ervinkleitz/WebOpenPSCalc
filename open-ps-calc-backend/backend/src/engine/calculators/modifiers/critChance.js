/**
 * critChance.js — JS port of core/calculators/modifiers/crit_chance.py
 */
const { getProfile, STANDARD } = require("../../serverProfiles");

const RACE_TO_RC = {
  Formless: "RC_Formless", Undead: "RC_Undead", Brute: "RC_Brute",
  Plant: "RC_Plant", Insect: "RC_Insect", Fish: "RC_Fish",
  Demon: "RC_Demon", "Demi-Human": "RC_DemiHuman", Angel: "RC_Angel", Dragon: "RC_Dragon",
};

const KN_AUTOCOUNTER = 61;
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

function calculateCritChance(status, weapon, skill, target, config, server = "standard", gearBonuses = null) {
  if (!isCritEligible(skill.id, skill.name, server)) return [false, 0.0];

  let cri = status.cri;

  // bCriticalAddRace — extra crit vs the target's race / boss group (crit points,
  // stored ×10 like the rest of `cri`). Part of the attacker's crit, so it's also
  // doubled by Katar and reduced by the target's LUK below.
  const car = gearBonuses && gearBonuses.crit_add_race;
  if (car) {
    const raceRc = RACE_TO_RC[target.race] || "";
    const bossRc = target.is_boss ? "RC_Boss" : "RC_NonBoss";
    cri += ((car[raceRc] || 0) + (car[bossRc] || 0) + (car.RC_All || 0)) * 10;
  }

  if (weapon.weapon_type === "Katar") cri <<= 1;

  if (!getProfile(server).mechanic_flags.has("PS_CRIT_SHIELD_DISABLED")) {
    cri -= target.luk * 2;
  }

  if ("SC_SLEEP" in target.target_active_scs) cri <<= 1;

  if (skill.id === KN_AUTOCOUNTER) {
    // Counter Attack (Auto Counter) never misses and always lands a critical.
    return [true, 100.0];
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
