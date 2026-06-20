/**
 * skillRatio.js — JS port of core/calculators/modifiers/skill_ratio.py
 *
 * NOT FULLY PORTED: the upstream table covers ~100 BF_WEAPON skills plus
 * weapon-type-dependent splits (RG_BACKSTAP), parameter-dependent skills
 * (KN_CHARGEATK, MC_CARTREVOLUTION, TK_JUMPKICK, MO_EXTREMITYFIST,
 * NJ_ZENYNAGE...), and the full BF_MAGIC ratio table. What's ported below is
 * the dispatch/precedence logic (identical to the original) and the subset
 * of BF_WEAPON ratios verified directly from source during this port —
 * enough to cover normal attacks and the most common low-tier weapon skills
 * across each class. Anything not listed here falls back to skills.json's
 * ratio_per_level/ratio_base, exactly like the original's own fallback for
 * unaudited skills — so the pipeline never breaks, it just uses a less
 * specific ratio for skills not yet transcribed.
 */
const { loader } = require("../../dataLoader");
const { scaleFloor, addFlat, pmfStats } = require("../../pmf");
const { STANDARD } = require("../../serverProfiles");

// battle.c:2039 battle_calc_skillratio BF_WEAPON switch (#else not RENEWAL) — verified subset.
const BF_WEAPON_RATIOS = {
  SM_BASH: (lv) => 100 + 30 * lv,
  SM_MAGNUM: (lv) => 100 + 20 * lv,
  KN_BRANDISHSPEAR: (lv) => 100 + 20 * lv,
  KN_SPEARSTAB: (lv) => 100 + 20 * lv,
  KN_SPEARBOOMERANG: (lv) => 100 + 50 * lv,
  KN_PIERCE: (lv) => 100 + 10 * lv,
  KN_BOWLINGBASH: (lv) => 100 + 40 * lv,
  CR_SHIELDCHARGE: (lv) => 100 + 20 * lv,
  CR_SHIELDBOOMERANG: (lv) => 100 + 30 * lv,
  CR_HOLYCROSS: (lv) => 100 + 35 * lv,
  MC_MAMMONITE: (lv) => 100 + 50 * lv,
  TF_POISON: () => 100,
  TF_SPRINKLESAND: () => 130,
  AS_SONICBLOW: (lv) => 400 + 40 * lv,
  AS_GRIMTOOTH: (lv) => 100 + 20 * lv,
  AS_VENOMKNIFE: () => 100,
  RG_RAID: (lv) => 100 + 40 * lv,
  RG_INTIMIDATE: (lv) => 100 + 30 * lv,
  AC_DOUBLE: (lv) => 100 + 10 * (lv - 1),
  AC_SHOWER: (lv) => 75 + 5 * lv,
  AC_CHARGEARROW: () => 150,
  HT_PHANTASMIC: () => 150,
  MO_TRIPLEATTACK: (lv) => 100 + 20 * lv,
  MO_CHAINCOMBO: (lv) => 150 + 50 * lv,
  MO_COMBOFINISH: (lv) => 240 + 60 * lv,
  MO_BALKYOUNG: () => 300,
  BA_MUSICALSTRIKE: (lv) => 125 + 25 * lv,
  DC_THROWARROW: (lv) => 125 + 25 * lv,
  AM_DEMONSTRATION: (lv) => 100 + 20 * lv,
  // Added from core/calculators/modifiers/skill_ratio.py's _BF_WEAPON_RATIOS
  // (StatGameDev/Open_PS_Calc, MIT) — fills the table out to its full 52 entries.
  AM_ACIDTERROR: (lv) => 100 + 40 * lv,
  HT_FREEZINGTRAP: (lv) => 50 + 10 * lv,
  KN_AUTOCOUNTER: () => 100,
  MO_FINGEROFFENSIVE: (lv) => 100 + 50 * lv,
  MO_INVESTIGATE: (lv) => 100 + 75 * lv,
  TK_STORMKICK: (lv) => 160 + 20 * lv,
  TK_DOWNKICK: (lv) => 160 + 20 * lv,
  TK_TURNKICK: (lv) => 190 + 30 * lv,
  TK_COUNTER: (lv) => 190 + 30 * lv,
  GS_TRIPLEACTION: (lv) => 100 + 50 * lv,
  GS_BULLSEYE: (lv, tgt) => 100 + ((tgt && ["Brute", "Demi-Human"].includes(tgt.race) && !tgt.is_boss) ? 400 : 0),
  GS_TRACKING: (lv) => 200 + 100 * lv,
  GS_PIERCINGSHOT: (lv) => 100 + 20 * lv,
  GS_RAPIDSHOWER: (lv) => 100 + 10 * lv,
  GS_DESPERADO: (lv) => 50 + 50 * lv,
  GS_DUST: (lv) => 100 + 50 * lv,
  GS_FULLBUSTER: (lv) => 300 + 100 * lv,
  GS_SPREADATTACK: (lv) => 100 + 20 * (lv - 1),
  GS_MAGICALBULLET: () => 100,
  NJ_HUUMA: (lv) => 150 + 150 * lv,
  NJ_KASUMIKIRI: (lv) => 100 + 10 * lv,
  NJ_KIRIKAGE: (lv) => 100 * lv,
  NJ_KUNAI: () => 100,
};

function calculateSkillRatio(skill, pmf, build, result, opts = {}) {
  const { target = null, weapon = null, profile = STANDARD, ctx = null, gear_bonuses: gearBonuses = null } = opts;

  const skillData = loader.getSkill(skill.id);
  const skillName = skillData ? skillData.name || "" : "";

  const params = build.skill_params || {};
  let flatAdd = 0;
  let ratio, ratioSrc;

  const psRatioFn = (profile.weapon_ratios || {})[skillName];
  if (psRatioFn != null) {
    ratio = psRatioFn(skill.level, target, ctx);
    ratioSrc = `PS profile.weapon_ratios[${skillName}]`;
  } else if (BF_WEAPON_RATIOS[skillName]) {
    ratio = BF_WEAPON_RATIOS[skillName](skill.level, target, ctx);
    ratioSrc = `BF_WEAPON_RATIOS[${skillName}]`;
  } else if (skillData && skillData.ratio_per_level && skillData.ratio_per_level.length) {
    const ratioList = skillData.ratio_per_level;
    ratio = skill.level <= ratioList.length ? ratioList[skill.level - 1] : (skillData.ratio_base ?? 100);
    ratioSrc = `ratio_per_level[lv${skill.level}]`;
  } else {
    ratio = skillData ? (skillData.ratio_base ?? 100) : 100;
    ratioSrc = "ratio_base (default 100)";
  }

  if ((profile.param_skill_flat_adds || {})[skillName]) {
    flatAdd += profile.param_skill_flat_adds[skillName](params, skill.level);
  }

  const active = build.active_status_levels || {};
  if ("SC_OVERTHRUST" in active) {
    ratio += 5 * active.SC_OVERTHRUST;
  } else {
    const otLv = Number(build.support_buffs.SC_OVERTHRUST || 0);
    if (otLv > 0) {
      if (profile.mechanic_flags.has("BS_OVERTHRUST_PARTY_FULL_BONUS")) ratio += 5 * otLv;
      else ratio += 5;
    }
  }
  if ("SC_OVERTHRUSTMAX" in active) ratio += 20 * active.SC_OVERTHRUSTMAX;

  if (skillName === "AS_SONICBLOW" && (params.AS_SONICBLOW_sonic_accel ?? true)) {
    ratio = Math.floor(ratio * 110 / 100);
    ratioSrc += " ×1.1 (Sonic Accel)";
  }

  let hitCountRaw = 1;
  if (skillName === "MO_FINGEROFFENSIVE") {
    hitCountRaw = Math.max(1, params.MO_FINGEROFFENSIVE_spheres || 1);
  } else {
    const psHcFn = (profile.weapon_hit_counts || {})[skillName];
    if (psHcFn) {
      hitCountRaw = psHcFn(skill.level, target, ctx);
    } else if (skillData) {
      const noh = skillData.number_of_hits;
      if (noh && skill.level <= noh.length) hitCountRaw = noh[skill.level - 1];
    }
  }
  const hitCount = hitCountRaw > 0 ? hitCountRaw : 1;
  const displayHits = Math.abs(hitCountRaw);
  const cosmetic = hitCountRaw < 0;

  pmf = scaleFloor(pmf, ratio, 100);
  if (flatAdd > 0) pmf = addFlat(pmf, flatAdd);
  pmf = scaleFloor(pmf, hitCount, 1);

  if (gearBonuses) {
    const skillAtkBonus = gearBonuses.skill_atk[skillName] || 0;
    if (skillAtkBonus) {
      pmf = scaleFloor(pmf, 100 + skillAtkBonus, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "Skill ATK Bonus", value: av, min_value: mn, max_value: mx, multiplier: (100 + skillAtkBonus) / 100, note: `bSkillAtk: ${skillName} +${skillAtkBonus}%`, formula: `dmg × (100+${skillAtkBonus})/100`, hercules_ref: "pc.c:3513-3527" });
    }
  }

  const [mn, mx, av] = pmfStats(pmf);
  result.add_step({
    name: `Skill Ratio (ID ${skill.id} Lv ${skill.level})`, value: av, min_value: mn, max_value: mx, multiplier: ratio / 100,
    note: skillData ? skillData.description || "" : "",
    formula: cosmetic ? `dmg × ${ratio}% × ${displayHits} cosmetic hits (${ratioSrc})` : `dmg × ${ratio}% × ${hitCount} hits (${ratioSrc})`,
    hercules_ref: "battle.c battle_calc_skillratio",
  });

  if (
    profile !== STANDARD && skillName &&
    !((profile.weapon_ratios || {})[skillName]) &&
    !(profile.weapon_vanilla_ok || new Set()).has?.(skillName)
  ) {
    result.add_step({
      name: "⚠ Vanilla fallback (PS unaudited)", value: av, min_value: mn, max_value: mx, multiplier: 1.0,
      note: `${skillName}: PS formula not confirmed in this port — using vanilla ratio as fallback.`,
      formula: "unverified vanilla fallback", hercules_ref: "",
    });
  }

  return [pmf, hitCount];
}

module.exports = { calculateSkillRatio, BF_WEAPON_RATIOS };
