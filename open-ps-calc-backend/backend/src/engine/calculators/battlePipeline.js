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
 *     attack/skill), NJ_ISSEN's fixed-damage formula, and the many small PS-only multiplicative
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
const { uniformPmf, scaleFloor, floorAt, pmfStats, convolve, addFlat } = require("../pmf");

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
const { effectiveIsRanged, resolveWeapon } = require("../buildManager");
const { resolveArmorElement } = require("../buildApplicator");

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

// PF_DOUBLECASTING ("Double Bolt" on the PS wiki) -- 100% chance for these
// specific spells to cast a second time instantly while it's active
// (wiki.payonstories.com/Double_Bolt). Modeled as halving the effective
// attack period rather than doubling per-hit damage, since the bonus is an
// extra free cast, not a stronger one.
const DOUBLECASTING_SKILLS = new Set([
  "MG_FIREBOLT", "MG_COLDBOLT", "MG_LIGHTNINGBOLT", "WZ_EARTHSPIKE", "MG_SOULSTRIKE",
]);

// PS Hunter rework (Hunter_Rework_PayonStories.pdf).
// Formula: SkillLevel * factorA * factorB / divisor — INT/DEX scaling, bypasses DEF.
// Elements from skills.json: LandMine=Earth(2), BlastMine=Wind(4), FreezingTrap=Water(1), Claymore=Fire(3).
const TRAP_SKILL_NAMES = new Set(["HT_LANDMINE", "HT_BLASTMINE", "HT_FREEZINGTRAP", "HT_CLAYMORETRAP"]);
const TRAP_CONFIGS = {
  HT_LANDMINE:     { element: 2 /* Earth */, divisor: 45, factorA: "job_dex",  factorB: "base_int" },
  HT_BLASTMINE:    { element: 4 /* Wind  */, divisor: 45, factorA: "base_dex", factorB: "job_int"  },
  HT_FREEZINGTRAP: { element: 1 /* Water */, divisor: 70, factorA: "job_dex",  factorB: "base_int" },
  HT_CLAYMORETRAP: { element: 3 /* Fire  */, divisor: 70, factorA: "base_dex", factorB: "job_int"  },
};
function trapFactors(cfg, status, build) {
  const joblv = build.job_level || 1, baselv = build.base_level || 1;
  const dex = status.dex || 0, int_ = status.int_ || 0;
  const a = cfg.factorA === "job_dex"  ? joblv + dex  : baselv + dex;
  const b = cfg.factorB === "base_int" ? baselv + int_ : joblv + int_;
  return [a, b];
}

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

// Assassin (12) and Assassin Cross (4013) can dual-wield daggers.
const DUAL_WIELD_JOBS = new Set([12, 4013]);

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
    const mdefIgnorePct =
      (profile.mechanic_flags.has("WZ_FIREPILLAR_MDEF_IGNORE") && skillName === "WZ_FIREPILLAR") ? 50
      : (profile.mechanic_flags.has("HW_NAPALMVULCAN_MDEF_IGNORE") && skillName === "HW_NAPALMVULCAN") ? 50
      // Sage Rework doc: Soul Strike's 50% MDEF ignore requires having LEARNED
      // level 10 of the skill. The calculator's skill level is the cast level, so
      // gate on level 10 (a lv10-learned caster's normal cast); lower selected
      // levels don't get it.
      : (profile.mechanic_flags.has("MG_SOULSTRIKE_MDEF_IGNORE") && skillName === "MG_SOULSTRIKE" && skill.level === 10) ? 50
      : 0;
    // A PS partial MDEF ignore (e.g. Fire Pillar 50%) takes precedence over a
    // vanilla full NK_IGNORE_DEF bypass: vanilla Fire Pillar pierces all MDEF, but
    // PS lowered it to 50%, so run the partial-ignore path instead of bypassing.
    if (mdefIgnorePct > 0 || !skill.nk_ignore_def) {
      pmf = calculateMagicDefenseFix(target, gearBonuses || {}, pmf, result, mdefIgnorePct);
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

    // 4b. PS Soul Strike: +5% damage per skill level vs Undead race
    if (profile.mechanic_flags.has("MG_SOULSTRIKE_UNDEAD_BONUS") && skillName === "MG_SOULSTRIKE" && target.race === "Undead") {
      const bonus = skill.level * 5;
      const multiplier = 1 + bonus / 100;
      pmf = scaleFloor(pmf, 100 + bonus, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({
        name: "Soul Strike vs Undead", value: av, min_value: mn, max_value: mx, multiplier,
        note: `PS: +${bonus}% vs Undead (5% × lv ${skill.level})`,
        formula: `dmg × ${multiplier.toFixed(2)}`, hercules_ref: "",
      });
    }

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
   * PR_TURNUNDEAD — exorcism skill. Its damage is NOT MATK-scaled: on a failed
   * instant-kill roll it deals a fixed Holy hit
   *   damage = (BaseLevel + INT + SkillLevel*10) * 3 * (1 + LUK*3/200)
   * (wiki.payonstories.com/Turn_Undead "Damage Done if Failed" — the standard
   * pre-renewal formula; PS did not change it). Ignores DEF and cards
   * (skills.json damage_type [IgnoreCards, IgnoreDefense]); the Holy AttrFix vs
   * the target's element still applies, exactly like Grand Cross. Only usable on
   * Undead-property monsters; the instant-kill roll itself is not modeled, so
   * this is the guaranteed damage floor. Without this branch the generic magic
   * path would (wrongly) treat it as a 100%-MATK skill.
   */
  _runTurnUndeadBranch(status, weapon, skill, target, build, opts = {}) {
    const result = createDamageResult();

    const core = build.base_level + status.int_ + skill.level * 10;
    const base = core * 3;
    const dmg = Math.max(1, Math.floor(base * (1 + (status.luk * 3) / 200)));

    let pmf = { [dmg]: 1.0 };
    result.add_step({
      name: `Turn Undead Base (Lv ${skill.level})`, value: dmg, min_value: dmg, max_value: dmg,
      note: `Base Lv ${build.base_level}, INT ${status.int_}, LUK ${status.luk} — MATK/ATK not used`,
      formula: "(BaseLv + INT + SkillLv*10) * 3 * (1 + LUK*3/200)",
      hercules_ref: "wiki.payonstories.com/Turn_Undead (fail damage)",
    });

    // DEF and cards ignored (damage_type); Holy element vs target still applies.
    pmf = calculateAttrFix(weapon, target, pmf, result, build, 6 /* Ele_Holy — fixed */);

    {
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "Card Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0, note: "BYPASSED — damage_type includes IgnoreCards", formula: "no change", hercules_ref: "skills.json damage_type" });
    }

    pmf = floorAt(pmf, 1);
    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: "Turn Undead branch (fail damage; instant-kill roll not modeled)", formula: "", hercules_ref: "" });

    result.min_damage = mn;
    result.max_damage = mx;
    result.avg_damage = av;
    result.pmf = pmf;
    return result;
  }

  /**
   * CR_REFLECTSHIELD — PS rework formula:
   *   damage = floor(SoftDEF × (1 + 1.75 × HardDEF / 100) × SkillLvl / 10)
   * Ignores target DEF. Requires hit roll. Enhanced by cards and armor attributes.
   */

  /**
   * PS rework: MO_EXTREMITYFIST (Asura Strike).
   * Formula: ATK × (8 + floor(SP/10)) + flat
   * PS: SP consumed = floor(MaxSP × 0.2 × SkillLv); vanilla: all remaining SP.
   * Ignores DEF, always hits (IgnoreFlee), ignores size fix, mastery, and refine.
   */
  _runAsuraStrikeBranch(status, weapon, skill, target, build, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();

    const psRework = profile.mechanic_flags.has("MO_EXTREMITYFIST_PS_SP_REWORK");
    let spConsumed, spNote;
    if (psRework) {
      spConsumed = Math.floor(status.max_sp * 0.2 * skill.level);
      spNote = `MaxSP(${status.max_sp}) × ${20 * skill.level}% = ${spConsumed}`;
    } else {
      spConsumed = build.current_sp != null ? build.current_sp : status.max_sp;
      spNote = `All remaining SP = ${spConsumed}`;
    }

    const flatBonus = [400, 550, 700, 850, 1000][skill.level - 1] ?? 1000;
    const spDiv = Math.floor(spConsumed / 10);
    const skillRatio = (8 + spDiv) * 100;

    let pmf = calculateBaseDamage(status, weapon, build, target, skill, result, {
      gear_bonuses: gearBonuses, is_crit: false, is_ranged: false,
    });

    pmf = scaleFloor(pmf, skillRatio, 100);
    let [mn, mx, av] = pmfStats(pmf);
    result.add_step({
      name: "Asura Strike Ratio",
      value: av, min_value: mn, max_value: mx, multiplier: skillRatio / 100,
      note: `SP: ${spNote}; ratio = (8 + floor(${spConsumed}/10)) × 100 = ${skillRatio}%`,
      formula: `ATK × (8 + floor(SP/10)) = ATK × ${8 + spDiv}`,
      hercules_ref: "battle.c battle_calc_skillratio MO_EXTREMITYFIST",
    });

    pmf = addFlat(pmf, flatBonus);
    [mn, mx, av] = pmfStats(pmf);
    result.add_step({
      name: "Asura Strike Flat",
      value: av, min_value: mn, max_value: mx, multiplier: 1.0,
      note: `+${flatBonus} flat at Lv${skill.level}`,
      formula: `+ ${flatBonus}`,
      hercules_ref: "battle.c battle_calc_skillratio MO_EXTREMITYFIST",
    });

    // NK_IGNORE_DEF: no defense step
    pmf = calculateActiveStatusBonus(weapon, build, skill, pmf, result, profile);
    pmf = calculateRefineFix(weapon, skill, pmf, result);
    pmf = calculateMasteryFix(weapon, build, target, pmf, result, skill, { profile });
    pmf = calculateAttrFix(weapon, target, pmf, result, build, 0 /* Ele_Neutral */);
    pmf = calculateForgeBonus(weapon, 1, pmf, result);
    pmf = calculateCardFix(build, gearBonuses, 0 /* Ele_Neutral */, target, false, pmf, result);
    pmf = calculateFinalRateBonus(false, pmf, this.config, result);
    pmf = floorAt(pmf, 1);

    [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: "Asura Strike branch", formula: "", hercules_ref: "" });
    result.min_damage = mn; result.max_damage = mx; result.avg_damage = av; result.pmf = pmf;
    return result;
  }

  _runReflectShieldBranch(status, weapon, skill, target, build, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();

    const softDef = status.def2;
    const hardDef = status.def_;
    const baseDmg = Math.floor(softDef * (1 + 1.75 * hardDef / 100) * skill.level / 10);
    let pmf = uniformPmf(baseDmg, baseDmg);
    result.add_step({
      name: "Reflect Shield Base",
      value: baseDmg, min_value: baseDmg, max_value: baseDmg,
      note: `Soft DEF ${softDef} × (1 + 1.75 × ${hardDef}/100) × Lv${skill.level}/10`,
      formula: "floor(SoftDEF × (1 + 1.75 × HardDEF/100) × SkillLvl/10)",
      hercules_ref: "wiki.payonstories.com/Reflect_Shield — PS rework",
    });

    // Ignores target DEF — no defenseFix step.
    // "Enhanced by cards and armor attributes" (PDF): damage element follows the
    // player's armor element (changed by cards like Ghostring, Evil Druid, etc.).
    const rsEle = resolveArmorElement(build.armor_element ?? 0, gearBonuses);
    pmf = calculateAttrFix(weapon, target, pmf, result, build, rsEle);
    pmf = calculateCardFix(build, gearBonuses, rsEle, target, false /* melee */, pmf, result);
    pmf = calculateFinalRateBonus(false, pmf, this.config, result);
    pmf = floorAt(pmf, 1);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: "Reflect Shield branch", formula: "", hercules_ref: "" });
    result.min_damage = mn;
    result.max_damage = mx;
    result.avg_damage = av;
    result.pmf = pmf;
    return result;
  }

  /**
   * PS Hunter rework traps (Hunter_Rework_PayonStories.pdf).
   * Formula: floor(SkillLevel * factorA * factorB / divisor)
   *   Land Mine:     lv * (JobLv+DEX) * (BaseLv+INT) / 45  — Earth element
   *   Blast Mine:    lv * (BaseLv+DEX) * (JobLv+INT) / 45  — Wind element
   *   Freezing Trap: lv * (JobLv+DEX) * (BaseLv+INT) / 70  — Water element
   *   Claymore Trap: lv * (BaseLv+DEX) * (JobLv+INT) / 70  — Fire element
   * Always hits (IgnoreFlee). Bypasses DEF (formula gives final pre-element damage).
   * Verified: Hunter 99/50 DEX150/INT100 → LandMine=4422, BlastMine=4150,
   *   FreezingTrap=2842, Claymore=2667 (all match PDF comparison table).
   */
  _runTrapBranch(status, weapon, skill, target, build, opts = {}) {
    const { gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();
    const skillName = skill.name;
    const cfg = TRAP_CONFIGS[skillName];
    const [factA, factB] = trapFactors(cfg, status, build);
    const baseDmg = Math.floor(skill.level * factA * factB / cfg.divisor);

    let pmf = uniformPmf(baseDmg, baseDmg);
    result.add_step({
      name: "Trap Base",
      value: baseDmg, min_value: baseDmg, max_value: baseDmg,
      note: `Lv${skill.level} × ${factA} × ${factB} / ${cfg.divisor} = ${baseDmg}`,
      formula: `floor(SkillLv × factorA × factorB / ${cfg.divisor})`,
      hercules_ref: "Hunter_Rework_PayonStories.pdf",
    });

    const skillAtkBonus = gearBonuses ? (gearBonuses.skill_atk[skillName] || 0) : 0;
    if (skillAtkBonus) {
      pmf = scaleFloor(pmf, 100 + skillAtkBonus, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({
        name: "Skill ATK Bonus", value: av, min_value: mn, max_value: mx,
        multiplier: (100 + skillAtkBonus) / 100,
        note: `bSkillAtk: ${skillName} +${skillAtkBonus}%`,
        formula: `dmg × (100+${skillAtkBonus})/100`,
        hercules_ref: "pc.c:3513-3527",
      });
    }

    pmf = calculateAttrFix(weapon, target, pmf, result, build, cfg.element);
    pmf = calculateCardFix(build, gearBonuses, cfg.element, target, false /* melee */, pmf, result);
    pmf = calculateFinalRateBonus(false, pmf, this.config, result);
    pmf = floorAt(pmf, 1);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: `${skillName} trap branch`, formula: "", hercules_ref: "" });
    result.min_damage = mn; result.max_damage = mx; result.avg_damage = av; result.pmf = pmf;
    return result;
  }

  /**
   * CR_SHIELDBOOMERANG — PS formula (wiki.payonstories.com/Shield_Boomerang):
   *   damage = floor((BATK + shield_weight) × ratio / 100) + shield_refine × 10
   * Ratios per level: [130, 180, 220, 260, 300].
   * Weapon ATK and size fix are excluded. Neutral element. Mastery flat bonuses apply (PS).
   * Ranged attack; always hits monsters (nk_ignore_flee via mechanic_flags).
   */
  _runShieldBoomerangBranch(status, weapon, skill, target, build, opts = {}) {
    const { profile = STANDARD, gear_bonuses: gearBonuses } = opts;
    const result = createDamageResult();
    const skillName = "CR_SHIELDBOOMERANG";

    const shieldId = build.equipped && build.equipped.left_hand;
    const shieldItem = shieldId ? loader.getItem(shieldId) : null;
    const shieldWeight = shieldItem ? (shieldItem.weight || 0) : 0;
    const shieldRefine = (build.refine_levels && build.refine_levels.left_hand) || 0;

    // item_db stores weight as 10× the in-game displayed value (e.g. Buckler: db=600, displayed=60)
    const displayWeight = Math.floor(shieldWeight / 10);
    // PS skill DB ratios per level (ps_skill_db.json id 251): [140, 180, 220, 260, 300]
    const SB_RATIOS = [140, 180, 220, 260, 300];
    const ratio = SB_RATIOS[Math.min(skill.level, SB_RATIOS.length) - 1] ?? 140;

    const baseSum = status.batk + displayWeight;
    const baseDmg = Math.floor(baseSum * ratio / 100);
    let pmf = uniformPmf(baseDmg, baseDmg);
    result.add_step({
      name: "Shield Boomerang Base",
      value: baseDmg, min_value: baseDmg, max_value: baseDmg,
      note: shieldItem
        ? `BATK ${status.batk} + ${shieldItem.name || "shield"} weight ${displayWeight} (db:${shieldWeight}/10) = ${baseSum} × ${ratio}%`
        : `BATK ${status.batk} (no shield equipped) × ${ratio}%`,
      formula: `floor((BATK + shield_weight_displayed) × ${ratio} / 100)`,
      hercules_ref: "wiki.payonstories.com/Shield_Boomerang — PS formula",
    });

    const skillAtkBonus = gearBonuses ? (gearBonuses.skill_atk[skillName] || 0) : 0;
    if (skillAtkBonus) {
      pmf = scaleFloor(pmf, 100 + skillAtkBonus, 100);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "Skill ATK Bonus", value: av, min_value: mn, max_value: mx, multiplier: (100 + skillAtkBonus) / 100, note: `bSkillAtk: ${skillName} +${skillAtkBonus}%`, formula: `dmg × (100+${skillAtkBonus})/100`, hercules_ref: "pc.c:3513-3527" });
    }

    pmf = calculateDefenseFix(target, build, gearBonuses, pmf, this.config, result, { is_crit: false, skill });

    // Mastery flat bonuses apply on PS (wiki.payonstories.com/Shield_Boomerang)
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
    pmf = calculateMasteryFix(weapon, build, target, pmf, result, skill, { profile, ctx });

    // Shield upgrade: +10 flat per refine level, added post-DEF like atk2
    if (shieldRefine > 0) {
      const refineFlat = shieldRefine * 10;
      pmf = addFlat(pmf, refineFlat);
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({
        name: "Shield Upgrade Bonus",
        value: av, min_value: mn, max_value: mx,
        note: `+${shieldRefine} refine × 10 = flat +${refineFlat}`,
        formula: "damage + shield_refine × 10",
        hercules_ref: "wiki.payonstories.com/Shield_Boomerang",
      });
    }

    // Neutral element — always, regardless of weapon element
    pmf = calculateAttrFix(weapon, target, pmf, result, build, 0 /* Ele_Neutral */);

    pmf = calculateCardFix(build, gearBonuses, 0 /* Ele_Neutral */, target, true /* isRanged */, pmf, result);

    pmf = calculateFinalRateBonus(true /* isRanged */, pmf, this.config, result);

    pmf = floorAt(pmf, 1);

    const [mn, mx, av] = pmfStats(pmf);
    result.add_step({ name: "Final Damage", value: av, min_value: mn, max_value: mx, note: "Shield Boomerang branch", formula: "", hercules_ref: "" });
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

    result.add_step({ name: "Status BATK", value: status.batk, note: `STR=${status.str} DEX=${status.dex}`, formula: "str + (str//10)^2 + dex//5 + luk//5", hercules_ref: "status.c status_calc_batk", info: true });
    result.add_step({ name: "Weapon ATK", value: weapon.atk, note: "Raw weapon ATK from item_db", formula: "weapon.atk", hercules_ref: "battle.c battle_calc_base_damage2", info: true });
    if (isCrit) {
      result.add_step({ name: "Branch", value: 0, note: "CRIT BRANCH — damage=atkmax, DEF bypassed", formula: "flag.cri=1", hercules_ref: "battle.c:4988-4989", info: true });
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

    // NOTE: bSkillAtk (skill-specific damage bonus from cards/items, e.g. Yser
    // Card) is applied inside calculateSkillRatio() above — do NOT re-apply it
    // here or it double-counts (was inflating every weapon skill with a
    // bSkillAtk bonus, e.g. Acid Terror +30%, by that percentage twice).

    // PS Rogue rework: Backstab Opportunity — ×1.4 when monster is not targeting
    // the Rogue (or player is not facing the Rogue in PvP).
    if (skill.name === "RG_BACKSTAP" && profile.mechanic_flags.has("RG_BACKSTAP_OPPORTUNITY")
        && build.support_buffs?.backstab_opportunity) {
      pmf = scaleFloor(pmf, 140, 100);
      const [mnO, mxO, avO] = pmfStats(pmf);
      result.add_step({ name: "Backstab Opportunity", value: avO, min_value: mnO, max_value: mxO, multiplier: 1.4, note: "Not targeted / not facing: ×1.4", formula: "dmg × 140 / 100", hercules_ref: "Rogue_Patchnotes_PayonStories.pdf" });
    }

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

    // PS rework: Envenom uses weapon element instead of forced Poison.
    if (profile.mechanic_flags.has("TF_POISON_USES_WEAPON_ELEMENT") && skill.name === "TF_POISON") effAtkEle = weapon.element;

    if (!skill.nk_ignore_ele) {
      pmf = calculateAttrFix(weapon, target, pmf, result, build, effAtkEle);
    } else {
      const [mnE, mxE, avE] = pmfStats(pmf);
      result.add_step({ name: "Element (AttrFix)", value: avE, min_value: mnE, max_value: mxE, multiplier: 1.0, note: "BYPASSED — NK_IGNORE_ELEMENT", formula: "no change", hercules_ref: "battle.c NK_IGNORE_ELEMENT" });
    }

    // PS rework: Enchant Poison passive — +2%/lv vs Poison element targets.
    const ELE_POISON = 5;
    const enchantPoisonLv = profile.mechanic_flags.has("AS_ENCHANTPOISON_PASSIVE_BONUS")
      ? (gearBonuses.effective_mastery?.AS_ENCHANTPOISON || 0) : 0;
    if (enchantPoisonLv > 0 && target.element === ELE_POISON) {
      const bonusPct = 2 * enchantPoisonLv;
      pmf = scaleFloor(pmf, 100 + bonusPct, 100);
      const [mn2, mx2, av2] = pmfStats(pmf);
      result.add_step({ name: "Enchant Poison Passive", value: av2, min_value: mn2, max_value: mx2, multiplier: (100 + bonusPct) / 100, note: `AS_ENCHANTPOISON Lv ${enchantPoisonLv}: +${bonusPct}% vs Poison element`, formula: `dmg × ${100 + bonusPct} / 100`, hercules_ref: "PS-AssassinRework" });
    }

    const div = hitCount;
    pmf = calculateForgeBonus(weapon, div, pmf, result);

    // NK_IGNORE_CARDS (e.g. Acid Terror): the skill's damage is unaffected by
    // card damage modifiers (bAddRace/bAddEle/bAddSize/atk-ele and the target's
    // card-based resists), so skip the Card Fix stage entirely. Flat ATK cards
    // (Andre etc.) still count — they live in ATK, not here.
    if (skill.nk_ignore_cards) {
      const [mn, mx, av] = pmfStats(pmf);
      result.add_step({ name: "Card Fix", value: av, min_value: mn, max_value: mx, multiplier: 1.0, note: "BYPASSED — damage_type includes IgnoreCards", formula: "no change", hercules_ref: "skills.json damage_type / battle.c NK_IGNORE_CARDS" });
    } else {
      pmf = calculateCardFix(build, gearBonuses, effAtkEle, target, isRanged, pmf, result);
    }

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

    // SM_MAGNUM_ENDOW_ATTACK_ONLY (Crusader rework): Magnum Break's fire semi-endow
    // applies only to auto attacks on PS — strip it from skill damage calculations.
    if (
      skill.id > 0 && skillName !== "SM_MAGNUM" &&
      profile.mechanic_flags.has("SM_MAGNUM_ENDOW_ATTACK_ONLY") &&
      build.support_buffs?.weapon_endow_sc
    ) {
      build = { ...build, weapon_element: weapon ? (weapon.element ?? 0) : 0 };
    }

    skill.name = skillName;
    const damageType = skillData ? skillData.damage_type || [] : [];
    skill.nk_ignore_def = damageType.includes("IgnoreDefense");
    skill.nk_ignore_flee = damageType.includes("IgnoreFlee");
    skill.nk_ignore_ele = damageType.includes("IgnoreElement");
    skill.nk_ignore_cards = damageType.includes("IgnoreCards");
    skill.ignore_size_fix = skillName === "MO_EXTREMITYFIST";

    const amotion = Math.max(100, Math.round(2000 - status.aspd * 10));
    const adelay = 2 * amotion;

    if (profile.skill_level_cap_overrides && profile.skill_level_cap_overrides[skillName] != null) {
      const cap = profile.skill_level_cap_overrides[skillName];
      if (skill.level > cap) skill = { ...skill, level: cap };
    }

    if (skillName === "MO_EXTREMITYFIST") {
      const asuraResult = this._runAsuraStrikeBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });
      let castMs = 0, delayMs = 0;
      if (skillData) [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      const asuraPeriod = Math.max(castMs + delayMs, 100);
      const attacks = [createAttackDefinition(asuraResult.avg_damage, 0.0, asuraPeriod, 1.0)];
      return createBattleResult({
        normal: asuraResult, crit: null, crit_chance: 0.0, hit_chance: 100.0,
        dps: calculateDps(attacks), attacks, period_ms: asuraPeriod, dps_valid: true,
      });
    }

    if (skillName === "CR_REFLECTSHIELD") {
      const [hitChanceRS] = calculateHitChance(status, target, this.config);
      const rsResult = this._runReflectShieldBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });
      const rsAttacks = [
        createAttackDefinition(rsResult.avg_damage, 0.0, amotion, hitChanceRS / 100.0),
        createAttackDefinition(0.0, 0.0, amotion, 1.0 - hitChanceRS / 100.0),
      ];
      return createBattleResult({
        normal: rsResult,
        crit: null,
        crit_chance: 0.0,
        hit_chance: hitChanceRS,
        dps: 0,
        attacks: rsAttacks,
        period_ms: amotion,
        // DPS depends on monster attack speed, not player ASPD — not calculable here.
        dps_valid: false,
      });
    }

    if (skillName === "CR_SHIELDBOOMERANG") {
      if (profile.mechanic_flags.has("CR_SHIELDBOOMERANG_NK_IGNORE_FLEE")) skill.nk_ignore_flee = true;
      const [hitChanceSB] = calculateHitChance(status, target, this.config);
      const effectiveHitSB = skill.nk_ignore_flee ? 100.0 : hitChanceSB;
      const sbResult = this._runShieldBoomerangBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });
      let castMs = 0, delayMs = 0;
      if (skillData) {
        [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      }
      const sbPeriod = Math.max(castMs + delayMs, 100);
      const attacks = [
        createAttackDefinition(sbResult.avg_damage, 0.0, sbPeriod, effectiveHitSB / 100.0),
        createAttackDefinition(0.0, 0.0, sbPeriod, 1.0 - effectiveHitSB / 100.0),
      ];
      const dps = calculateDps(attacks);
      return createBattleResult({
        normal: sbResult,
        crit: null,
        crit_chance: 0.0,
        hit_chance: effectiveHitSB,
        dps,
        attacks,
        period_ms: sbPeriod,
        dps_valid: true,
      });
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

    if (skillName === "PR_TURNUNDEAD") {
      const tuResult = this._runTurnUndeadBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });
      let castMs = 0, delayMs = 0;
      if (skillData) [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      const tuPeriod = Math.max(castMs + delayMs, 100);
      const attacks = [createAttackDefinition(tuResult.avg_damage, 0.0, tuPeriod, 1.0)];
      return createBattleResult({
        normal: tuResult, crit: null, crit_chance: 0.0, hit_chance: 100.0,
        dps: calculateDps(attacks), attacks, period_ms: tuPeriod, dps_valid: true,
      });
    }

    if (attackType === "Magic") {
      const magicResult = this._runMagicBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });

      let castMs = 0, delayMs = 0;
      if (skillData) {
        [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
      }
      let magicPeriod = Math.max(castMs + delayMs, 100);

      const doubleCastingLv = Number((build.active_status_levels || {}).SC_DOUBLECASTING || 0);
      if (doubleCastingLv > 0 && DOUBLECASTING_SKILLS.has(skillName)) {
        magicPeriod = magicPeriod / 2;
        magicResult.add_step({
          name: "Double Casting", value: magicResult.avg_damage, min_value: magicResult.min_damage, max_value: magicResult.max_damage, multiplier: 1.0,
          note: "SC_DOUBLECASTING (PF_DOUBLECASTING): 100% chance to cast a second time instantly -- modeled as half the effective attack period (DPS only, not per-hit damage).",
          formula: "period / 2", hercules_ref: "skill.c pc_use_skill PF_DOUBLECASTING",
        });
      }

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
    if (TRAP_SKILL_NAMES.has(skillName)) {
      if (profile.mechanic_flags.has("HT_TRAP_PS_FORMULA")) {
        const trapResult = this._runTrapBranch(status, weapon, skill, target, build, { profile, gear_bonuses: gearBonuses });
        let castMs = 0, delayMs = 0;
        if (skillData) [castMs, delayMs] = calculateSkillTiming(skillName, skill.level, skillData, status, gearBonuses, build.support_buffs, build.server);
        const trapPeriod = Math.max(castMs + delayMs, 100);
        const trapAttacks = [createAttackDefinition(trapResult.avg_damage, 0.0, trapPeriod, 1.0)];
        return createBattleResult({
          normal: trapResult, crit: null, crit_chance: 0.0, hit_chance: 100.0,
          dps: calculateDps(trapAttacks), attacks: trapAttacks, period_ms: trapPeriod, dps_valid: true,
        });
      }
      return createBattleResult({
        normal: createDamageResult({ steps: [{
          name: "Not yet implemented", value: 0, min_value: 0, max_value: 0, multiplier: 1,
          note: `${skillName}: trap formula not yet ported for non-PS profiles.`,
          formula: "", hercules_ref: "",
        }] }),
        dps_valid: false,
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

    const [isEligible, critChance] = calculateCritChance(status, weapon, skill, target, this.config, build.server, gearBonuses);
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

    // Katar second hit — auto-attack only; proc rate = 2× the TF_DOUBLE rate.
    // PS rework damage: (21 + 4×AS_KATAR_lv)% of main hit (was flat 21% vanilla).
    let katarSecond = null;
    let katarSecondCrit = null;
    let katarProcChance = 0;
    if (skill.id === 0 && weapon.weapon_type === "Katar" && profile.mechanic_flags.has("AS_KATAR_SECOND_HIT")) {
      const katarTFDoubleLv = gearBonuses.effective_mastery.TF_DOUBLE || 0;
      if (katarTFDoubleLv > 0) {
        const katarMasteryLv = gearBonuses.effective_mastery.AS_KATAR || 0;
        const katarDoubleRatePerLv = (profile.proc_rate_overrides || {}).TF_DOUBLE ?? 5.0;
        katarProcChance = Math.min(100, 2 * katarDoubleRatePerLv * katarTFDoubleLv + (gearBonuses.double_rate || 0));
        const katarScale = (21 + 4 * katarMasteryLv) / 100;
        const scalePct = (katarScale * 100).toFixed(0);

        katarSecond = createDamageResult({
          min_damage: Math.floor(normal.min_damage * katarScale),
          max_damage: Math.floor(normal.max_damage * katarScale),
          avg_damage: normal.avg_damage * katarScale,
        });
        katarSecond.add_step({ name: "Katar 2nd hit", value: normal.avg_damage * katarScale, min_value: Math.floor(normal.min_damage * katarScale), max_value: Math.floor(normal.max_damage * katarScale), note: `Proc: ${katarProcChance}% · ${scalePct}% of main hit (21% base + ${4 * katarMasteryLv}% from AS_KATAR Lv${katarMasteryLv})`, formula: `main × ${scalePct} / 100`, hercules_ref: "PS-AssassinRework" });

        if (crit) {
          katarSecondCrit = createDamageResult({
            min_damage: Math.floor(crit.min_damage * katarScale),
            max_damage: Math.floor(crit.max_damage * katarScale),
            avg_damage: crit.avg_damage * katarScale,
          });
          katarSecondCrit.add_step({ name: "Katar 2nd hit (crit)", value: crit.avg_damage * katarScale, min_value: Math.floor(crit.min_damage * katarScale), max_value: Math.floor(crit.max_damage * katarScale), note: `Proc: ${katarProcChance}% · ${scalePct}% of crit hit`, formula: `crit × ${scalePct} / 100`, hercules_ref: "PS-AssassinRework" });
        }
      }
    }

    // TF_DOUBLE (Double Attack) — battle.c:4926. Dagger-only, normal attacks
    // only (skill.id === 0); crit and the proc are mutually exclusive (a
    // critical swing never also double-attacks). The second hit reruns the
    // exact same non-crit pipeline as `normal` — since DPS here only needs
    // the expected value, not a true independent second roll, reusing
    // normal.avg_damage is mathematically equivalent (E[X+Y] = E[X]+E[Y]
    // regardless of independence) and avoids a redundant _runBranch call.
    // bDoubleRate (e.g. Sidewinder Card) is a separate, weapon-unrestricted
    // source of the same proc -- Hercules adds it to the TF_DOUBLE skill
    // rate in the same roll (battle.c battle_calc_weapon_attack), so it's
    // additive here too, just without the dagger/normal-attack-only
    // restriction TF_DOUBLE itself has.
    let tfDoubleLv = 0;
    if (skill.id === 0 && weapon.weapon_type === "Knife") {
      tfDoubleLv = gearBonuses.effective_mastery.TF_DOUBLE || 0;
    } else if (skill.id === 0 && weapon.weapon_type === "Bow"
        && profile.mechanic_flags.has("RG_BOW_DOUBLE_ATTACK")) {
      // PS Rogue rework: Vulture's Eye enables Double Attack with a bow.
      // Proc chance = doubleRate × min(TF_DOUBLE_lv, AC_VULTURE_lv).
      const bowDA = gearBonuses.effective_mastery.TF_DOUBLE || 0;
      const vultureLv = gearBonuses.effective_mastery.AC_VULTURE || 0;
      if (bowDA > 0 && vultureLv > 0) tfDoubleLv = Math.min(bowDA, vultureLv);
    }
    const doubleRate = (profile.proc_rate_overrides || {}).TF_DOUBLE ?? 5.0;
    const skillProcChance = tfDoubleLv > 0 ? doubleRate * tfDoubleLv : 0;
    const itemDoubleRate = skill.id === 0 ? (gearBonuses.double_rate || 0) : 0;
    const procChance = Math.min(100, skillProcChance + itemDoubleRate);
    const procFrac = procChance / 100.0;

    // MO_TRIPLEATTACK proc — auto-attacks only (Monk/Champion). TA replaces
    // the auto-attack on proc (unlike TF_DOUBLE which adds a second hit).
    // PS rework: 5 levels, base rates [28,26,24,22,20]%; Knuckle weapons gain
    // +0.2×lv% per 10 job levels (e.g. +5% total at rank 5, j50).
    // MO_TRIPLEATTACK_PS_BONUS flag: TA proc can crit when SC_EXPLOSIONSPIRITS
    // (Critical Explosion / Fury) is active.
    const taLv = skill.id === 0 ? (gearBonuses.effective_mastery.MO_TRIPLEATTACK || 0) : 0;
    let taProc = null, taCritProc = null, taProcChance = 0;
    if (taLv > 0) {
      const taRates = (profile.proc_rate_overrides || {}).MO_TRIPLEATTACK;
      if (taRates) {
        let baseRate = Array.isArray(taRates) ? (taRates[taLv] ?? 0) : taRates * taLv;
        if (weapon.weapon_type === "Knuckle") {
          baseRate += 0.2 * taLv * Math.floor((build.job_level || 1) / 10);
        }
        taProcChance = Math.min(100, baseRate);
        const taSkill = { id: 263, name: "MO_TRIPLEATTACK", level: taLv, nk_ignore_flee: false };
        taProc = this._runBranch(status, weapon, taSkill, target, build, false, { profile, gear_bonuses: gearBonuses });
        const furyActive = profile.mechanic_flags.has("MO_TRIPLEATTACK_PS_BONUS")
          && "SC_EXPLOSIONSPIRITS" in (build.active_status_levels || {});
        if (furyActive) {
          taCritProc = this._runBranch(status, weapon, taSkill, target, build, true, { profile, gear_bonuses: gearBonuses });
        }
      }
    }
    const tpf = taProcChance / 100.0;
    const taAvg = taProc ? taProc.avg_damage : 0;
    const taCritAvg = taCritProc ? taCritProc.avg_damage : taAvg;

    // PS dual-wield: three-hit model per auto-attack.
    // Hits 1 & 2 are both RH attacks with the same damage roll (×rhFactor each).
    // Hit 3 is the LH weapon (×lhFactor). Expected total = 2×RH×rhFactor + LH×lhFactor.
    // Gated by DUAL_WIELD_PS_THREE_HIT — remove that flag from PS_MECHANIC_FLAGS to revert.
    let dualWield = null;
    if (
      skill.id === 0 &&
      profile.mechanic_flags.has("DUAL_WIELD_PS_THREE_HIT") &&
      DUAL_WIELD_JOBS.has(build.job_id) &&
      build.equipped && build.equipped.left_hand
    ) {
      const lhItem = loader.getItem(build.equipped.left_hand);
      if (lhItem && lhItem.type === "IT_WEAPON") {
        const lhWeapon = resolveWeapon(
          loader,
          build.equipped.left_hand,
          (build.refine_levels || {}).left_hand || 0,
        );
        if (lhWeapon) {
          const rhLv = gearBonuses.effective_mastery.AS_RIGHT || 0;
          const lhLv = gearBonuses.effective_mastery.AS_LEFT  || 0;
          const rhSpec = (profile.passive_overrides || {}).AS_RIGHT || {};
          const lhSpec = (profile.passive_overrides || {}).AS_LEFT  || {};
          // Vanilla base penalty: RH=50%, LH=30%. PS mastery overrides that directly.
          const rhFactor = rhSpec.rh_factors
            ? (rhLv > 0 ? (rhSpec.rh_factors[rhLv - 1] ?? 0.50) : 0.50)
            : (rhLv > 0 ? (0.50 + 0.10 * rhLv) : 0.50);
          const lhFactor = lhSpec.lh_factors
            ? (lhLv > 0 ? (lhSpec.lh_factors[lhLv - 1] ?? 0.30) : 0.30)
            : (lhLv > 0 ? (0.30 + 0.10 * lhLv) : 0.30);

          const lhNormal = this._runBranch(status, lhWeapon, skill, target, build, false, { profile, gear_bonuses: gearBonuses });
          const lhCrit   = isEligible ? this._runBranch(status, lhWeapon, skill, target, build, true,  { profile, gear_bonuses: gearBonuses }) : null;
          const lhCritAvg = lhCrit ? lhCrit.avg_damage : lhNormal.avg_damage;

          const dwBonusPct = profile.mechanic_flags.has("DUAL_WIELD_PS_DAMAGE_BONUS") ? 10 : 0;
          const dwBonusMult = 1 + dwBonusPct / 100;

          dualWield = {
            lhWeapon, lhNormal, lhCrit, rhFactor, lhFactor,
            dw_ps_bonus_pct: dwBonusPct,
            combinedNormalAvg: (2 * normalAvg * rhFactor + lhNormal.avg_damage * lhFactor) * dwBonusMult,
            combinedCritAvg:   (2 * critAvg   * rhFactor + lhCritAvg           * lhFactor) * dwBonusMult,
          };
        }
      }
    }

    // Build attacks array. TA proc takes priority over TF_DOUBLE (Monks don't
    // use Knives, so both shouldn't apply simultaneously in practice).
    let attacks;
    if (dualWield) {
      // Dual-wield: crits auto-hit; hit/miss applies to non-crit swings only.
      attacks = [
        createAttackDefinition(dualWield.combinedCritAvg,   0.0, period, effCrit),
        createAttackDefinition(dualWield.combinedNormalAvg, 0.0, period, (1.0 - effCrit) * h),
        createAttackDefinition(0.0,                         0.0, period, (1.0 - effCrit) * (1.0 - h)),
      ];
    } else if (tpf > 0 && taProc) {
      if (taCritProc) {
        // Fury active: TA proc can crit (independent of normal crit roll)
        attacks = [
          createAttackDefinition(taCritAvg,  0.0, period, effCrit * tpf),
          createAttackDefinition(critAvg,     0.0, period, effCrit * (1.0 - tpf)),
          createAttackDefinition(taAvg,       0.0, period, (1.0 - effCrit) * tpf * h),
          createAttackDefinition(0.0,         0.0, period, (1.0 - effCrit) * tpf * (1.0 - h)),
          createAttackDefinition(normalAvg,   0.0, period, (1.0 - effCrit) * (1.0 - tpf) * h),
          createAttackDefinition(0.0,         0.0, period, (1.0 - effCrit) * (1.0 - tpf) * (1.0 - h)),
        ];
      } else {
        // No Fury: TA can't crit; crits happen only on non-proc swings
        attacks = [
          createAttackDefinition(critAvg,     0.0, period, effCrit),
          createAttackDefinition(taAvg,       0.0, period, (1.0 - effCrit) * tpf * h),
          createAttackDefinition(0.0,         0.0, period, (1.0 - effCrit) * tpf * (1.0 - h)),
          createAttackDefinition(normalAvg,   0.0, period, (1.0 - effCrit) * (1.0 - tpf) * h),
          createAttackDefinition(0.0,         0.0, period, (1.0 - effCrit) * (1.0 - tpf) * (1.0 - h)),
        ];
      }
    } else if (procFrac > 0) {
      attacks = [
        createAttackDefinition(normalAvg, 0.0, period, (1.0 - effCrit) * h * (1.0 - procFrac)),
        createAttackDefinition(normalAvg * 2, 0.0, period, (1.0 - effCrit) * h * procFrac),
        createAttackDefinition(0.0, 0.0, period, (1.0 - effCrit) * (1.0 - h)),
        createAttackDefinition(critAvg, 0.0, period, effCrit),
      ];
    } else {
      attacks = [
        createAttackDefinition(normalAvg, 0.0, period, (1.0 - effCrit) * h),
        createAttackDefinition(0.0, 0.0, period, (1.0 - effCrit) * (1.0 - h)),
        createAttackDefinition(critAvg, 0.0, period, effCrit),
      ];
    }

    if (katarProcChance > 0 && katarSecond) {
      const kpf = katarProcChance / 100;
      attacks.push(createAttackDefinition(katarSecond.avg_damage, 0.0, period, kpf * (1.0 - effCrit) * h));
      if (katarSecondCrit) attacks.push(createAttackDefinition(katarSecondCrit.avg_damage, 0.0, period, kpf * effCrit));
    }

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
      katar_second: katarSecond,
      katar_second_crit: katarSecondCrit,
      katar_proc_chance: katarProcChance,
      ta_proc: taProc,
      ta_crit_proc: taCritProc,
      ta_proc_chance: taProcChance,
      dw_lh_normal:    dualWield ? dualWield.lhNormal        : null,
      dw_lh_crit:      dualWield ? dualWield.lhCrit          : null,
      dw_rh_factor:    dualWield ? dualWield.rhFactor         : null,
      dw_lh_factor:    dualWield ? dualWield.lhFactor         : null,
      dw_ps_bonus_pct: dualWield ? dualWield.dw_ps_bonus_pct : null,
    });
  }
}

module.exports = { BattlePipeline, resolveIsRanged };
