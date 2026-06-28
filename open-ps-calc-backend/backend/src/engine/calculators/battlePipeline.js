/**
 * battlePipeline.js — JS port of core/calculators/battle_pipeline.py
 *
 * SCOPE OF THIS PORT (battle_pipeline.py is 1712 lines covering many branch
 * types; this file covers the single most important path end-to-end):
 *
 * PORTED: normal auto-attacks and BF_WEAPON skills (skill.id != 0) — base
 * damage, skill ratio + hit count, crit branch, defense, active status
 * bonuses, refine bonus, weapon mastery, element (AttrFix), forge bonus,
 * card race/element/size bonuses, final rate bonus, hit chance / crit
 * chance, and a DPS estimate from the normal/miss/crit attack distribution.
 *
 * NOT YET PORTED (explicitly out of scope for this pass):
 *   - BF_MAGIC skills (magic_pipeline.py) — spells will return a "not yet
 *     implemented" marker from calculateBattle() rather than a wrong number.
 *   - CR_GRANDCROSS (grand_cross_pipeline.py) and other BF_MISC skills.
 *   - incoming_physical_pipeline.py / incoming_magic_pipeline.py (mob → player).
 *   - Katar second-hit, dual-wield left-hand branch, TF_DOUBLE/GS_CHAINACTION
 *     procs, MO_TRIPLEATTACK proc branch, item autocasts (bAutoSpell on
 *     attack/skill), NJ_ISSEN's fixed-damage formula, CR_SHIELDBOOMERANG's
 *     flag.weapon=0 special case, and the many small PS-only multiplicative
 *     bonuses (Cloaking, Lex Aeterna, Mailbreaker/Venom Dust/Raided, Backstab
 *     Opportunity, performing bonuses) that battle_pipeline.py threads
 *     through _run_branch. These all still work as plain weapon-skill ratio
 *     lookups; they just don't get their special-case bonus on top yet.
 *   - bWeaponAtk (per-weapon-type % bonus from bonus2 bWeaponAtk scripts) —
 *     needs a weapon_type → Hercules W_* constant table not transcribed here.
 */
const { loader } = require("../dataLoader");
const { createCalcContext, createDamageResult, createBattleResult, createAttackDefinition } = require("../models");
const { getProfile, STANDARD } = require("../serverProfiles");
const { uniformPmf, scaleFloor, floorAt, pmfStats, convolve } = require("../pmf");

const { calculateBaseDamage } = require("./modifiers/baseDamage");
const { calculateRefineFix } = require("./modifiers/refineFix");
const { calculateAttrFix } = require("./modifiers/attrFix");
const { calculateForgeBonus } = require("./modifiers/forgeBonus");
const { calculateFinalRateBonus } = require("./modifiers/finalRateBonus");
const { calculateHitChance } = require("./modifiers/hitChance");
const { isCritEligible, calculateCritChance } = require("./modifiers/critChance");
const { calculateCritAtkRate } = require("./modifiers/critAtkRate");
const { calculateActiveStatusBonus } = require("./modifiers/activeStatusBonus");
const { calculateMasteryFix } = require("./modifiers/masteryFix");
const { calculateDefenseFix, calculateMagicDefenseFix } = require("./modifiers/defenseFix");
const { calculateCardFix, calculateCardFixMagic } = require("./modifiers/cardFix");
const { calculateSkillRatio } = require("./modifiers/skillRatio");
const { calculateSkillTiming } = require("./skillTiming");
const { calculateDps } = require("./dpsCalculator");
const { effectiveIsRanged } = require("../buildManager");

// battle.c:3173-3410 BF_MAGIC skillratio switch (#else RENEWAL) — per-hit ratios.
// These are explicit overrides; unlisted skills fall back to skills.json ratio_per_level.
const BF_MAGIC_RATIOS = {
  // Mage
  MG_NAPALMBEAT:     (lv) => 70 + 10 * lv,
  MG_SOULSTRIKE:     (lv) => 100 + 5 * lv,
  MG_FIREBALL:       () => 125,
  MG_FIREBOLT:       () => 100,
  MG_COLDBOLT:       () => 100,
  MG_LIGHTNINGBOLT:  () => 100,
  MG_FROSTDIVER:     () => 110,
  MG_THUNDERSTORM:   () => 50,
  // Acolyte / Priest
  AL_HOLYLIGHT:      () => 125,
  PR_BENEDICTIO:     () => 50,
  // Wizard / High Wizard
  WZ_EARTHSPIKE:     (lv) => 100 + 50 * lv,
  WZ_HEAVENDRIVE:    (lv) => 50 + 50 * lv,
  WZ_FROSTDIVER:     (lv) => 200 + 10 * lv,
  WZ_STORMGUST:      (lv) => 100 * (lv + 2),
  WZ_JUPITEL:        (lv) => 100 + 100 * lv,
  WZ_METEOR:         (lv) => 100 + 50 * lv,
  WZ_WATERBALL:      (lv) => 100 + 30 * lv,
  WZ_SIGHTRASHER:    (lv) => 100 + 20 * lv,
  WZ_FIREWALL:       (lv) => 100 + 10 * lv,
  HW_NAPALMVULCAN:   (lv) => 100 + 20 * lv,
  // Ninja
  NJ_KOUENKA:        (lv) => 100 + 30 * lv,
  NJ_HYOUSENSOU:     () => 100,
  NJ_KAMAITACHI:     (lv) => 100 + 30 * lv,
  NJ_KAENSIN:        (lv) => 100 + 10 * lv,
  NJ_HITOKIRI:       (lv) => 150 + 50 * lv,
};

const ELE_STR_TO_INT = {
  Ele_Neutral: 0, Ele_Water: 1, Ele_Earth: 2, Ele_Fire: 3,
  Ele_Wind: 4, Ele_Poison: 5, Ele_Holy: 6, Ele_Dark: 7, Ele_Ghost: 8, Ele_Undead: 9,
};

function resolveIsRanged(build, weapon, skill) {
  // skill-level long/short overrides (skills.json range sign) are NOT YET PORTED;
  // this mirrors the weapon-derived default from build_manager.effectiveIsRanged.
  return effectiveIsRanged(build, weapon);
}

function skillPeriodMs(castMs, delayMs, skillData, skillLv, minPeriodOverride, amotionFloor) {
  let period = Math.max(castMs + delayMs, amotionFloor);
  if (minPeriodOverride) period = Math.max(period, minPeriodOverride);
  return period;
}

class BattlePipeline {
  constructor(config) {
    this.config = config;
  }

  _runMagicBranch(status, weapon, skill, target, build, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();
    const skillData = loader.getSkill(skill.id);
    const skillName = skill.name || "";

    // 1. Base MATK (uniform distribution between matk_min and matk_max)
    const matkLo = Math.max(1, status.matk_min);
    const matkHi = Math.max(matkLo, status.matk_max);
    let pmf = uniformPmf(matkLo, matkHi);
    const [mn0, mx0, av0] = pmfStats(pmf);
    result.add_step({
      name: "Base MATK", value: av0, min_value: mn0, max_value: mx0,
      note: `INT=${status.int_}  MATK ${matkLo}–${matkHi}`,
      formula: "int+(int/7)² to int+(int/5)²",
      hercules_ref: "status.c status_calc_matk",
    });

    // bMatkRate gear bonus
    if (gearBonuses && gearBonuses.matk_rate) {
      pmf = scaleFloor(pmf, 100 + gearBonuses.matk_rate, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({
        name: "bMatkRate", value: av, min_value: mn, max_value: mx,
        multiplier: (100 + gearBonuses.matk_rate) / 100,
        note: `bMatkRate +${gearBonuses.matk_rate}%`,
        formula: `dmg*(100+${gearBonuses.matk_rate})//100`,
        hercules_ref: "battle.c:5382",
      });
    }

    // 2. Skill ratio — explicit BF_MAGIC_RATIOS, then PS profile, then skill DB fallback
    const ctx = createCalcContext({
      skill_levels: gearBonuses ? gearBonuses.effective_mastery : build.mastery_levels,
      skill_params: build.skill_params,
      base_level: build.base_level,
      base_str: build.base_str,
      str_: status.str,
      vit: status.vit,
      dex: status.dex,
      int_: status.int_,
      weapon_type: weapon ? weapon.weapon_type : "",
    });

    let ratio = 100, ratioSrc = "default 100%";
    const psMagicFn = (profile.magic_ratios || {})[skillName];
    if (psMagicFn) {
      ratio = psMagicFn(skill.level, target, ctx);
      ratioSrc = `PS magic_ratios[${skillName}]`;
    } else if (BF_MAGIC_RATIOS[skillName]) {
      ratio = BF_MAGIC_RATIOS[skillName](skill.level, target, ctx);
      ratioSrc = `BF_MAGIC_RATIOS[${skillName}]`;
    } else if (skillData && skillData.ratio_per_level && skillData.ratio_per_level.length) {
      const ratioList = skillData.ratio_per_level;
      ratio = skill.level <= ratioList.length ? ratioList[skill.level - 1] : (skillData.ratio_base ?? 100);
      ratioSrc = `ratio_per_level[lv${skill.level}]`;
    } else if (skillData) {
      ratio = skillData.ratio_base ?? 100;
      ratioSrc = "ratio_base (DB fallback)";
    }

    let hitCountRaw = 1;
    if (skillData) {
      const noh = skillData.number_of_hits;
      if (noh && skill.level <= noh.length) hitCountRaw = noh[skill.level - 1];
    }
    // Negative = cosmetic (visual multi-hit, damage applied once)
    const hitCount = hitCountRaw > 0 ? hitCountRaw : 1;

    pmf = scaleFloor(pmf, ratio, 100);
    pmf = scaleFloor(pmf, hitCount, 1);

    const [mn1, mx1, av1] = pmfStats(pmf);
    result.add_step({
      name: `Skill Ratio (ID ${skill.id} Lv ${skill.level})`,
      value: av1, min_value: mn1, max_value: mx1, multiplier: ratio / 100,
      note: skillData ? (skillData.description || "") : "",
      formula: `dmg × ${ratio}% × ${hitCount} hit${hitCount !== 1 ? "s" : ""} (${ratioSrc})`,
      hercules_ref: "battle.c battle_calc_skillratio BF_MAGIC",
    });

    const skillAtkBonus = gearBonuses ? (gearBonuses.skill_atk[skillName] || 0) : 0;
    if (skillAtkBonus) {
      pmf = scaleFloor(pmf, 100 + skillAtkBonus, 100);
      const [mnB, mxB, avB] = pmfStats(pmf);
      result.add_step({
        name: "Skill ATK Bonus", value: avB, min_value: mnB, max_value: mxB,
        multiplier: (100 + skillAtkBonus) / 100,
        note: `bSkillAtk: ${skillName} +${skillAtkBonus}%`,
        formula: `dmg × (100+${skillAtkBonus})/100`,
        hercules_ref: "pc.c:3513-3527",
      });
    }

    if (
      profile !== STANDARD && skillName &&
      !(profile.magic_ratios || {})[skillName] &&
      !(profile.magic_vanilla_ok || new Set()).has(skillName)
    ) {
      result.add_step({
        name: "⚠ Vanilla fallback (PS unaudited)", value: av1, min_value: mn1, max_value: mx1, multiplier: 1.0,
        note: `${skillName}: PS formula not confirmed in this port — using vanilla ratio as fallback.`,
        formula: "unverified vanilla fallback", hercules_ref: "",
      });
    }

    // 3. Magic defense (MDEF% + soft MDEF flat)
    if (!skill.nk_ignore_def) {
      pmf = calculateMagicDefenseFix(target, gearBonuses || {}, pmf, result);
    } else {
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({
        name: "Magic Defense Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0,
        note: "BYPASSED — NK_IGNORE_DEF", formula: "no change", hercules_ref: "battle.c:5070",
      });
    }

    // 4. Element (AttrFix) — skill element overrides weapon element for magic
    let effAtkEle = 0; // neutral default
    if (skill.id !== 0 && skillData) {
      const eleList = skillData.element || [];
      if (eleList.length) {
        const idx = Math.min(skill.level - 1, eleList.length - 1);
        const v = ELE_STR_TO_INT[eleList[idx]];
        if (v != null) effAtkEle = v;
      }
    }
    if (skillName in (profile.skill_elements || {})) effAtkEle = profile.skill_elements[skillName];
    pmf = calculateAttrFix(weapon, target, pmf, result, build, effAtkEle);

    // 5. Magic card bonuses (bMagicAddRace, bMagicAddEle)
    const ELE_TO_KEY_MAGIC = [
      "Ele_Neutral", "Ele_Water", "Ele_Earth", "Ele_Fire",
      "Ele_Wind", "Ele_Poison", "Ele_Holy", "Ele_Dark", "Ele_Ghost", "Ele_Undead",
    ];
    const magicEleName = ELE_TO_KEY_MAGIC[effAtkEle] || "Ele_Neutral";
    pmf = calculateCardFixMagic(target, magicEleName, pmf, result, gearBonuses);

    pmf = floorAt(pmf, 1);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({
      name: "Final Damage", value: av, min_value: mn, max_value: mx,
      note: "Magic branch", formula: "", hercules_ref: "",
    });

    result.min_damage = mn;
    result.max_damage = mx;
    result.avg_damage = av;
    result.pmf = pmf;
    return result;
  }

  /**
   * CR_GRANDCROSS (BF_MISC) — not present in Hercules' generic BF_WEAPON/
   * BF_MAGIC skillratio switches (verified by inspecting battle.c directly);
   * Grand Cross is hardcoded as a standalone formula:
   *   damage = (ATK + MATK) * (100 + 40*skill_lv) / 100 * holy_element_mult
   * Confirmed verbatim against wiki.payonstories.com/Grand_Cross (which
   * states this exact formula) — also matches two independent vanilla
   * pre-renewal community sources (irowiki "classic" Grand Cross writeup,
   * a Revo-Classic damage breakdown thread) and this repo's own scraped
   * skill_db.json: damage_type ["IgnoreCards","IgnoreFlee"] (no
   * "IgnoreDefense"/"IgnoreElement") confirms DEF/MDEF and the Holy AttrFix
   * apply normally, percentage card bonuses are skipped, and flee is
   * ignored (always hits).
   *
   * PS deviation: the PS wiki explicitly lists weapon masteries and Demon
   * Bane's flat bonus as affecting damage (only the *percentage* parts of
   * Demon Bane/cards are excluded) — unlike vanilla Hercules, where
   * masteryFix.js's MASTERY_EXEMPT_SKILLS bypasses mastery entirely for this
   * skill. Gated behind the PS_GRANDCROSS_MASTERY_APPLIES mechanic flag so
   * the standard/vanilla profile keeps the Hercules-accurate bypass.
   */
  _runGrandCrossBranch(status, weapon, skill, target, build, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();

    // ATK component: standard BATK + weapon-roll chain, minus size fix (this
    // is a self-centered AoE burst, not a weapon swing scaled to target size).
    let atkPmf = calculateBaseDamage(status, weapon, build, target, { ...skill, ignore_size_fix: true }, result, {
      gear_bonuses: gearBonuses, is_crit: false, is_ranged: false,
    });
    if (gearBonuses && gearBonuses.atk_rate) {
      atkPmf = scaleFloor(atkPmf, 100 + gearBonuses.atk_rate, 100);
      const [mn, mx, av] = pmfStats(atkPmf);
      result.add_step({ name: "bAtkRate", value: av, min_value: mn, max_value: mx, multiplier: (100 + gearBonuses.atk_rate) / 100, note: `bAtkRate +${gearBonuses.atk_rate}%`, formula: `dmg*(100+${gearBonuses.atk_rate})//100`, hercules_ref: "battle.c:5330" });
    }

    // MATK component
    const matkLo = Math.max(1, status.matk_min);
    const matkHi = Math.max(matkLo, status.matk_max);
    let matkPmf = uniformPmf(matkLo, matkHi);
    if (gearBonuses && gearBonuses.matk_rate) {
      matkPmf = scaleFloor(matkPmf, 100 + gearBonuses.matk_rate, 100);
    }
    const [mmn, mmx, mav] = pmfStats(matkPmf);
    result.add_step({
      name: "Base MATK", value: mav, min_value: mmn, max_value: mmx,
      note: `INT=${status.int_}  MATK ${matkLo}-${matkHi}`,
      formula: "int+(int/7)^2 to int+(int/5)^2", hercules_ref: "status.c status_calc_matk",
    });

    let pmf = convolve(atkPmf, matkPmf);
    const [cmn, cmx, cav] = pmfStats(pmf);
    result.add_step({
      name: "ATK + MATK", value: cav, min_value: cmn, max_value: cmx,
      note: "Grand Cross bases damage on combined ATK and MATK",
      formula: "ATK + MATK", hercules_ref: "community-verified (no battle.c excerpt found)",
    });

    const ratio = 100 + 40 * skill.level;
    pmf = scaleFloor(pmf, ratio, 100);
    const [rmn, rmx, rav] = pmfStats(pmf);
    result.add_step({
      name: `Skill Ratio (Lv ${skill.level})`, value: rav, min_value: rmn, max_value: rmx,
      multiplier: ratio / 100, note: `Grand Cross Lv${skill.level}: ${ratio}%`,
      formula: "(ATK+MATK) * (100 + 40*lv) / 100", hercules_ref: "community-verified (no battle.c excerpt found)",
    });

    pmf = calculateDefenseFix(target, build, gearBonuses, pmf, this.config, result, { is_crit: false, skill });

    // PS: weapon masteries + Demon Bane's flat bonus apply here (wiki.payonstories.com/Grand_Cross).
    // Vanilla: masteryFix.js's MASTERY_EXEMPT_SKILLS bypasses this for CR_GRANDCROSS.
    const ctx = createCalcContext({
      skill_levels: gearBonuses.effective_mastery,
      skill_params: build.skill_params,
      base_level: build.base_level,
      base_str: build.base_str,
      str_: status.str,
      vit: status.vit,
      dex: status.dex,
      int_: status.int_,
      weapon_type: weapon ? weapon.weapon_type : "",
    });
    pmf = calculateMasteryFix(weapon, build, target, pmf, result, skill, { profile, ctx });

    pmf = calculateAttrFix(weapon, target, pmf, result, build, 6 /* Ele_Holy — fixed element, ignores weapon */);

    {
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "Card Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0, note: "BYPASSED — damage_type includes IgnoreCards", formula: "no change", hercules_ref: "skills.json damage_type" });
    }

    pmf = floorAt(pmf, 1);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: "Grand Cross branch", formula: "", hercules_ref: "" });

    result.min_damage = mn;
    result.max_damage = mx;
    result.avg_damage = av;
    result.pmf = pmf;
    return result;
  }

  /**
   * Run a single damage branch (normal or crit) through the modifier chain.
   * Mirrors BattlePipeline._run_branch in the Python source (trimmed scope —
   * see file header).
   */
  _runBranch(status, weapon, skill, target, build, isCrit, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();
    const isRanged = resolveIsRanged(build, weapon, skill);

    result.add_step({ name: "Status BATK", value: status.batk, note: `STR=${status.str} DEX=${status.dex}`, formula: "str + (str//10)^2 + dex//5 + luk//5", hercules_ref: "status.c status_calc_batk" });
    result.add_step({ name: "Weapon ATK", value: weapon.atk, note: "Raw weapon ATK from item_db", formula: "weapon.atk", hercules_ref: "battle.c battle_calc_base_damage2" });
    if (isCrit) {
      result.add_step({ name: "Branch", value: 0, note: "CRIT BRANCH — damage=atkmax, DEF bypassed", formula: "flag.cri=1", hercules_ref: "battle.c:4988-4989" });
    }

    const ctx = createCalcContext({
      skill_levels: gearBonuses.effective_mastery,
      skill_params: build.skill_params,
      base_level: build.base_level,
      base_str: build.base_str,
      str_: status.str,
      vit: status.vit,
      dex: status.dex,
      int_: status.int_,
      weapon_type: weapon ? weapon.weapon_type : "",
    });

    let pmf = calculateBaseDamage(status, weapon, build, target, skill, result, {
      gear_bonuses: gearBonuses, is_crit: isCrit, is_ranged: isRanged,
    });

    if (gearBonuses.atk_rate) {
      pmf = scaleFloor(pmf, 100 + gearBonuses.atk_rate, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "bAtkRate", value: av, min_value: mn, max_value: mx, multiplier: (100 + gearBonuses.atk_rate) / 100, note: `bAtkRate +${gearBonuses.atk_rate}%`, formula: `dmg*(100+${gearBonuses.atk_rate})//100`, hercules_ref: "battle.c:5330" });
    }

    let hitCount = 1;
    [pmf, hitCount] = calculateSkillRatio(skill, pmf, build, result, {
      target, weapon, profile, ctx, gear_bonuses: gearBonuses,
    });

    if (isCrit) {
      pmf = calculateCritAtkRate(build, pmf, result, { weapon, profile, skill, gb: gearBonuses });
    }

    pmf = calculateDefenseFix(target, build, gearBonuses, pmf, this.config, result, { is_crit: isCrit, skill });

    pmf = calculateActiveStatusBonus(weapon, build, skill, pmf, result, profile);

    pmf = calculateRefineFix(weapon, skill, pmf, result);

    pmf = calculateMasteryFix(weapon, build, target, pmf, result, skill, { profile, ctx });

    const skillData = loader.getSkill(skill.id);
    let effAtkEle = weapon.element;
    if (skill.id !== 0 && skillData) {
      const eleList = skillData.element || [];
      if (eleList.length) {
        const idx = Math.min(skill.level - 1, eleList.length - 1);
        const v = ELE_STR_TO_INT[eleList[idx]];
        if (v != null) effAtkEle = v;
      }
    }
    if (skill.name in (profile.skill_elements || {})) effAtkEle = profile.skill_elements[skill.name];

    pmf = calculateAttrFix(weapon, target, pmf, result, build, effAtkEle);

    const div = hitCount;
    pmf = calculateForgeBonus(weapon, div, pmf, result);

    pmf = calculateCardFix(build, gearBonuses, effAtkEle, target, isRanged, pmf, result);

    pmf = calculateFinalRateBonus(isRanged, pmf, this.config, result);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: isCrit ? "CRIT branch" : "Normal branch", formula: "", hercules_ref: "" });

    result.min_damage = mn;
    result.max_damage = mx;
    result.avg_damage = av;
    result.pmf = pmf;

    return result;
  }

  calculate(status, weapon, skill, target, build, gearBonuses) {
    const skillData = loader.getSkill(skill.id);
    const attackType = skillData ? skillData.attack_type || "Weapon" : "Weapon";
    const skillName = skillData ? skillData.name || "" : "";

    const profile = getProfile(build.server);

    skill.name = skillName;
    const damageType = skillData ? skillData.damage_type || [] : [];
    skill.nk_ignore_def = damageType.includes("IgnoreDefense");
    skill.nk_ignore_flee = damageType.includes("IgnoreFlee");
    skill.ignore_size_fix = skillName === "MO_EXTREMITYFIST";

    const amotion = Math.max(100, Math.round(2000 - status.aspd * 10));
    const adelay = 2 * amotion;

    if (profile.skill_level_cap_overrides && profile.skill_level_cap_overrides[skillName] != null) {
      const cap = profile.skill_level_cap_overrides[skillName];
      if (skill.level > cap) skill = { ...skill, level: cap };
    }

    if (skillName === "CR_GRANDCROSS") {
      const gcResult = this._runGrandCrossBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });

      let castMs = 0, delayMs = 0;
      if (skillData) {
        [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      }
      const gcPeriod = Math.max(castMs + delayMs, 100);
      const attacks = [createAttackDefinition(gcResult.avg_damage, 0.0, gcPeriod, 1.0)];
      const dps = calculateDps(attacks);

      return createBattleResult({
        normal: gcResult,
        crit: null,
        crit_chance: 0.0,
        hit_chance: 100.0,
        dps,
        attacks,
        period_ms: gcPeriod,
        dps_valid: true,
      });
    }

    if (attackType === "Magic") {
      const magicResult = this._runMagicBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });

      let castMs = 0, delayMs = 0;
      if (skillData) {
        [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      }
      const magicPeriod = Math.max(castMs + delayMs, 100);
      const attacks = [createAttackDefinition(magicResult.avg_damage, 0.0, magicPeriod, 1.0)];
      const dps = calculateDps(attacks);

      return createBattleResult({
        normal: magicResult,
        crit: null,
        crit_chance: 0.0,
        hit_chance: 100.0,
        dps,
        attacks,
        period_ms: magicPeriod,
        dps_valid: true,
      });
    }
    if (skillData && (skillData.skill_form === "Misc" || (skillData.damage_type || []).includes("Misc"))) {
      return createBattleResult({
        normal: createDamageResult({
          steps: [{
            name: "Not yet implemented", value: 0, min_value: 0, max_value: 0, multiplier: 1,
            note: `${skillName || "This skill"} uses a BF_MISC formula not yet ported to the JS engine.`,
            formula: "", hercules_ref: "",
          }],
        }),
        dps_valid: false,
      });
    }

    const [isEligible, critChance] = calculateCritChance(status, weapon, skill, target, this.config, build.server);
    let [hitChance, perfectDodge] = calculateHitChance(status, target, this.config);
    if (build.target_mob_id != null) perfectDodge = 0.0;

    if (profile.mechanic_flags.has(`${skillName}_NK_IGNORE_FLEE`)) skill.nk_ignore_flee = true;
    if (skill.nk_ignore_flee) {
      hitChance = 100.0;
      perfectDodge = 0.0;
    }

    const normal = this._runBranch(status, weapon, skill, target, build, false, { profile, gear_bonuses: gearBonuses });
    const crit = isEligible ? this._runBranch(status, weapon, skill, target, build, true, { profile, gear_bonuses: gearBonuses }) : null;

    let period, dpsValid;
    if (skill.id === 0) {
      period = adelay;
      dpsValid = true;
    } else if (skillData) {
      const [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      period = skillPeriodMs(castMs, delayMs, skillData, skill.level, (profile.skill_min_period_ms || {})[skillName], adelay);
      if ((profile.ps_attack_interval || {})[skillName]) period = profile.ps_attack_interval[skillName](status, amotion);
      dpsValid = true; // NOT YET PORTED: IMPLEMENTED_BF_WEAPON_SKILLS allow-list from upstream
    } else {
      period = adelay;
      dpsValid = true;
    }

    const h = hitChance / 100.0;
    const effCrit = critChance / 100.0;
    const normalAvg = normal.avg_damage;
    const critAvg = crit ? crit.avg_damage : normalAvg;

    // TF_DOUBLE (Double Attack) — battle.c:4926. Dagger-only, normal attacks
    // only (skill.id === 0); crit and the proc are mutually exclusive (a
    // critical swing never also double-attacks). The second hit reruns the
    // exact same non-crit pipeline as `normal` — since DPS here only needs
    // the expected value, not a true independent second roll, reusing
    // normal.avg_damage is mathematically equivalent (E[X+Y] = E[X]+E[Y]
    // regardless of independence) and avoids a redundant _runBranch call.
    // NOT YET PORTED: bDoubleRate gear bonus (no consumer in gearBonusAggregator
    // yet), and any interaction with skill-based (non-normal-attack) hits.
    const tfDoubleLv = skill.id === 0 && weapon.weapon_type === "Knife"
      ? (gearBonuses.effective_mastery.TF_DOUBLE || 0)
      : 0;
    const doubleRate = (profile.proc_rate_overrides || {}).TF_DOUBLE ?? 5.0;
    const procChance = tfDoubleLv > 0 ? Math.min(100, doubleRate * tfDoubleLv) : 0;
    const procFrac = procChance / 100.0;

    const attacks = procFrac > 0
      ? [
          createAttackDefinition(normalAvg, 0.0, period, (1.0 - effCrit) * h * (1.0 - procFrac)),
          createAttackDefinition(normalAvg * 2, 0.0, period, (1.0 - effCrit) * h * procFrac),
          createAttackDefinition(0.0, 0.0, period, (1.0 - effCrit) * (1.0 - h)),
          createAttackDefinition(critAvg, 0.0, period, effCrit),
        ]
      : [
          createAttackDefinition(normalAvg, 0.0, period, (1.0 - effCrit) * h),
          createAttackDefinition(0.0, 0.0, period, (1.0 - effCrit) * (1.0 - h)),
          createAttackDefinition(critAvg, 0.0, period, effCrit),
        ];
    const dps = calculateDps(attacks);

    return createBattleResult({
      normal,
      crit,
      crit_chance: critChance,
      hit_chance: hitChance,
      perfect_dodge: perfectDodge,
      dps,
      attacks,
      period_ms: period,
      dps_valid: dpsValid,
      proc_chance: procChance,
      double_hit: procFrac > 0 ? normal : null,
    });
  }
}

module.exports = { BattlePipeline, resolveIsRanged };
