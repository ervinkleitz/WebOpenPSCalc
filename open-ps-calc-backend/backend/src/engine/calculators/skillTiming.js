/**
 * skillTiming.js — JS port of core/calculators/skill_timing.py
 */
const { getProfile } = require("../serverProfiles");

const MONK_COMBO_SKILLS = new Set(["MO_TRIPLEATTACK", "MO_CHAINCOMBO", "MO_COMBOFINISH", "CH_TIGERFIST", "CH_CHAINCRUSH"]);
const CASTRATE_DEX_SCALE = 150;
const MIN_SKILL_DELAY_MS = 100;

const PS_CAST_TIME_OVERRIDES = {
  AM_ACIDTERROR: 500,
  WZ_FROSTNOVA: (lv) => Math.max(0, 2300 - 300 * lv),
  WZ_METEOR: 10000,
  GS_TRACKING: (lv) => 1000 + 100 * lv,
  GS_PIERCINGSHOT: 3000,
};

function calculateSkillTiming(skillName, skillLv, skillData, status, gearBonuses, supportBuffs, server = "standard") {
  const lvIdx = skillLv - 1;
  const profile = getProfile(server);

  const castTimes = skillData.cast_time || [];
  let baseCast = lvIdx < castTimes.length ? castTimes[lvIdx] : 0;

  if (server === "payon_stories" && skillName in PS_CAST_TIME_OVERRIDES) {
    const override = PS_CAST_TIME_OVERRIDES[skillName];
    baseCast = typeof override === "function" ? override(skillLv) : override;
  }

  const castTimeOptions = skillData.cast_time_options || [];
  const ignoreDex = castTimeOptions.includes("IgnoreDex");

  let effectiveCast;
  if (baseCast === 0) effectiveCast = 0;
  else if (ignoreDex) effectiveCast = baseCast;
  else {
    const scale = CASTRATE_DEX_SCALE - status.dex;
    effectiveCast = Math.floor((baseCast * Math.max(0, scale)) / CASTRATE_DEX_SCALE);
  }

  if (gearBonuses.castrate !== 0) {
    effectiveCast = Math.floor(effectiveCast * (100 + gearBonuses.castrate) / 100);
  }
  const perSkillCr = gearBonuses.skill_castrate[skillName] || 0;
  if (perSkillCr !== 0) effectiveCast = Math.floor(effectiveCast * (100 + perSkillCr) / 100);

  if (status.cast_time_reduction_pct && effectiveCast > 0) {
    effectiveCast -= Math.floor(effectiveCast * status.cast_time_reduction_pct / 100);
  }

  const sufLv = Number(supportBuffs.SC_SUFFRAGIUM || 0);
  if (sufLv > 0 && effectiveCast > 0) {
    effectiveCast -= Math.floor(effectiveCast * (15 * sufLv) / 100);
  }

  if (status.cast_time_penalty_pct && effectiveCast > 0) {
    effectiveCast += Math.floor(effectiveCast * status.cast_time_penalty_pct / 100);
  }

  effectiveCast = Math.max(effectiveCast, 0);

  if (profile.ps_zero_cast.has(skillName)) effectiveCast = 0;

  const delays = skillData.after_cast_act_delay || [];
  let baseDelay = lvIdx < delays.length ? delays[lvIdx] : 0;

  if (skillName in (profile.ps_skill_delay_fn || {})) {
    baseDelay = profile.ps_skill_delay_fn[skillName](status);
  } else if (MONK_COMBO_SKILLS.has(skillName)) {
    baseDelay -= 4 * status.agi + 2 * status.dex;
  }

  if (status.after_cast_delay_reduction_pct && baseDelay > 0) {
    baseDelay -= Math.floor(baseDelay * status.after_cast_delay_reduction_pct / 100);
  }

  const totalDelayrate = gearBonuses.delayrate + (gearBonuses.skill_delayrate[skillName] || 0);
  if (totalDelayrate !== 0) baseDelay = Math.floor(baseDelay * (100 + totalDelayrate) / 100);

  let effectiveDelay;
  if (profile.ps_acd_zero.has(skillName)) effectiveDelay = MIN_SKILL_DELAY_MS;
  else effectiveDelay = Math.max(baseDelay, MIN_SKILL_DELAY_MS);

  return [effectiveCast, effectiveDelay];
}

module.exports = { calculateSkillTiming };
