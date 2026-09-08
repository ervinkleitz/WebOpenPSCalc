/**
 * mobSkillRatios.js — damage %-ratios for mob-cast NPC_* skills, for the
 * incoming-damage (survivability) pipeline.
 *
 * The outgoing player ratio maps (BF_WEAPON_RATIOS / BF_MAGIC_RATIOS) already
 * cover the *player* skills a monster can cast (Fire Bolt, Bash, Meteor, …), and
 * those numbers are accurate. This module fills the gap for the monster-native
 * NPC_* skills, whose damage is hardcoded in Hercules `battle.c` rather than in
 * the skill_db. **These are estimates**: they use the Hercules pre-renewal
 * baseline formula, which PS may tune beyond — so results are flagged
 * `estimated: true` and the UI labels them as approximate.
 *
 * skillratio in Hercules starts at a 100 base and the `case` blocks ADD to it;
 * the functions here return the *total* percentage (base included). A skill that
 * has no `case` in battle_calc_skill_ratio() falls through at the 100 base — i.e.
 * normal-attack-equivalent damage — so it maps to `() => 100` here.
 *
 * Sources are cited inline as `battle.c` line references from the pre-renewal
 * (stable) branch fetched during authoring; cross-checkable against
 * HerculesWS/Hercules src/map/battle.c battle_calc_skill_ratio()/battle_calc_misc_attack().
 *
 * AUDIT (2026-08-08): re-verified the scaling entries against Hercules `battle.c`.
 * All confirmed CORRECT for pre-renewal: NPC_BLOODDRAIN `+= 100*(lv-1)` (=100·lv),
 * NPC_ENERGYDRAIN `+= 100*lv` (=100+100·lv), NPC_DARKCROSS `+= 35*lv` (=100+35·lv;
 * the ×2 for a 2H-spear is RENEWAL- and player-only, so a mob caster never gets it).
 * The remaining entries have no `case` → 100% (normal-attack-equivalent). Since PS
 * is PRE-RENEWAL and these are stock monster skills (no PS rework / no wiki entry),
 * the pre-re formula IS the correct value — but PS COULD still have tuned an
 * individual one, and they can't be measured in-game (mob-cast), so they stay
 * `estimated: true` ("for testing") rather than being asserted as PS-exact.
 */

// name -> (skill_lv) => total skillratio %.  All physical unless noted; the
// caller picks the ATK-vs-MATK path from the skill_db attack_type, so a magic
// NPC_ skill here just supplies the % applied to the mob's MATK instead.
const MOB_SKILL_RATIOS = {
  // skillratio += 100 * (skill_lv - 1)  =>  100 * lv   (battle.c: NPC_BLOODDRAIN
  // group, incl. NPC_HELLJUDGEMENT / NPC_PULSESTRIKE).
  NPC_BLOODDRAIN:    (lv) => 100 * lv,
  NPC_HELLJUDGEMENT: (lv) => 100 * lv,
  NPC_PULSESTRIKE:   (lv) => 100 * lv,

  // skillratio += 35 * skill_lv  =>  100 + 35*lv   (battle.c: NPC_DARKCROSS /
  // CR_HOLYCROSS shared case). Physical, Dark property.
  NPC_DARKCROSS: (lv) => 100 + 35 * lv,

  // skillratio += 100 * skill_lv  =>  100 + 100*lv   (battle.c: NPC_ENERGYDRAIN,
  // shared with NJ_KAMAITACHI in the magic section). Magic; also drains SP.
  NPC_ENERGYDRAIN: (lv) => 100 + 100 * lv,

  // No `case` in battle_calc_skill_ratio() -> falls through at the 100 base, i.e.
  // normal-attack-equivalent damage (some are multi-hit; hit count comes from the
  // skill_db `number_of_hits`, applied separately by the caller).
  NPC_COMBOATTACK:   () => 100,
  NPC_GUIDEDATTACK:  () => 100,
  NPC_PIERCINGATT:   () => 100,
  NPC_SPLASHATTACK:  () => 100,
  NPC_RANGEATTACK:   () => 100,
  NPC_ARMORBRAKE:    () => 100, // deals normal damage + may break armor
  NPC_SHIELDBRAKE:   () => 100, // deals normal damage + may break shield
  NPC_HELMBRAKE:     () => 100, // deals normal damage + may break helm
  NPC_CRITICALSLASH: () => 100, // flag.cri=1 (always crit) — crit bonus not modeled; ~100% baseline
  NPC_DARKSTRIKE:    () => 100, // magic, Dark
  NPC_MAGICALATTACK: () => 100, // magic
  NPC_DARKTHUNDER:   () => 100, // magic, Wind

  // Clashing Spiral (the mob clone of Spiral Pierce, e.g. Drill's). Total damage is
  // ATK × size-modifier × skill level — reported by a PS player and matching
  // kokotewa.com/db/skl_info?id=ML_SPIRALPIERCE ("DMG atk 1.00 ~ 5.00" over 5 levels,
  // "DMG hits 5"). Two things make that a plain per-level ratio here:
  //   - The caller prices ONE hit and multiplies by the skill_db hit count (5), so
  //     the value below is PER HIT: 20×lv × 5 hits = ATK × lv total.
  //   - The size modifier is inverse-by-target-size (Small 125 / Medium 100 /
  //     Large 75%), and the target of an incoming skill is always the player, who is
  //     Medium — so it is a no-op in this direction and is left out rather than
  //     hardcoded as ×100%.
  // Deliberately NOT aliased onto LK_SPIRALPIERCE: the player-cast version is a
  // weapon-WEIGHT formula (see ROADMAP), which is a different shape and still
  // unported. Keying the mob clone separately keeps that port honest.
  ML_SPIRALPIERCE: (lv) => 20 * lv,
  // Eight mobs cast the PLAYER-id Spiral Pierce (397) rather than the clone (8218).
  // A monster has no weapon to weigh, so the weapon-weight formula that makes the
  // player's version unported simply doesn't apply to it — cast by a mob it is the
  // same ATK × level hit as the clone above. Only ever read in the incoming
  // direction (this map is never consulted for the player's own attacks), so this
  // does NOT quietly "port" LK_SPIRALPIERCE for outgoing damage.
  LK_SPIRALPIERCE: (lv) => 20 * lv,
};

// Skills whose damage comes from the TARGET's stats rather than the caster's
// ATK/MATK, so no ratio can express them. The caller reads the player's own
// status to price these; each entry says which quantity and how much of it.
// Sourced from kokotewa.com/db/skl_info, the database Payon Stories players use
// for mob-skill numbers (it is where the Clashing Spiral figures came from).
const MOB_SKILL_TARGET_STAT_DAMAGE = {
  // "Hex an enemy to reduce their HP by a percentage of their current HP by
  // chance" — 10/12/16/25/50% by level, landing 50% of the time. This is why it
  // never fit a ratio and sat unpriced while 19 monsters cast it, Baphomet at Lv5
  // among them. Ignores DEF, MDEF and elemental resists: it is a fraction of your
  // HP, not an attack. The calculator assumes you are at full HP.
  NPC_DARKBREATH: {
    quantity: "hp",
    pctByLevel: [10, 12, 16, 25, 50],
    chancePct: 50,
    note: "% of your current HP — DEF, MDEF and resists don't apply",
  },
  // Soul Burn removes all of the target's SP; at Lv5 ONLY it also deals magic
  // damage equal to twice the SP removed, ignoring MDEF. Below Lv5 it is an
  // SP drain with no HP damage at all.
  PF_SOULBURN: {
    quantity: "sp",
    multiplierByLevel: [0, 0, 0, 0, 2],
    note: "twice the SP it burns (Lv5 only) — ignores MDEF",
  },
};

// Monster-clone skill names (the MS_/ML_/MA_ prefixes carried by mob copies of
// player jobs — e.g. an Eddga's MS_BASH) alias 1:1 onto the canonical player
// skill in Hercules `battle.c` (each shares that skill's `case` in
// battle_calc_skill_ratio()). Resolving the alias lets the incoming pipeline
// price them through the ACCURATE outgoing player ratio maps instead of the
// NPC_* Hercules-baseline estimates, so they report estimated:false.
//   MS_BASH          -> SM_BASH          (Bash; PS-vanilla-OK)
//   ML_PIERCE        -> KN_PIERCE        (Pierce; PS-vanilla-OK, hits by size —
//                                          resolved to 2 vs the Medium player by
//                                          profile.weapon_hit_counts)
//   MA_SHARPSHOOTING -> SN_SHARPSHOOTING (Sharp Shooting)
// ML_SPIRALPIERCE is deliberately NOT aliased: the player's Spiral Pierce is a
// weapon-weight formula that is still unported, while the mob clone is a plain
// per-level ATK ratio — so it carries its own MOB_SKILL_RATIOS entry instead.
// (ML_AUTOGUARD is a Self-target buff and MA_SANDMAN a Misc sleep trap — both
// already classify as non-damage, so they are intentionally NOT aliased here.)
const MOB_SKILL_ALIASES = {
  MS_BASH: "SM_BASH",
  ML_PIERCE: "KN_PIERCE",
  MA_SHARPSHOOTING: "SN_SHARPSHOOTING",
};

// Mob skills flagged as damage-dealing in the skill_db (Magic/Weapon, targets a
// foe) that actually inflict a STATUS / drain and deal no HP damage. Surfaced as
// "no direct damage" rather than a fabricated number.
const NO_HP_DAMAGE_SKILLS = new Set([
  // NPC_ status skills
  "NPC_MENTALBREAKER",  // reduces target SP
  "NPC_CHANGEUNDEAD",   // changes target property to Undead
  "NPC_DARKBLESSING",   // chance of instant death / heavy debuff, not a modellable hit
  "NPC_HALLUCINATION",  // inflicts Hallucination
  "NPC_LICK",           // stun (+ negligible)
  // player skills a mob can cast that are status-only (no HP damage)
  "MG_STONECURSE",      // petrify
  "AL_DECAGI",          // Decrease AGI
  "WZ_QUAGMIRE",        // slow
  "SA_DISPELL",         // strips buffs
  "PR_LEXDIVINA",       // silence
  "PR_LEXAETERNA",      // vulnerability debuff (no damage itself)
  "SL_STUN",            // stun
  // Sanctuary is a HEAL. It only damages Undead-ELEMENT or Undead-race targets, and
  // the player is neither — the sole exception being Evil Druid armour, which makes
  // you Undead element and would indeed take the hit. Five mobs cast it, and calling
  // it "a damage skill we can't price" implied it might hurt an ordinary build; this
  // says plainly that it doesn't. (If Evil Druid builds ever need it, that is a
  // separate branch keyed on the player's armour element, not a ratio.)
  "PR_SANCTUARY",
  // Maelstrom deals NO damage — it converts an area of cells into dead cells (which
  // swallow ground-targeted skill units). skills.json already flags it NoDamage, but
  // mob_skill_db.json is generated with `dmg = (Magic|Weapon && targets a foe)` and
  // Maelstrom is attack_type Magic aimed at "around1", so the generator marked it
  // dmg:true and it was filed under "hurts, can't price it" — which told a Lady Huo
  // (its only caster, Lv3) reader to expect a hit that never lands. Classifying it
  // here says plainly that it does nothing to your HP.
  "SC_MAELSTROM",
]);

// Damage skills whose power is a flat/special formula that does NOT fit the
// ratio × mob-ATK/MATK shape. We know they hurt but won't print a specific
// number — shown as element/type only — because the formula is either not
// publicly documented or is PS-tuned beyond the emulator baseline (a computed
// figure would be a fabricated number, which this calc deliberately avoids).
const FLAT_UNMODELED_SKILLS = new Set([
  // Asura Strike. Its damage is driven by the CASTER's SP, and a monster's SP pool
  // isn't in mob_db (the field exists but is 0 for every mob that casts it), so
  // there is no honest number to print — unlike Dark Breath, whose formula reads
  // the target's stats instead and is now priced.
  "MO_EXTREMITYFIST",
  // Monster-only 3rd-job (renewal) skills. Their formulas live behind `#ifdef
  // RENEWAL` in battle.c and PS is pre-renewal, so whatever these do on PS is
  // custom and undocumented — kokotewa has no formula for them either (it returns
  // "Unknown skill" for SC_MAELSTROM). Element and type only, deliberately.
  // NB three have come OFF this list as their PS values were supplied, and now live
  // in the profile ratio maps so they price as PS-exact rather than `estimated`:
  // GC_DARKCROW (Dark Claw, 100×SkillLv per hit × 3 hits) in PS_BF_WEAPON_RATIOS,
  // and AB_ADORAMUS (1400% MATK) + WL_DRAINLIFE (750% MATK) in PS_BF_MAGIC_RATIOS.
  // The rest stay unpriced until someone supplies their PS numbers the same way.
  "WL_CRIMSONROCK", "RK_SONICWAVE",
  "SO_CLOUD_KILL", "LG_RAYOFGENESIS",
  // Splash for the caster's current HP. In the data these are target:self /
  // dmg:false, so they never reach the damage path here anyway (kept for
  // completeness — the incoming pipeline has no flat/self-HP branch).
  "NPC_SELFDESTRUCTION",
  "NPC_SMOKING",          // md.damage = 3 (negligible; also self-targeted)
]);


// ---------------------------------------------------------------------------
// resolveMobSkillDamage — moved here from routes/calculate.ts (2026-09-08) so
// it is unit-testable from the plain-node test suite (the routes are TS).
// Lazy requires below dodge the require cycle with battlePipeline/skillRatio.
// ---------------------------------------------------------------------------
const { loader } = require("./dataLoader");

const ELE_NAME_TO_INT = {
  Ele_Neutral: 0, Ele_Water: 1, Ele_Earth: 2, Ele_Fire: 3, Ele_Wind: 4,
  Ele_Poison: 5, Ele_Holy: 6, Ele_Dark: 7, Ele_Ghost: 8, Ele_Undead: 9,
};
function resolveMobSkillDamage(skillId, level, profile, mob) {
  const sk = loader.getSkill(skillId);
  if (!sk) return null;
  // Do NOT clamp to the player max_level: monsters routinely cast above it —
  // Mistress's Jupitel Thunder is Lv28 in mob_skill_db, and clamping to 10 priced
  // her 30-hit cast as a 12-hit one (reported by a player). Hercules reads
  // per-level db arrays past their last row via skill_split_atoi semantics: a
  // higher level continues the arithmetic progression of the last two rows
  // (numbers) or repeats the last row (strings) — JT's hits 3,4,…,12 extend to
  // 13,14,… so Lv28 is 2+28 = 30 hits. `atLv` below reproduces exactly that.
  const lv = Math.max(1, level || 1);
  const atLv = (arr) => {
    if (!Array.isArray(arr)) return arr;
    if (arr.length === 0) return undefined;
    if (lv <= arr.length) return arr[lv - 1];
    const last = arr[arr.length - 1];
    if (typeof last !== "number" || arr.length < 2 || typeof arr[arr.length - 2] !== "number") return last;
    return last + (last - arr[arr.length - 2]) * (lv - arr.length);
  };
  const attackType = sk.attack_type; // "Magic" | "Weapon" | "Misc"
  const eleName = Array.isArray(sk.element) ? atLv(sk.element) : sk.element;
  const elementInt = ELE_NAME_TO_INT[eleName] ?? 0;
  const targetsFoe = Array.isArray(sk.skill_type)
    ? sk.skill_type.some((t) => t === "Enemy" || t === "Place")
    : true;
  const name = sk.name;

  // Monster-clone skills (MS_/ML_/MA_) alias onto the canonical player skill for
  // ratio/hit lookup; the display name / element / target keep the mob-skill entry.
  const ratioName = MOB_SKILL_ALIASES[name] || name;

  // The ratio/hit-count fns were written for the outgoing direction (their `tgt`
  // is the skill's target). Here the mob's target is the player: Medium size,
  // Neutral, DemiHuman PC — so size/element/race-dependent fns (Pierce's div_,
  // Magnus's race check) resolve against the player. ctx carries the CASTER
  // (mob) stats a few ratio fns read (base_level/str/dex for the ATK/base-level
  // scalers); `skill_levels` is empty because a mob caster's own skill ranks
  // (e.g. Fire Pillar reading Fire Wall) are unknown, so those secondary bonuses
  // default to 0.
  const playerTgt = { size: "Medium", element: 0, race: "DemiHuman", is_pc: true };
  const mobStats = (mob && mob.stats) || {};
  const ctx = {
    skill_levels: {}, skill_params: {},
    base_level: mob ? mob.level || 0 : 0,
    base_str: mobStats.str || 0,
    dex: mobStats.dex || 0,
  };

  // A number is only meaningful for a foe-targeting physical/magic skill.
  const isAttack = targetsFoe && (attackType === "Magic" || attackType === "Weapon");
  let ratio = 100, hasNumber = false, estimated = false;
  let damageType = isAttack ? "damage" : "status";

  if (NO_HP_DAMAGE_SKILLS.has(name)) {
    damageType = "status";
  } else if (isAttack) {
    const isMagic = attackType === "Magic";
    const psMap = (isMagic ? profile?.magic_ratios : profile?.weapon_ratios) || {};
    const { BF_MAGIC_RATIOS } = require("./calculators/battlePipeline");
      const { BF_WEAPON_RATIOS } = require("./calculators/modifiers/skillRatio");
      const bfMap = isMagic ? BF_MAGIC_RATIOS : BF_WEAPON_RATIOS;
    const vanillaOk = (isMagic ? profile?.magic_vanilla_ok : profile?.weapon_vanilla_ok) || new Set();
    try {
      if (typeof psMap[ratioName] === "function") {
        ratio = psMap[ratioName](lv, playerTgt, ctx); hasNumber = true; estimated = false;
      } else if (typeof bfMap[ratioName] === "function") {
        ratio = bfMap[ratioName](lv, playerTgt, ctx); hasNumber = true;
        // Vanilla ratio is only trustworthy where PS is confirmed to match it.
        estimated = !vanillaOk.has(ratioName);
      } else if (typeof MOB_SKILL_RATIOS[ratioName] === "function") {
        ratio = MOB_SKILL_RATIOS[ratioName](lv); hasNumber = true; estimated = true;
      } else if (FLAT_UNMODELED_SKILLS.has(name)) {
        damageType = "damage"; // it hurts, we just can't price it as a ratio
      }
    } catch { hasNumber = false; }
    // A ratio fn reading a ctx field we don't supply could yield NaN/Infinity —
    // never surface that as a number; fall back to element/type only.
    if (hasNumber && !Number.isFinite(ratio)) { hasNumber = false; ratio = 100; }
  }

  // Hit count mirrors the outgoing pipeline: a PS profile hit-count fn overrides
  // the skills.json number_of_hits (which is sometimes wrong for PS multi-hit
  // reworks and, importantly, encodes size-based counts like Pierce). A NEGATIVE
  // number_of_hits is a cosmetic multi-hit (damage applied once) -> 1, NOT its
  // absolute value — the PS "total ratio" skills (Vermilion −10, Fire Pillar −N)
  // already fold every wave into the ratio, so multiplying would double-count.
  let hits = 1;
  const psHitMap = (attackType === "Magic" ? profile?.magic_hit_counts : profile?.weapon_hit_counts) || {};
  if (typeof psHitMap[ratioName] === "function") {
    const h = psHitMap[ratioName](lv, playerTgt, ctx);
    hits = h && typeof h === "object" ? Number(h.max) || 1 : Number(h) || 1;
  } else {
    const hitsRaw = Array.isArray(sk.number_of_hits) ? atLv(sk.number_of_hits) : sk.number_of_hits;
    const n = Number(hitsRaw) || 1;
    hits = n > 0 ? n : 1; // negative = cosmetic multi-hit -> single damage instance
  }
  hits = Math.max(1, hits);

  // Skills the skill DB flags as ignoring DEF (Asura, Earthquake, Clashing Spiral,
  // Auto Counter…). The outgoing direction already honours this flag; the incoming
  // one has to as well, or the casts that hurt most get priced as if armour applied.
  const ignoreDef = Array.isArray(sk.damage_type) && sk.damage_type.includes("IgnoreDefense");

  // Damage read off the PLAYER's stats rather than the caster's ATK (Dark Breath's
  // % of current HP, Soul Burn's twice-the-SP-burned). No ratio can express these,
  // so they carry their own spec and the caller prices them from `status`.
  const targetStat = MOB_SKILL_TARGET_STAT_DAMAGE[name];
  let targetStatSpec = null;
  if (targetStat && isAttack) {
    const pct = targetStat.pctByLevel ? atLv(targetStat.pctByLevel) : null;
    const mult = targetStat.multiplierByLevel ? atLv(targetStat.multiplierByLevel) : null;
    // A level that deals no HP damage at all (Soul Burn below Lv5) is a drain, not
    // a hit — say so rather than printing a 0.
    if ((pct != null && pct > 0) || (mult != null && mult > 0)) {
      targetStatSpec = { quantity: targetStat.quantity, pct, mult, chancePct: targetStat.chancePct ?? null, note: targetStat.note };
      // Sourced from kokotewa, not from PS itself — same standing as the pre-renewal
      // baseline ratios, so it carries the same "for testing" tag rather than being
      // presented as a PS-exact figure.
      estimated = true;
    } else {
      damageType = "status";
    }
  }

  return {
    name, desc: sk.description || name, attackType, elementInt, hits, ratio,
    hasNumber: hasNumber || targetStatSpec != null, estimated, damageType, level: lv,
    ignoreDef: ignoreDef || targetStatSpec != null, targetStat: targetStatSpec,
  };
}

module.exports = {
  resolveMobSkillDamage,
  MOB_SKILL_RATIOS, NO_HP_DAMAGE_SKILLS, FLAT_UNMODELED_SKILLS, MOB_SKILL_ALIASES,
  MOB_SKILL_TARGET_STAT_DAMAGE,
};
