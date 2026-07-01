/**
 * serverProfiles.js — JS port of core/server_profiles.py
 *
 * ServerProfile holds all server-specific deviations from vanilla Hercules,
 * as override dicts keyed by skill/SC name. An empty dict means vanilla
 * behaviour applies for all keys not present — every modifier in this engine
 * checks `profile.someDict[key]` first and falls back to a vanilla constant,
 * so an incomplete profile degrades gracefully rather than crashing.
 *
 * NOT FULLY PORTED: the original PAYON_STORIES profile populates several
 * hundred lines of per-skill weapon_ratios / magic_ratios / mastery overrides
 * that were not all transcribed here (the upstream file is ~1000 lines of
 * dense, skill-specific tuning). What IS ported below: the full ServerProfile
 * shape, the complete STANDARD (vanilla) profile, and the PS deviations that
 * were directly verified from source during this port (passive resists,
 * per-job stat bonuses, ASPD quicken overrides, proc rate overrides, the
 * SC_STEELBODY DEF/MDEF formula, and the Super Novice HP/SP bonus tables).
 * Skills without an explicit PS override fall back to vanilla ratios in
 * skillRatio.js, which is the same fallback behaviour the original code uses
 * for unaudited skills (it just also emits a warning step in that case).
 */

function emptyProfile(name, overrides = {}) {
  return {
    name,
    use_ps_data: false,
    use_ps_skill_names: false,
    weapon_ratios: {},
    weapon_hit_counts: {},
    rate_bonuses: {},
    magic_ratios: {},
    magic_hit_counts: {},
    magic_wave_ratios: {},
    misc_formulas: {},
    skill_elements: {},
    mastery_per_level: {},
    mastery_ctx_overrides: {},
    gc_mastery_overrides: {},
    mechanic_flags: new Set(),
    passive_overrides: {},
    aspd_buffs: {},
    proc_rate_overrides: {},
    steelbody_override: null,
    sn_hp_bonus: {},
    sn_sp_bonus: {},
    weapon_vanilla_ok: new Set(),
    magic_vanilla_ok: new Set(),
    tick_hp_stand: 6, tick_hp_sit: 4, tick_sp_stand: 8, tick_sp_sit: 6, tick_skill: 5,
    skill_min_period_ms: {},
    ps_skill_delay_fn: {},
    ps_acd_zero: new Set(),
    ps_zero_cast: new Set(),
    ps_attack_interval: {},
    skill_level_cap_overrides: {},
    passive_resists: {},
    ps_job_bonuses: {},
    ps_mastery_weapon_map: {},
    param_skill_flat_adds: {},
    weapon_avg_hits_by_zone: {},
    pet_bonuses: {},
    ...overrides,
  };
}

const STANDARD = emptyProfile("standard", { use_ps_data: false });

// ---------------------------------------------------------------------
// Payon Stories verified deviations
// ---------------------------------------------------------------------
const PS_PASSIVE_RESISTS = {
  GS_FULLBUSTER: { sub_ele_at_max_lv: { Ele_Neutral: 7 }, weapon_types: ["Shotgun"], max_level: 10 },
  GS_SPREADATTACK: { sub_ele_at_max_lv: { Ele_Neutral: 7 }, weapon_types: ["Shotgun"], max_level: 10 },
};

// wiki.payonstories.com/Advanced_Book: PS retunes this to max level 5 (vanilla
// is 10) with its own non-linear per-level table, not vanilla's flat
// level*3 ATK / level*5% ASPD. The PS max_level itself is enforced in
// dataLoader.js#getPassiveSkillsForJob via ps_skill_db.json; this table is
// what masteryFix.js / statusCalculator.js actually read per level.
// PS class rebalance overrides (wiki.payonstories.com/Class_Rebalance).
// atk_per_lv: total ATK bonus at each skill level (1-indexed, read by masteryFix.js).
// cri_per_lv: CRI bonus per level on the ×10 internal scale (100 = 10% displayed).
// ASPD bonuses for these skills live in PS_ASPD_BUFFS below.
const PS_PASSIVE_OVERRIDES = {
  SA_ADVANCEDBOOK:   { atk_per_lv: [10, 15, 20, 25, 30], aspd_pct_per_lv: [3, 4, 5, 6, 7] }, // max 5 levels on PS
  DC_DANCINGLESSON:  { atk_per_lv: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], cri_at_max_lv: 100 }, // +5 ATK/lv, +10% CRIT at lv10
  BA_MUSICALLESSON:  { atk_per_lv: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] },                  // +5 ATK/lv
  MO_IRONHAND:       { atk_per_lv: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50], flee_per_lv: 2 }, // PS rework: Martial Arts — +5 ATK/lv, +2 FLEE/lv, also covers Mace
  PR_MACEMASTERY:    { atk_per_lv: [4,  8, 12, 16, 20, 24, 28, 32, 36, 40] },                  // +4 ATK/lv
  AM_AXEMASTERY:     { atk_per_lv: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] },                  // +5 ATK/lv
  AS_KATAR:          { atk_per_lv: [4,  8, 12, 16, 20, 24, 28, 32, 36, 40], cri_per_lv: 5 },  // +4 ATK/lv, +0.5% CRIT/lv
  // PS dual-wield mastery factors (wiki.payonstories.com/Class_Rebalance#Assassin).
  // rh_factors[lv-1] is the per-hit multiplier applied to each of the 2 RH hits.
  // lh_factors[lv-1] is the multiplier applied to the 1 LH hit.
  // Without the skill (lv 0) the vanilla base penalty (50%/30%) applies.
  AS_RIGHT: { rh_factors: [0.80, 0.90, 1.00, 1.10, 1.20] },  // lv 1–5: 80/90/100/110/120%
  AS_LEFT:  { lh_factors: [0.60, 0.70, 0.80, 0.90, 1.00] },  // lv 1–5: 60/70/80/90/100%
  SC_SPEARQUICKEN:   { hit_per_lv: 1, flee_per_lv: 1 },                                        // PS rework: no CRI, +1 HIT/lv, +1 FLEE/lv
  SC_EXPLOSIONSPIRITS: { cri_base: 175, cri_per_lv: 25 },                                      // PS rework: 20%/22.5%/25%/27.5%/30% (was 10%…20%)
};

const PS_JOB_BONUSES = {
  24: [ // Gunslinger
    [1, "dex"], [2, "luk"], [3, "agi"], [4, "luk"],
    [6, "dex"], [7, "dex"], [11, "dex"], [12, "luk"],
    [13, "agi"], [17, "dex"], [21, "luk"], [25, "dex"],
    [30, "dex"], [31, "luk"], [32, "str_"], [36, "agi"],
    [36, "dex"], [41, "str_"], [45, "dex"], [47, "dex"],
    [50, "str_"], [51, "luk"], [52, "int_"], [55, "dex"],
    [59, "agi"], [60, "vit"], [61, "int_"], [62, "dex"],
    [63, "luk"], [64, "str_"], [66, "agi"], [70, "dex"],
  ],
};

const PS_ASPD_BUFFS = {
  SC_TWOHANDQUICKEN: { quicken: { "2HSword": () => 300, "1HSword": () => 100 } },
  SC_SPEARQUICKEN: { quicken: { "2HSpear": (lv) => 200 + 15 * lv, "1HSpear": (lv) => 75 + 5 * lv } },
  BA_MUSICALLESSON: { lv10_rate: { MusicalInstrument: -100 } },
  AM_AXEMASTERY: { lv10_rate: { Axe: -80, "2HAxe": -80 } },
  PR_MACEMASTERY: { lv10_rate: { Mace: -120, Book: -120 } },
  SC_GS_GATLINGFEVER: { sc_quicken: { flee_suppress: true } },
  SC_GS_MADNESSCANCEL: { sc_quicken: { quicken_floor: 20 } },
};

const PS_PROC_RATE_OVERRIDES = {
  TF_DOUBLE: 7.0,
  GS_CHAINACTION: 7.0,
  AC_VULTURE: 7.0,
  SM_SWORD: 7.0,
  // PS rework: 5 levels, rates decrease with level (28/26/24/22/20%).
  // Index 0 unused; index [lv] = base proc chance at that level.
  MO_TRIPLEATTACK: [0, 28, 26, 24, 22, 20],
};

const PS_STEELBODY_OVERRIDE = [
  (d) => Math.min(90, d * 2), // DEF
  (d) => Math.min(90, d * 4), // MDEF
];

const PS_SN_HP_BONUS = { 40: 100, 50: 150, 60: 200, 70: 250, 80: 300, 90: 400, 99: 1000 };
const PS_SN_SP_BONUS = { 20: 10, 30: 10, 40: 10, 50: 10, 60: 10, 70: 10, 80: 10, 90: 10, 99: 30 };

// Rate bonuses replacing vanilla flat-BATK SCs with a % damage bonus on PS.
const PS_RATE_BONUSES = {
  SC_GS_GATLINGFEVER: 40,
  SC_GS_MADNESSCANCEL: 30,
};

// Mechanic flag sentinels — checked by individual modifiers across the engine.
// Source: core/server_profiles.py's _PS_MECHANIC_FLAGS (StatGameDev/Open_PS_Calc,
// MIT licensed — the reference implementation this whole port tracks against).
// Only flags with an existing consumer in this JS port are enabled below; the
// remaining upstream flags have no ported consumer yet (see ROADMAP.md).
const PS_MECHANIC_FLAGS = new Set([
  "PS_CRIT_SHIELD_DISABLED",
  "AS_KATAR_KATAR_CRIT_DMG_BONUS",
  "GROUND_EFFECT_PS_VALUES",
  "GS_GS_ADJUSTMENT_SKIP_HIT_PENALTY",
  "PR_MACEMASTERY_EXPANDED_WEAPON_TYPES",
  "MO_EXTREMITYFIST_PS_SP_REWORK",  // PS rework: SP consumed = floor(MaxSP × 0.2 × SkillLv)
  // wiki.payonstories.com/Grand_Cross: weapon masteries (and Demon Bane's flat
  // bonus) DO count toward Grand Cross's ATK component on PS, unlike vanilla
  // Hercules where CR_GRANDCROSS is in masteryFix.js's MASTERY_EXEMPT_SKILLS.
  "PS_GRANDCROSS_MASTERY_APPLIES",
  // Below: confirmed present in upstream _PS_MECHANIC_FLAGS, consumed by
  // existing code in this port (skillRatio.js's Overthrust check / the
  // generic `${skillName}_NK_IGNORE_FLEE` lookup in battlePipeline.js).
  "BS_OVERTHRUST_PARTY_FULL_BONUS",
  "CR_SHIELDBOOMERANG_NK_IGNORE_FLEE",
  "CR_SHIELDCHARGE_NK_IGNORE_FLEE",
  "RG_BACKSTAP_NK_IGNORE_FLEE",
  // PS Assassin rework (Assassin_Rework_PayonStories.pdf)
  "AS_KATAR_SECOND_HIT",           // Katar second hit: (21+4×AS_KATAR_lv)% of main, doubled proc rate
  "TF_POISON_USES_WEAPON_ELEMENT", // Envenom element = weapon element instead of Poison
  "AS_ENCHANTPOISON_PASSIVE_BONUS",// AS_ENCHANTPOISON: passive +2%/lv damage vs Poison element monsters
  // PS Hunter rework (Hunter_Rework_PayonStories.pdf)
  "HT_TRAP_PS_FORMULA",            // Trap damage: lv × factorA × factorB / divisor (INT/DEX scaling, bypasses DEF)
  // PS Monk rework (PSRO_Monk_Rework_2026.pdf)
  "MO_TRIPLEATTACK_PS_BONUS",      // Triple Attack can crit when SC_EXPLOSIONSPIRITS (Fury/Critical Explosion) is active
  // PS Assassin dual-wield (wiki.payonstories.com/Class_Rebalance#Assassin)
  // Three-hit model per auto-attack: hit1=RH×rhFactor, hit2=hit1 (same roll), hit3=LH×lhFactor.
  // Remove this flag to revert to single-weapon-only calculation.
  "DUAL_WIELD_PS_THREE_HIT",
  // +10% bonus applied to the combined three-hit total on PS (Class_Rebalance).
  "DUAL_WIELD_PS_DAMAGE_BONUS",
]);

// Helper arrays for NJ_KASUMIKIRI / NJ_KIRIKAGE (core/server_profiles.py).
const NJ_KASUMIKIRI_RATIOS = [100, 125, 150, 175, 200, 250, 275, 300, 325, 375];
const NJ_KIRIKAGE_HIDE_ON = [100, 200, 400, 600, 800];
const NJ_KIRIKAGE_HIDE_OFF = [100, 190, 280, 360, 450];

// core/server_profiles.py's _PS_BF_WEAPON_RATIOS — verified BF_WEAPON skill-ratio
// overrides for Payon Stories. PS_RG_TRICKARROW / PS_RG_QUICKSTEP / PS_PR_HOLYSTRIKE
// are PS-custom skills (ps_custom_constants.json IDs 2631/2633/2622) that this
// engine's dataLoader.getSkill() can't resolve yet (it only reads vanilla
// db/skills.json) — see ROADMAP.md. Data kept here so the ratios are ready once
// that lookup gap is fixed.
const PS_BF_WEAPON_RATIOS = {
  KN_BOWLINGBASH: () => 400,
  KN_BRANDISHSPEAR: (lv, tgt, ctx) => {
    const dist = ctx ? (ctx.skill_params.KN_BRANDISHSPEAR_dist ?? 4) : 4;
    const mult = { 1: 11 / 6, 2: 1.75, 3: 1.5, 4: 1.0 }[dist] ?? 1.0;
    return Math.trunc((100 + 20 * lv) * mult);
  },
  AS_SONICBLOW: (lv) => 500 + 40 * lv,
  KN_AUTOCOUNTER: () => 200,
  KN_SPEARSTAB: (lv) => 100 + 40 * lv,
  CR_HOLYCROSS: (lv) => 300 + 25 * lv,
  RG_RAID: (lv) => 100 + 100 * lv,
  AM_ACIDTERROR: (lv) => 100 + 80 * lv,
  RG_BACKSTAP: (lv) => 200 + 40 * lv,
  AS_SPLASHER: (lv, tgt, ctx) => {
    const poisonLv = ctx ? (ctx.skill_params.AS_SPLASHER_poison_react_lv ?? 0) : 0;
    return 500 + 50 * lv + 30 * poisonLv;
  },
  CR_SHIELDBOOMERANG: (lv) => 100 + 40 * lv,
  CR_SHIELDCHARGE: (lv) => 200 + 20 * lv,
  MC_CARTREVOLUTION: () => 250,
  MC_MAMMONITE: (lv, tgt, ctx) => {
    const zenyPincher = !!(ctx && ctx.skill_params.PS_BS_ZENYPINCHER_active);
    return Math.trunc((100 + 50 * lv) * (zenyPincher ? 0.4 : 1.0));
  },
  MO_TRIPLEATTACK: (lv) => 100 + 40 * lv,   // PS rework: 5 levels → 140/180/220/260/300%
  MO_CHAINCOMBO:   (lv) => 200 + 60 * lv,   // PS rework: 260/320/380/440/500%
  MO_COMBOFINISH:  (lv) => 255 + 90 * lv,   // PS rework: 345/435/525/615/705%
  PS_RG_TRICKARROW: () => 100,
  PS_RG_QUICKSTEP: () => 10,
  PS_PR_HOLYSTRIKE: (lv, tgt, ctx) => 101 + (ctx ? ctx.base_str : 0) + (ctx ? ctx.base_level : 0),
  AM_DEMONSTRATION: (lv) => 200 + 40 * lv,
  HT_FREEZINGTRAP: (lv) => 25 + 25 * lv,
  BA_MUSICALSTRIKE: (lv) => 175 + 25 * lv,
  DC_THROWARROW: (lv) => 175 + 25 * lv,
  GS_TRIPLEACTION: () => 140,
  GS_TRACKING: (lv) => 100 + 160 * lv,
  GS_DESPERADO: (lv) => 100 + 20 * lv,
  GS_DUST: (lv) => 100 + 30 * lv,
  GS_FULLBUSTER: (lv) => 350 + 75 * lv,
  GS_SPREADATTACK: (lv) => 200 + 20 * lv,
  GS_GROUNDDRIFT: (lv) => 200 + 60 * lv,
  GS_PIERCINGSHOT: (lv) => 100 + 20 * lv,
  GS_BULLSEYE: () => 100,
  GS_MAGICALBULLET: (lv, tgt, ctx) => 50 + (ctx ? ctx.dex : 0) + (ctx ? ctx.base_level : 0),
  NJ_KIRIKAGE: (lv, tgt, ctx) => {
    const hiding = !!(ctx && ctx.skill_params.NJ_KIRIKAGE_hiding);
    const rangePp = ctx ? (ctx.skill_params.NJ_KIRIKAGE_range_pp ?? 0) : 0;
    const base = hiding
      ? NJ_KIRIKAGE_HIDE_ON[lv - 1]
      : Math.max(0, NJ_KIRIKAGE_HIDE_OFF[lv - 1] - 10 * rangePp);
    const shadowsWithin = !!(ctx && ctx.skill_params.PS_NJ_SHADOWSWITHIN_active);
    return base + (shadowsWithin ? 25 + 5 * lv : 0);
  },
  NJ_KASUMIKIRI: (lv, tgt, ctx) => {
    const hiding = !!(ctx && ctx.skill_params.NJ_KASUMIKIRI_hiding);
    return Math.trunc(NJ_KASUMIKIRI_RATIOS[lv - 1] * (hiding ? 1.4 : 1.0));
  },
  NJ_HUUMA: (lv) => 200 + 150 * lv,
};

// core/server_profiles.py's _PS_WEAPON_VANILLA_OK — skills confirmed to match
// vanilla exactly on PS (suppresses skillRatio.js's "PS unaudited" warning).
const PS_WEAPON_VANILLA_OK = new Set([
  "SM_BASH", "SM_MAGNUM", "KN_SPEARSTAB", "KN_SPEARBOOMERANG", "KN_PIERCE",
  "KN_CHARGEATK", "TF_SPRINKLESAND", "AS_GRIMTOOTH", "AS_VENOMKNIFE",
  "RG_INTIMIDATE", "AC_SHOWER", "AC_CHARGEARROW", "HT_PHANTASMIC",
  "MO_BALKYOUNG", "MO_FINGEROFFENSIVE", "MO_INVESTIGATE", "TK_STORMKICK",
  "TK_DOWNKICK", "TK_TURNKICK", "TK_COUNTER", "TK_JUMPKICK", "NJ_KUNAI",
  "NJ_ISSEN", "NJ_SYURIKEN",
]);

// core/server_profiles.py's _PS_BF_MAGIC_RATIOS.
const PS_BF_MAGIC_RATIOS = {
  MG_FIREBALL: (lv) => 40 + 30 * lv,
  WZ_EARTHSPIKE: () => 140,
  WZ_HEAVENDRIVE: () => 140,
  NJ_HYOUSENSOU: () => 85,
  NJ_RAIGEKISAI: (lv) => 150 + 60 * lv,
  AL_HOLYLIGHT: (lv, tgt, ctx) => 101 + (ctx ? ctx.base_level : 125),
  // wiki.payonstories.com/Frost_Nova: MATK% scales with the caster's own
  // Frost Diver rank (+10% MATK per Frost Diver level), not a manual param --
  // read straight from mastery_levels (ctx.skill_levels) via the Frost
  // Diver passive-skill entry in dataLoader.js#getPassiveSkillsForJob.
  WZ_FROSTNOVA: (lv, tgt, ctx) => {
    const frostdiverLv = ctx ? (ctx.skill_levels.MG_FROSTDIVER ?? 0) : 0;
    return 50 * lv + 10 * frostdiverLv;
  },
  PR_MAGNUS: (lv, tgt) => (tgt && (tgt.element === 9 || tgt.race === "Demon")) ? 100 : 50,
  // wiki.payonstories.com/Fire_Pillar: each hit's MATK% scales with the
  // caster's own Fire Wall rank (+2% MATK per hit per Fire Wall level) --
  // same pattern as Frost Nova/Frost Diver above.
  WZ_FIREPILLAR: (lv, tgt, ctx) => {
    const firewallLv = ctx ? (ctx.skill_levels.MG_FIREWALL ?? 0) : 0;
    return (2 + 2 * lv) * (70 + 2 * firewallLv);
  },
  WZ_SIGHTRASHER: (lv) => 100 + 75 * lv,
};

// core/server_profiles.py's _PS_MAGIC_VANILLA_OK.
const PS_MAGIC_VANILLA_OK = new Set([
  "MG_NAPALMBEAT", "MG_SOULSTRIKE", "MG_FIREWALL", "MG_THUNDERSTORM",
  "MG_FROSTDIVER", "MG_COLDBOLT", "MG_FIREBOLT", "MG_LIGHTNINGBOLT",
  "WZ_SIGHTBLASTER", "WZ_WATERBALL", "WZ_STORMGUST", "WZ_JUPITEL",
  "WZ_METEOR", "HW_NAPALMVULCAN", "AL_RUWACH", "NJ_KOUENKA", "NJ_KAENSIN",
  "NJ_HYOUSYOURAKU", "NJ_KAMAITACHI", "NJ_HUUJIN",
]);

// wiki.payonstories.com/Cute_Pet_System — bonuses activate at Cordial (750+).
// Keys match build.selected_pet; fields match GearBonuses / applyPetBonuses.
// Bonuses that can't be modelled in the current engine (HP drain procs, specific
// monster-type bonuses) are omitted — the pet is still selectable so the
// supported portion applies.
const PS_PET_BONUSES = {
  // ── Standard pets ────────────────────────────────────────────────────────
  poring:          { luk: 2, cri: 1 },
  lunatic:         { cri: 2, batk: 2 },
  picky:           { str_: 1, batk: 5 },
  drops:           { hit: 3, batk: 3 },
  chonchon:        { agi: 1, flee: 2 },
  steel_chonchon:  { flee: 6, agi: -1 },
  spore:           { hit: 5, batk: -2 },
  poison_spore:    { str_: 1, int_: 1 },
  smokie:          { agi: 1, flee2: 1 },
  rocker:          { maxhp: 25 },                          // +HP; regen not modelled
  yoyo:            { cri: 3, luk: -1 },
  munak:           { int_: 1, def_: 1 },
  bongun:          { vit: 1 },                             // +stun resist not modelled
  poporing:        { luk: 2, sub_ele: { Ele_Poison: 10 } },
  peco_peco:       { maxhp: 150, maxsp: -10 },
  sohee:           { str_: 1, dex: 1 },
  isis:            { atk_rate: 1, matk_rate: -1 },
  orc_warrior:     { batk: 10, def_: -3 },
  savage_bebe:     { vit: 1, maxhp: 50 },
  deviruchi:       { atk_rate: 1, matk_rate: 1, maxhp_rate: -3, maxsp_rate: -3 },
  dokebi:          { matk_rate: 1, atk_rate: -1 },
  alice:           { mdef_: 1, sub_race: { RC_DemiHuman: 1, RC_Player: 1 } },
  green_maiden:    { def_: 1, sub_race: { RC_DemiHuman: 1, RC_Player: 1 } },
  baby_desert_wolf:{ int_: 1, maxsp: 20 },
  baphomet_jr:     { def_: 1, mdef_: 1 },                 // +stun resist not modelled
  imp:             { sub_ele: { Ele_Fire: 2 }, add_ele: { Ele_Fire: 1 } },
  hunter_fly:      { flee: -5, flee2: 2 },
  dullahan:        { crit_atk_rate: 4, luk: -1 },
  earth_petite:    { def_: -2, mdef_: -2, aspd_percent: 1 },
  santa_goblin:    { maxhp: 30, sub_ele: { Ele_Water: 1 } },
  succubus:        {},                                     // 2% HP drain proc not modelled
  goblin:          {},                                     // +2% to/from Goblins — monster-type, not modelled
  zealotus:        { atk_rate: 2, magic_add_race: { RC_DemiHuman: 2, RC_Player: 2 } },
  // ── Payon Stories custom pets ────────────────────────────────────────────
  puck:            { vit: 1 },                             // −1% magic dmg received not modelled
  kalec:           { matk_rate: 1, mdef_: 2 },
  yser:            { hit: 4, aspd_percent: 1 },
  gyokuto:         { maxsp: 20 },                          // +3% heal power not modelled
  onigiring:       { maxhp: 50 },                          // poison status resist not modelled
};

const PAYON_STORIES = emptyProfile("payon_stories", {
  use_ps_data: true,
  use_ps_skill_names: true,
  rate_bonuses: PS_RATE_BONUSES,
  mechanic_flags: PS_MECHANIC_FLAGS,
  aspd_buffs: PS_ASPD_BUFFS,
  proc_rate_overrides: PS_PROC_RATE_OVERRIDES,
  // KN_SPEARMASTERY: [without_peco, with_peco] ATK per level. Vanilla is [4, 5]; PS is [5, 7].
  mastery_per_level: { KN_SPEARMASTERY: [5, 7] },
  // PS Monk rework: Martial Arts (MO_IRONHAND) also covers Mace weapons.
  // If a character has Martial Arts but not Priest Mace Mastery, use MO_IRONHAND for Mace.
  mastery_prefer_fallback: { PR_MACEMASTERY: "MO_IRONHAND" },
  steelbody_override: PS_STEELBODY_OVERRIDE,
  sn_hp_bonus: PS_SN_HP_BONUS,
  sn_sp_bonus: PS_SN_SP_BONUS,
  passive_resists: PS_PASSIVE_RESISTS,
  passive_overrides: PS_PASSIVE_OVERRIDES,
  ps_job_bonuses: PS_JOB_BONUSES,
  weapon_ratios: PS_BF_WEAPON_RATIOS,
  weapon_vanilla_ok: PS_WEAPON_VANILLA_OK,
  magic_ratios: PS_BF_MAGIC_RATIOS,
  magic_vanilla_ok: PS_MAGIC_VANILLA_OK,
  pet_bonuses: PS_PET_BONUSES,
});

const PROFILES = {
  standard: STANDARD,
  payon_stories: PAYON_STORIES,
};

function getProfile(server) {
  return PROFILES[server] || STANDARD;
}

module.exports = { STANDARD, PAYON_STORIES, getProfile, emptyProfile };
