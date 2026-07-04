import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import LZString from "lz-string";
import { api } from "../api/client";
import SearchPicker from "../components/SearchPicker";
import Panel from "../components/Panel";
import InfoTooltip from "../components/InfoTooltip";
import ChangelogModal from "../components/ChangelogModal";
import ResultsPanel from "../components/ResultsPanel";
import SavedBuildsModal from "../components/SavedBuildsModal";
import {
  BuildData, SkillState, CustomTarget, TargetMode, TargetMods,
  UrlEditorState, SearchResult, PassiveSkill, EquippedItemInfo, ConsumableBuffs,
  WildcardSlot,
} from "../types";

// Element index → display name (Neutral=0 … Undead=9). Matches the engine's
// element convention and the custom-target element select below.
const ELEMENT_NAMES = ["Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Dark", "Ghost", "Undead"] as const;

const WILDCARD_BONUS_OPTIONS = [4, 10, 15, 20];
const WILDCARD_DEFAULT_BONUS: Record<WildcardSlot["type"], number> = {
  race: 20, size: 15, ele: 20,
};

const STATS = ["str", "agi", "vit", "int", "dex", "luk"] as const;
// statusCalculator.js / dataLoader.js's getJobBonusStats reads from the
// same keys it writes to status.{str_,agi,vit,int_,dex,luk} -- str/int get
// a trailing underscore there to dodge the JS reserved-ish "int" naming.
const STAT_TO_BONUS_KEY: Record<typeof STATS[number], string> = {
  str: "str_", agi: "agi", vit: "vit", int: "int_", dex: "dex", luk: "luk",
};
const BASE_LEVEL_CAP = 99;
const MAX_STAT = 99;

// Cumulative status points available at each base level (index = level - 1).
// Mirrors dataLoader.js statpoint_table.json (pre-re, levels 1–99).
// Trans 2nd jobs receive an additional +52 points.
const STAT_POINT_BY_LEVEL: readonly number[] = [48,51,54,57,60,64,68,72,76,80,85,90,95,100,105,111,117,123,129,135,142,149,156,163,170,178,186,194,202,210,219,228,237,246,255,265,275,285,295,305,316,327,338,349,360,372,384,396,408,420,433,446,459,472,485,499,513,527,541,555,570,585,600,615,630,646,662,678,694,710,727,744,761,778,795,813,831,849,867,885,904,923,942,961,980,1000,1020,1040,1060,1080,1101,1122,1143,1164,1185,1207,1229,1251,1273];

// STAT_COST_TABLE[v] = total stat points spent to bring a stat from 1 to v.
// PS formula: cost to increment v→v+1 is floor((v-1)/10) + 2 for all v≥1.
// (Verified against payonrocalc.jaludev.com — the official PS stat simulator.)
const STAT_COST_TABLE: readonly number[] = (() => {
  const t: number[] = [0, 0];
  for (let v = 2; v <= 99; v++) {
    t.push(t[v - 1] + (Math.floor((v - 2) / 10) + 2));
  }
  return t;
})();

// Pre-renewal job level caps, derived from job_db.json's job list (28 jobs,
// no baby classes in this dataset): Novice 10, 1st job 50, regular 2nd job
// 50, Super Novice 99, trans 2nd job 70. Gunslinger/Ninja are classic kRO's
// "extended" classes (job level 60 there), but wiki.payonstories.com/
// Gunslinger references planning around "JobLv70 gunslinger", so this PS
// instance appears to have retuned them to the trans cap instead.
const TRANS_JOB_IDS = new Set([4008, 4009, 4010, 4011, 4012, 4013, 4015, 4016, 4017, 4018, 4019, 4020, 4021]);
// Novice + 1st job (except Magician) + Super Novice: Concentration Potion only
const NOVICE_OR_1ST_JOB_IDS = new Set([0, 1, 2, 3, 4, 5, 6, 23]);
// These non-trans classes can use Berserk Potion; trans forms already covered by TRANS_JOB_IDS
const BERSERK_NON_TRANS_IDS = new Set([
  2, 9, 16,   // Mage tree: Magician, Wizard, Sage
  5, 10, 18,  // Merchant tree: Merchant, Blacksmith, Alchemist
  1, 7, 14,   // Swordsman tree: Swordman, Knight, Crusader
  6, 12, 17,  // Thief tree: Thief, Assassin, Rogue
]);
// PS rebalance: these classes are restricted to Concentration Potion
const CONC_ONLY_IDS = new Set([
  8, 4009,              // Acolyte tree: Priest, High Priest
  19, 20, 4020, 4021,  // Archer tree: Bard, Dancer, Clown, Gypsy
]);
function getTotalStatPoints(baseLevel: number, jobId: number): number {
  const idx = Math.min(Math.max(baseLevel, 1), STAT_POINT_BY_LEVEL.length) - 1;
  const base = STAT_POINT_BY_LEVEL[idx] ?? 48;
  return TRANS_JOB_IDS.has(jobId) ? base + 52 : base;
}
function maxAffordableStat(from: number, remaining: number): number {
  let v = from, pts = remaining;
  while (v < MAX_STAT) {
    const c = Math.floor((v - 1) / 10) + 2;
    if (c > pts) break;
    pts -= c;
    v++;
  }
  return v;
}

const JOB_LEVEL_CAP_OVERRIDES: Record<number, number> = { 0: 10, 23: 99, 24: 70, 25: 70 };
function getJobLevelCap(jobId: number): number {
  if (TRANS_JOB_IDS.has(jobId)) return 70;
  return JOB_LEVEL_CAP_OVERRIDES[jobId] ?? 50;
}
// Returns the highest ASPD potion index allowed for a job (1=Conc, 2=Awak, 3=Berserk).
// 0 (no job selected) → no restriction so the form isn't locked before a class is chosen.
function aspdPotionCap(jobId: number): number {
  if (!jobId) return 3;
  if (CONC_ONLY_IDS.has(jobId)) return 1;           // PS: Bard/Dancer/Clown/Gypsy — Conc only
  if (BERSERK_NON_TRANS_IDS.has(jobId)) return 3;   // Mage/Merchant/Swordsman/Thief trees
  if (NOVICE_OR_1ST_JOB_IDS.has(jobId)) return 1;
  if (TRANS_JOB_IDS.has(jobId)) return 3;
  return 2;
}

// Whether a slot can be refined depends on the specific equipped item, not
// the slot itself (e.g. most headgears ARE refineable, but not all; same
// for every other armor slot) -- see item.refineable, checked at render time.
const EQUIP_SLOTS = [
  { key: "right_hand", label: "Right hand (weapon)", itemType: "IT_WEAPON" },
  { key: "left_hand", label: "Left hand (shield / weapon)", itemType: "IT_ARMOR", loc: "EQP_SHIELD", dualWield: true },
  { key: "head_top", label: "Headgear (top)", itemType: "IT_ARMOR", loc: "EQP_HEAD_TOP" },
  { key: "head_mid", label: "Headgear (mid)", itemType: "IT_ARMOR", loc: "EQP_HEAD_MID" },
  { key: "head_low", label: "Headgear (low)", itemType: "IT_ARMOR", loc: "EQP_HEAD_LOW" },
  { key: "armor", label: "Armor", itemType: "IT_ARMOR", loc: "EQP_ARMOR" },
  { key: "garment", label: "Garment", itemType: "IT_ARMOR", loc: "EQP_GARMENT" },
  { key: "shoes", label: "Shoes", itemType: "IT_ARMOR", loc: "EQP_SHOES" },
  { key: "accessory_left", label: "Accessory (left)", itemType: "IT_ARMOR", loc: "EQP_ACC" },
  { key: "accessory_right", label: "Accessory (right)", itemType: "IT_ARMOR", loc: "EQP_ACC" },
  { key: "ammo", label: "Ammo", itemType: "IT_AMMO" },
] as const;

// Cards are filtered to the slot they're being compounded into.
// left_hand uses EQP_WEAPON when a weapon is equipped (dual-wield), EQP_SHIELD otherwise.
const SLOT_CARD_LOC: Record<string, string | undefined> = {
  right_hand:      "EQP_WEAPON",
  left_hand:       "EQP_SHIELD",
  head_top:        "EQP_HEAD_TOP",
  head_mid:        "EQP_HEAD_MID",
  head_low:        "EQP_HEAD_LOW",
  armor:           "EQP_ARMOR",
  garment:         "EQP_GARMENT",
  shoes:           "EQP_SHOES",
  accessory_left:  "EQP_ACC",
  accessory_right: "EQP_ACC",
};

const DEFAULT_BUILD: BuildData = {
  name: "New Build",
  job_name: '',
  job_id: 0,
  base_level: 1,
  job_level: 1,
  base_stats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
  bonus_stats: {},
  equipped: {},
  refine: {},
  target_mob_id: null,
  server: "payon_stories",
  consumable_buffs: {},
  active_buffs: {},
  song_state: {},
  wildcard_slots: {},
};

// Bonuses from wiki.payonstories.com/Cute_Pet_System. Only PS server has
// pet_bonuses populated; standard server sends selected_pet but profile
// pet_bonuses:{} makes applyPetBonuses a no-op.
const PS_PETS: { key: string; label: string; psCustom?: true }[] = [
  // ── Payon Stories custom pets ──────────────────────────────────────────
  { key: "gyokuto",    label: "Gyokuto — MaxSP +20, Heal +3%",        psCustom: true },
  { key: "kalec",      label: "Kalec — MATK +1%, MDEF +2",            psCustom: true },
  { key: "onigiring",  label: "Onigiring — MaxHP +50, Poison resist",  psCustom: true },
  { key: "puck",       label: "Puck — VIT +1, Magic Dmg Rcvd −1%",    psCustom: true },
  { key: "yser",       label: "Yser — HIT +4, ASPD +1%",              psCustom: true },
  // ── Standard pets (alphabetical) ────────────────────────────────────
  { key: "alice",           label: "Alice — MDEF +1, Demi-Human resist +1%" },
  { key: "baby_desert_wolf",label: "Baby Desert Wolf — INT +1, SP +20" },
  { key: "baphomet_jr",     label: "Baphomet Jr. — DEF +1, MDEF +1" },
  { key: "bongun",          label: "Bongun — VIT +1" },
  { key: "chonchon",        label: "Chonchon — AGI +1, FLEE +2" },
  { key: "deviruchi",       label: "Deviruchi — ATK/MATK +1%, HP/SP −3%" },
  { key: "dokebi",          label: "Dokebi — MATK +1%, ATK −1%" },
  { key: "drops",           label: "Drops — HIT +3, ATK +3" },
  { key: "dullahan",        label: "Dullahan — Crit Dmg +4%, LUK −1" },
  { key: "earth_petite",    label: "Earth Petite — DEF/MDEF −2, ASPD +1%" },
  { key: "green_maiden",    label: "Green Maiden — DEF +1, Demi-Human resist +1%" },
  { key: "hunter_fly",      label: "Hunter Fly — FLEE −5, Perfect Dodge +2" },
  { key: "imp",             label: "Imp — Fire resist +2%, Fire Dmg +1%" },
  { key: "isis",            label: "Isis — ATK +1%, MATK −1%" },
  { key: "lunatic",         label: "Lunatic — CRIT +2, ATK +2" },
  { key: "munak",           label: "Munak — INT +1, DEF +1" },
  { key: "orc_warrior",     label: "Orc Warrior — ATK +10, DEF −3" },
  { key: "peco_peco",       label: "Peco Peco — MaxHP +150, SP −10" },
  { key: "picky",           label: "Picky — STR +1, ATK +5" },
  { key: "poison_spore",    label: "Poison Spore — STR +1, INT +1" },
  { key: "poporing",        label: "Poporing — LUK +2, Poison resist +10%" },
  { key: "poring",          label: "Poring — LUK +2, CRIT +1" },
  { key: "rocker",          label: "Rocker — MaxHP +25, HP recovery +5%" },
  { key: "santa_goblin",    label: "Santa Goblin — MaxHP +30, Water resist +1%" },
  { key: "savage_bebe",     label: "Savage Bebe — VIT +1, MaxHP +50" },
  { key: "smokie",          label: "Smokie — AGI +1, Perfect Dodge +1" },
  { key: "sohee",           label: "Sohee — STR +1, DEX +1" },
  { key: "spore",           label: "Spore — HIT +5, ATK −2" },
  { key: "steel_chonchon",  label: "Steel Chonchon — FLEE +6, AGI −1" },
  { key: "succubus",        label: "Succubus — 2% HP drain on attack (proc not modelled)" },
  { key: "yoyo",            label: "Yoyo — CRIT +3, LUK −1" },
  { key: "zealotus",        label: "Zealotus — ATK +2%, MATK vs Demi-Human +2%" },
];

const ASPD_POTION_LABELS = [
  "None",
  "Concentration Potion (+10%)",
  "Awakening Potion (+15%)",
  "Berserk Potion (+20%)",
];

// Damage/ASPD-relevant active buffs the engine already reads from
// build.active_buffs / build.support_buffs / build.song_state, with no UI
// before now. `jobs` is the actual job_id list each skill belongs to
// (derived from skills.json's status_change field + skill_tree.json, not
// guessed) -- only used to filter SELF_BUFFS, since those only make sense
// if your own build can cast them on itself. Party buffs and songs come
// from OTHER players, so they're never filtered by your own job -- any
// class could be standing in a Priest/Blacksmith/Bard's range.
const SELF_BUFFS = [
  // Archer / Hunter / Sniper / Bard / Dancer / Clown / Gypsy
  { key: "SC_CONCENTRATION",    label: "Attention Concentrate", max: 10, jobs: [3, 11, 19, 20, 4012, 4020, 4021] },
  // Swordman line — Auto Berserk (SM_AUTOBERSERK): while HP < 25% you gain a
  // self Provoke Lv10 (+32% base ATK, −55% self-DEF). Presence-only. Jobs
  // derived from skill_tree.json: Swordman / Knight / Crusader / LK / Paladin.
  { key: "SC_AUTOBERSERK",     label: "Auto Berserk (self Provoke 10)", max: 1, jobs: [1, 7, 14, 4008, 4015] },
  // Knight / Lord Knight
  { key: "SC_TWOHANDQUICKEN",  label: "Two-Hand Quicken",      max: 10, jobs: [7, 4008] },
  { key: "SC_ONEHANDQUICKEN",  label: "One-Hand Quicken",      max: 10, jobs: [7, 4008] },
  // Crusader / Paladin
  { key: "SC_SPEARQUICKEN",    label: "Spear Quicken",         max: 10, jobs: [14, 4015] },
  { key: "SC_PROVIDENCE",      label: "Providence",            max: 5,  jobs: [14, 4015] },
  // Blacksmith / Whitesmith — SC_SHOUT adds STR+4 in statusCalculator.js
  { key: "SC_MAXIMIZEPOWER",   label: "Maximize Power",        max: 1,  jobs: [10, 4011] },
  { key: "SC_SHOUT",           label: "Loud Exclamation",      max: 1,  jobs: [10, 4011] },
  // Monk / Champion
  { key: "SC_EXPLOSIONSPIRITS", label: "Fury",                 max: 5,  jobs: [15, 4016] },
  // Gunslinger — SC_GS_ACCURACY adds AGI+4/DEX+4 in statusCalculator.js
  { key: "SC_GS_ACCURACY",     label: "Increasing Accuracy",   max: 1,  jobs: [24] },
  // PS renames these two displays ("Barrage" / "Run and Gun") but the
  // underlying constants are the vanilla Gunslinger ones; both are
  // presence-only (level doesn't change the magnitude in statusCalculator.js).
  { key: "SC_GS_MADNESSCANCEL", label: "Barrage",             max: 1,  jobs: [24] },
  { key: "SC_GS_ADJUSTMENT",   label: "Run and Gun",          max: 1,  jobs: [24] },
  // Ninja — SC_NJ_NEN adds +lv STR and +lv INT (defaults; PS may override)
  { key: "SC_NJ_NEN",          label: "Ki",                    max: 10, jobs: [25] },
  // PS wiki calls this "Double Bolt"; underlying constant is the vanilla
  // Professor skill PF_DOUBLECASTING (status SC_DOUBLECASTING) -- only
  // Professor has it in the skill tree, base Sage doesn't. 100% chance to
  // instantly re-cast a Fire/Cold/Lightning Bolt, Earth Spike, or Soul
  // Strike; modeled in battlePipeline.js as halving the effective period
  // for those skills (DPS only, not per-hit damage).
  { key: "SC_DOUBLECASTING",   label: "Double Bolt",          max: 1,  jobs: [4017] },
  // Wizard / High Wizard — Mystical Amplification: next spell +50% MATK (vanilla),
  // or +10% per level capped at level 5 (PS rework). Max 10 vanilla / 5 PS;
  // PS cap enforced server-side via SC_AMPLIFYMAGICPOWER_SCALING mechanic flag.
  { key: "SC_AMPLIFYMAGICPOWER", label: "Mystical Amplification", max: 10, jobs: [9, 4010] },
] as const;

// Received from a party member rather than self-cast -- battle.c treats
// these differently in some cases (e.g. SC_OVERTHRUST from support_buffs
// uses a flatter, weaker formula than the self-cast active_buffs version;
// see skillRatio.js). Grouped by source class for the UI, but every entry
// here writes to build.support_buffs regardless of group.
const PARTY_BUFFS = [
  { key: "SC_IMPOSITIO", label: "Impositio Manus", max: 5, source: "Priest" },
  { key: "SC_BLESSING", label: "Blessing", max: 10, source: "Priest" },
  { key: "SC_INC_AGI", label: "Increase AGI", max: 10, source: "Priest" },
  { key: "SC_GLORIA", label: "Gloria", max: 1, source: "Priest" },
  { key: "SC_ANGELUS", label: "Angelus", max: 5, source: "Priest" },
  { key: "SC_OVERTHRUST", label: "Overthrust", max: 10, source: "Blacksmith" },
  { key: "SC_OVERTHRUSTMAX", label: "Overthrust Max", max: 5, source: "Blacksmith" },
  { key: "SC_ADRENALINE", label: "Adrenaline Rush", max: 2, source: "Blacksmith" },
] as const;

const SONG_BUFFS = [
  { key: "SC_DRUMBATTLE", label: "Battle Theme (Drum)", max: 10 },
  { key: "SC_NIBELUNGEN", label: "Ring of Nibelungen", max: 10 },
  { key: "SC_ASSNCROS", label: "Assassin Cross of Sunset", max: 10 },
  { key: "SC_HUMMING", label: "Humming", max: 10 },
  { key: "SC_FORTUNE", label: "Fortune's Kiss", max: 10 },
  // Reduces cast time + after-cast delay (skillTiming.js), not ASPD
  // directly -- only shows up in DPS when testing an actual skill, not a
  // normal attack, since normal-attack period is ASPD-only.
  { key: "SC_POEMBRAGI", label: "Poem of Bragi", max: 10 },
  // Defensive/utility Bard songs — statusCalculator.js applies these to the
  // character status (flee / perfect dodge / Max HP), so they show in the
  // combat-stat readout even though they don't change outgoing damage.
  { key: "SC_WHISTLE", label: "A Whistle (Flee)", max: 10 },
  { key: "SC_APPLEIDUN", label: "The Apple of Idun (Max HP)", max: 10 },
] as const;

// Passive skills and buffs that add to flat base stats.
// SC_CONCENTRATION is a % of current AGI/DEX — approximated using pre-bonus
// totals (card bonuses excluded per the engine formula, close enough for display).
const CLAN_STAT_BONUSES: Record<string, Partial<Record<keyof typeof emptyBuff, number>>> = {
  sword_clan:       { str_: 1, vit: 1 },
  arch_wand_clan:   { int_: 1, dex: 1 },
  golden_mace_clan: { int_: 1, vit: 1 },
  crossbow_clan:    { dex: 1, agi: 1 },
  artisan_clan:     { dex: 1, luk: 1 },
  vile_wind_clan:   { str_: 1, agi: 1 },
};
const emptyBuff = { str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 };

function computeBuffStatBonuses(
  supportBuffs: Record<string, unknown> = {},
  activeSc: Record<string, unknown> = {},
  preTotals: { agi: number; dex: number } = { agi: 0, dex: 0 },
  masteryLevels: Record<string, unknown> = {},
  clan = "",
): Record<string, number> {
  const b = { ...emptyBuff };
  // Passive skill stat bonuses (mirror of statusCalculator.js lines 45-49)
  if (masteryLevels.BS_HILTBINDING) b.str_ += 1;
  const dragonologyLv = (masteryLevels.SA_DRAGONOLOGY as number) || 0;
  if (dragonologyLv) b.int_ += Math.floor((dragonologyLv + 1) / 2);
  const owlLv = (masteryLevels.AC_OWL as number) || 0;
  if (owlLv) b.dex += owlLv;
  // Active self-buff stat bonuses (mirror of statusCalculator.js lines 55-87)
  if (activeSc.SC_SHOUT) b.str_ += 4;
  const njNenLv = (activeSc.SC_NJ_NEN as number) || 0;
  if (njNenLv) { b.str_ += njNenLv; b.int_ += njNenLv; }
  if (activeSc.SC_GS_ACCURACY) { b.agi += 4; b.dex += 4; }
  // Active / party buff bonuses
  const blessingLv = (supportBuffs.SC_BLESSING as number) || 0;
  if (blessingLv > 0) { b.str_ += blessingLv; b.int_ += blessingLv; b.dex += blessingLv; }
  const incAgiLv = (supportBuffs.SC_INC_AGI as number) || 0;
  if (incAgiLv > 0) { b.agi += 2 + incAgiLv; }
  if (supportBuffs.SC_GLORIA) { b.luk += 30; }
  const concLv = (activeSc.SC_CONCENTRATION as number) || 0;
  if (concLv > 0) {
    const pct = (2 + concLv) / 100;
    b.agi += Math.floor((preTotals.agi + b.agi) * pct);
    b.dex += Math.floor((preTotals.dex + b.dex) * pct);
  }
  // Clan stat bonuses
  const clanBonus = CLAN_STAT_BONUSES[clan] || {};
  for (const [k, v] of Object.entries(clanBonus)) {
    (b as Record<string, number>)[k] = ((b as Record<string, number>)[k] ?? 0) + (v ?? 0);
  }
  return b;
}

const DEFAULT_SKILL: SkillState = { id: 0, level: 1, label: "Normal Attack", max_level: 10 };

const DEFAULT_CUSTOM_TARGET: CustomTarget = {
  def_: 0, mdef_: 0, vit: 1, level: 1, size: "Medium", race: "Formless",
  element: 0, element_level: 1, is_boss: false, luk: 0, agi: 0, int_: 0,
};

const DEFAULT_TARGET_MODS: TargetMods = {
  element_status: "",
  lex_aeterna: false,
  quagmire: false,
  signum_crucis: false,
  provoke: false,
  sleep: false,
  stun: false,
};

function encodeState(state: UrlEditorState): string {
  return "z1_" + LZString.compressToEncodedURIComponent(JSON.stringify(state));
}

function decodeState(encoded: string): UrlEditorState | null {
  try {
    if (encoded.startsWith("z1_")) {
      const json = LZString.decompressFromEncodedURIComponent(encoded.slice(3));
      return json ? JSON.parse(json) : null;
    }
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
}

export default function BuildEditor() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialState = (() => {
    const encoded = searchParams.get("b");
    if (encoded) {
      const s = decodeState(encoded);
      if (s) return s;
    }
    return null;
  })();

  const [data, setData] = useState<BuildData>(initialState?.build ?? DEFAULT_BUILD);
  const [skill, setSkill] = useState<SkillState>({ ...DEFAULT_SKILL, ...(initialState?.skill ?? {}) });
  const [targetMode, setTargetMode] = useState<TargetMode>(initialState?.targetMode ?? "monster");
  const [customTarget, setCustomTarget] = useState<CustomTarget>(initialState?.customTarget ?? DEFAULT_CUSTOM_TARGET);
  const [targetMods, setTargetMods] = useState<TargetMods>(initialState?.targetMods ?? DEFAULT_TARGET_MODS);

  // Which equipment slot groups are in wildcard (custom card mix) mode.
  // Auto-enable only for slots that have both wildcard data AND an item actually equipped there.
  const [wildcardMode, setWildcardMode] = useState<Record<string, boolean>>(() => {
    const slots = initialState?.build?.wildcard_slots ?? {};
    const equipped = initialState?.build?.equipped ?? {};
    const init: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(slots)) {
      if (Array.isArray(v) && v.length > 0 && equipped[k] != null) init[k] = true;
    }
    return init;
  });

  const [jobs, setJobs] = useState<{ id: number; name: string }[]>([]);
  const [passiveSkills, setPassiveSkills] = useState<PassiveSkill[]>([]);
  const [itemCache, setItemCache] = useState<Record<number, EquippedItemInfo>>({});
  const [mobInfo, setMobInfo] = useState<{
    name: string; level: number; race?: string;
    hp?: number; def_?: number; mdef?: number; atk_min?: number; atk_max?: number;
    size?: string; element?: number; element_level?: number; is_boss?: boolean;
    stats?: { str: number; agi: number; vit: number; int: number; dex: number; luk: number };
  } | null>(null);
  const [jobBonusStats, setJobBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });
  const [equipBonusStats, setEquipBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });
  const [buffBonusStats, setBuffBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });
  const [charStatus, setCharStatus] = useState<any>(null);

  // Slots whose equipped item's job[] list doesn't include the current job_id.
  // Derived — no extra state. Assumes valid when item not yet in cache.
  const invalidSlots = useMemo(() => {
    const invalid = new Set<string>();
    for (const slot of EQUIP_SLOTS) {
      if (slot.itemType === "IT_AMMO") continue; // ammo restrictions enforced by search filter only
      const equippedId = data.equipped[slot.key] as number | null | undefined;
      if (equippedId == null) continue;
      const item = itemCache[equippedId];
      if (!item?.job || item.job.length === 0) continue;
      if (!item.job.includes(data.job_id)) invalid.add(slot.key);
    }
    return invalid;
  }, [data.equipped, data.job_id, itemCache]);

  // Build sent to the backend — same as `data` but with invalid slots nulled out
  // so they don't affect gear bonus badges or the damage calculation.
  const sanitizedBuild = useMemo(() => {
    if (invalidSlots.size === 0) return data;
    const equipped = { ...data.equipped };
    for (const slotKey of invalidSlots) {
      equipped[slotKey] = null;
      for (let i = 1; i <= 4; i++) delete equipped[`${slotKey}_card${i}`];
    }
    return { ...data, equipped };
  }, [data, invalidSlots]);

  // Signum Crucis only works on Undead and Demon targets.
  const signumApplicable = useMemo(() => {
    if (targetMode === "custom") {
      return customTarget.race === "Undead" || customTarget.race === "Demon";
    }
    // Monster mode: allow if no mob selected yet (unknown), or once loaded check race.
    return !data.target_mob_id || mobInfo?.race === "Undead" || mobInfo?.race === "Demon";
  }, [targetMode, customTarget.race, data.target_mob_id, mobInfo?.race]);

  const totalStatPoints = useMemo(
    () => getTotalStatPoints(data.base_level, data.job_id),
    [data.base_level, data.job_id],
  );
  const remainingStatPoints = useMemo(
    () => totalStatPoints
        - STATS.reduce((sum, s) => sum + (STAT_COST_TABLE[data.base_stats[s] ?? 1] ?? 0), 0),
    [data.base_stats, totalStatPoints],
  );

  const [calcResult, setCalcResult] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState("");
  const [forceProcs, setForceProcs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedBuildsOpen, setSavedBuildsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const resultsPanelRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (localStorage.getItem("theme") as "dark" | "light") || "dark"
  );
  const [themeHintSeen, setThemeHintSeen] = useState(() => localStorage.getItem("themeHintSeen") === "1");
  const [reworksBannerCollapsed, setReworksBannerCollapsed] = useState(() => localStorage.getItem("reworksBannerCollapsed") !== "0");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => { api.listJobs().then(setJobs).catch(() => {}); }, []);

  // Keep skill.max_level in sync whenever the selected skill changes
  useEffect(() => {
    if (skill.id === 0) return;
    api.getSkillById(skill.id, data.server)
      .then((s) => {
        const cap = s.max_level ?? 10;
        setSkill((prev) => ({
          ...prev,
          max_level: cap,
          level: Math.max(1, Math.min(cap, prev.level)),
        }));
      })
      .catch(() => {});
  }, [skill.id, data.server]);

  // Keep URL in sync with editor state (debounced 400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const state: UrlEditorState = { build: data, skill, targetMode, customTarget, targetMods };
      setSearchParams({ b: encodeState(state) }, { replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [data, skill, targetMode, customTarget, targetMods]);

  // Resolve names for already-equipped items
  useEffect(() => {
    const ids = Object.values(data.equipped).filter((v): v is number => v != null);
    ids.forEach((itemId) => {
      if (itemCache[itemId]) return;
      api.getItem(itemId, data.server)
        .then((item) => setItemCache((prev) => ({ ...prev, [itemId]: item })))
        .catch(() => {});
    });
  }, [data.equipped, data.server]);

  // Fetch passive skills when job (or server, since PS retunes some
  // max levels/names vs vanilla -- e.g. Advanced Book) changes
  useEffect(() => {
    if (!data.job_id) { setPassiveSkills([]); return; }
    api.getJobPassives(data.job_id, data.server).then(setPassiveSkills).catch(() => setPassiveSkills([]));
  }, [data.job_id, data.server]);

  // Per-job-level STR/AGI/VIT/INT/DEX/LUK bonus (e.g. Knight +1 STR every
  // few job levels) -- statusCalculator.js already folds this into the
  // damage calc server-side; fetched here purely to surface it next to the
  // base stat inputs instead of it only ever showing up invisibly in the
  // final numbers.
  useEffect(() => {
    if (!data.job_id) { setJobBonusStats({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 }); return; }
    api.getJobBonusStats(data.job_id, data.job_level, data.server)
      .then(setJobBonusStats)
      .catch(() => setJobBonusStats({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 }));
  }, [data.job_id, data.job_level, data.server]);

  // Equipment stat bonuses (bStr, bAgi, etc. from item scripts) -- debounced
  // so rapid equip/unequip changes don't flood the endpoint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const zero = { str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 };
    const hasEquipped = Object.values(data.equipped).some((v) => v != null);
    if (!hasEquipped) { setEquipBonusStats(zero); return; }
    const timer = setTimeout(() => {
      api.getGearStatBonuses(sanitizedBuild).then(setEquipBonusStats).catch(() => setEquipBonusStats(zero));
    }, 300);
    return () => clearTimeout(timer);
  // JSON.stringify lets us deep-compare the objects that actually drive gear scripts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sanitizedBuild.equipped), JSON.stringify(data.refine), data.server,
      JSON.stringify(data.base_stats), data.job_id, data.job_level, data.base_level,
      JSON.stringify(data.bonus_stats), data.selected_pet]);

  useEffect(() => {
    const base = data.base_stats;
    setBuffBonusStats(computeBuffStatBonuses(
      (data.support_buffs || {}) as Record<string, unknown>,
      (data.active_buffs || {}) as Record<string, unknown>,
      {
        agi: (base.agi ?? 1) + (jobBonusStats.agi ?? 0) + (equipBonusStats.agi ?? 0),
        dex: (base.dex ?? 1) + (jobBonusStats.dex ?? 0) + (equipBonusStats.dex ?? 0),
      },
      (data.mastery_levels || {}) as Record<string, unknown>,
      data.clan ?? "",
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data.support_buffs), JSON.stringify(data.active_buffs),
      JSON.stringify(data.mastery_levels), data.clan,
      data.base_stats.agi, data.base_stats.dex, jobBonusStats, equipBonusStats]);

  // Secondary status panel (Max HP/SP, regen, ATK, MATK, DEF, MDEF, ASPD, Crit)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(() => {
      api.getCharacterStatus(sanitizedBuild)
        .then(setCharStatus)
        .catch(() => setCharStatus(null));
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sanitizedBuild)]);

  // Hiding a self-buff from the panel on job change isn't enough on its own --
  // a stale value left in active_buffs from a previous job would still be
  // sent to the backend and silently applied. Strip anything that doesn't
  // belong to the now-selected job. Party buffs/songs are never filtered by
  // job (they come from other players), so they're left untouched here.
  useEffect(() => {
    setData((prev) => {
      const allSelfKeys: readonly string[] = SELF_BUFFS.map((b) => b.key);
      const keepSelf = new Set<string>(SELF_BUFFS.filter((b) => (b.jobs as readonly number[]).includes(prev.job_id)).map((b) => b.key));
      const prevActive = prev.active_buffs || {};
      const nextActive: Record<string, number> = {};
      for (const [k, v] of Object.entries(prevActive)) {
        if (!allSelfKeys.includes(k) || keepSelf.has(k)) nextActive[k] = v;
      }
      if (Object.keys(nextActive).length === Object.keys(prevActive).length) return prev;
      return { ...prev, active_buffs: nextActive };
    });
  }, [data.job_id]);

  // Clear ASPD potion if the new job can't use the currently selected one.
  useEffect(() => {
    setData((prev) => {
      const cap = aspdPotionCap(prev.job_id);
      const current = (prev.consumable_buffs?.aspd_potion as number) ?? 0;
      if (current <= cap) return prev;
      const next = { ...(prev.consumable_buffs || {}) } as Record<string, unknown>;
      delete next.aspd_potion;
      return { ...prev, consumable_buffs: next };
    });
  }, [data.job_id]);

  // Resolve mob display info
  useEffect(() => {
    if (!data.target_mob_id) { setMobInfo(null); return; }
    fetch(`/api/data/mobs/${data.target_mob_id}?server=${data.server}`)
      .then((r) => r.json())
      .then(setMobInfo)
      .catch(() => setMobInfo(null));
  }, [data.target_mob_id, data.server]);

  // Auto-clear Signum Crucis when the target changes to a non-applicable race.
  useEffect(() => {
    if (!signumApplicable) {
      setTargetMods((m) => m.signum_crucis ? { ...m, signum_crucis: false } : m);
    }
  }, [signumApplicable]);

  const updateField = useCallback((path: string[], value: unknown) => {
    setData((prev) => {
      const next = structuredClone(prev) as any;
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return next;
    });
  }, []);

  const updateWildcardSlot = useCallback((slotKey: string, idx: number, patch: Partial<WildcardSlot>) => {
    setData((prev) => {
      const existing = (prev.wildcard_slots?.[slotKey] || [])[idx] ?? { type: "race" as const, bonus: 20 };
      const next: WildcardSlot = { ...existing, ...patch };
      if (patch.type && patch.type !== existing.type) {
        next.bonus = WILDCARD_DEFAULT_BONUS[patch.type];
      }
      const slots = [...(prev.wildcard_slots?.[slotKey] || [])];
      slots[idx] = next;
      return { ...prev, wildcard_slots: { ...(prev.wildcard_slots || {}), [slotKey]: slots } };
    });
  }, []);

  const updateConsumable = useCallback((key: keyof ConsumableBuffs, value: number | boolean | undefined) => {
    setData((prev) => {
      const next = { ...(prev.consumable_buffs || {}) } as any;
      if (value === undefined || value === 0 || value === false) delete next[key];
      else next[key] = value;
      return { ...prev, consumable_buffs: next };
    });
  }, []);

  const updateBuffField = useCallback((group: "active_buffs" | "song_state" | "support_buffs", key: string, level: number) => {
    setData((prev) => {
      const next: Record<string, unknown> = { ...((prev[group] as Record<string, unknown>) || {}) };
      if (level <= 0) delete next[key];
      else next[key] = level;
      return { ...prev, [group]: next };
    });
  }, []);

  // Sage's three ground spells (Volcano/Deluge/Violent Gale) share one
  // mutually-exclusive slot (support_buffs.ground_effect + ..._lv) -- you
  // can only stand in one at a time. All three also affect damage: Volcano
  // directly (+ATK/+MATK), and all three via attrFix.js's elemental
  // "enchant" bonus when your weapon's element matches the ground effect's.
  const updateGroundEffect = useCallback((type: string, level: number) => {
    setData((prev) => {
      const next: Record<string, unknown> = { ...(prev.support_buffs || {}) };
      if (!type || level <= 0) {
        delete next.ground_effect;
        delete next.ground_effect_lv;
      } else {
        next.ground_effect = type;
        next.ground_effect_lv = level;
      }
      return { ...prev, support_buffs: next };
    });
  }, []);

  // Priest weapon endow -- also a single mutually-exclusive slot
  // (support_buffs.weapon_endow_sc, or the boolean SC_ASPERSIO for Holy).
  const updateWeaponEndow = useCallback((value: string) => {
    setData((prev) => {
      const next: Record<string, unknown> = { ...(prev.support_buffs || {}) };
      delete next.weapon_endow_sc;
      delete next.SC_ASPERSIO;
      if (value === "SC_ASPERSIO") next.SC_ASPERSIO = true;
      else if (value) next.weapon_endow_sc = value;
      return { ...prev, support_buffs: next };
    });
  }, []);

  async function onCalculate(fpOverride?: boolean) {
    const fp = fpOverride !== undefined ? fpOverride : forceProcs;
    setCalculating(true);
    setCalcError("");
    setResultsOpen(true);
    try {
      const target = targetMode === "monster"
        ? { mob_id: data.target_mob_id }
        : customTarget;
      // Aggregate wildcard slot bonuses and strip real card entries for those slots.
      // The rendered wildcard rows track the equipped weapon's live card-slot
      // count (item.slots, from the async itemCache), but the stored
      // wildcard_slots array lags behind after a weapon switch -- it can be
      // shorter (extra rows show unsaved ?? defaults) or longer (stale rows from
      // the previous weapon). Iterate the weapon's actual slot count with the
      // same fallback default the UI uses (see the wildcard-slots render) so the
      // pipeline applies exactly what's on screen, not the drifted stored array.
      const WILDCARD_DEFAULT: WildcardSlot = { type: "race", bonus: 20 };
      const wildcardBonuses: Record<string, number> = {};
      const equippedOverride = { ...sanitizedBuild.equipped };
      for (const [slotKey, active] of Object.entries(wildcardMode)) {
        if (!active) continue;
        const equippedId = equippedOverride[slotKey];
        if (equippedId == null) continue; // slot is empty — skip
        for (let i = 1; i <= 4; i++) delete equippedOverride[`${slotKey}_card${i}`];
        const stored = data.wildcard_slots?.[slotKey] || [];
        // Weapon's real slot count; fall back to stored length if the item's
        // data hasn't loaded into the cache yet (so nothing is dropped mid-switch).
        const slotCount = (itemCache[equippedId]?.slots ?? 0) || stored.length;
        for (let i = 0; i < slotCount; i++) {
          const ws = stored[i] ?? WILDCARD_DEFAULT;
          const key = ws.type === "race" ? "RC_All" : ws.type === "size" ? "Size_All" : "Ele_All";
          wildcardBonuses[key] = (wildcardBonuses[key] || 0) + ws.bonus;
          if (ws.type === "size") wildcardBonuses["_batk"] = (wildcardBonuses["_batk"] || 0) + 5;
        }
      }
      const buildWithFlags = fp
        ? { ...sanitizedBuild, equipped: equippedOverride, flags: { ...(sanitizedBuild.flags || {}), force_procs: true }, wildcard_bonuses: wildcardBonuses }
        : { ...sanitizedBuild, equipped: equippedOverride, wildcard_bonuses: wildcardBonuses };
      const normalPayload = { build: buildWithFlags, skill: { id: 0, level: 1 }, target, target_mods: targetMods };
      const skillPayload  = { build: buildWithFlags, skill: { id: skill.id, level: skill.level }, target, target_mods: targetMods };
      const [normalRes, skillRes] = await Promise.all([
        api.calculate(normalPayload),
        skill.id !== 0 ? api.calculate(skillPayload) : Promise.resolve(null),
      ]);
      setCalcResult({
        normal_attack: normalRes,
        skill: skillRes,
        selected_skill: { id: skill.id, level: skill.level, label: skill.label },
      });
    } catch (e: any) {
      setCalcError(e.message);
    } finally {
      setCalculating(false);
      setTimeout(() => resultsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  function handleToggleForceProcs() {
    const nextFP = !forceProcs;
    setForceProcs(nextFP);
    onCalculate(nextFP);
  }

  function onNewBuild() {
    if (!window.confirm("Start over? Any unsaved changes will be lost (save it first from Save / Load if you want to keep it).")) return;
    setData(DEFAULT_BUILD);
    setSkill(DEFAULT_SKILL);
    setTargetMode("monster");
    setCustomTarget(DEFAULT_CUSTOM_TARGET);
    setTargetMods(DEFAULT_TARGET_MODS);
    setCalcResult(null);
    setCalcError("");
    setResultsOpen(false);
  }

  function onLoadSavedState(state: UrlEditorState) {
    setData(state.build);
    setSkill({ ...DEFAULT_SKILL, ...state.skill });
    setTargetMode(state.targetMode);
    setCustomTarget(state.customTarget);
    setTargetMods(state.targetMods ?? DEFAULT_TARGET_MODS);
    setCalcResult(null);
    setCalcError("");
    setResultsOpen(false);
  }

  function onCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const itemLabel = (it: any) => it.slots > 0 ? `${it.name}[${it.slots}]` : it.name;

  const canEquip = useCallback(
    (it: any) => !Array.isArray(it.job) || it.job.length === 0 || it.job.includes(data.job_id),
    [data.job_id],
  );

  const sortResults = (rows: SearchResult[]) =>
    rows.sort((a, b) => (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0));

  const itemSearch = useCallback(
    (itemType: string, loc?: string) => (query: string): Promise<SearchResult[]> => {
      const browse = !query.trim();
      const params: Record<string, unknown> = {
        type: itemType, ...(loc ? { loc } : {}), q: query, limit: browse ? 100 : 20, server: data.server,
        ...(browse ? { job: data.job_id } : {}),
      };
      return api.searchItems(params)
        .then((r) => sortResults(r.items.map((it: any) => ({
          id: it.id, label: itemLabel(it), sublabel: `#${it.id}`, disabled: !canEquip(it),
        }))));
    },
    [data.server, data.job_id, canEquip],
  );

  const leftHandSearch = useCallback(
    (query: string): Promise<SearchResult[]> => {
      const browse = !query.trim();
      const jobParam = browse ? { job: data.job_id } : {};
      return Promise.all([
        api.searchItems({ type: "IT_ARMOR", loc: "EQP_SHIELD", q: query, limit: browse ? 100 : 20, server: data.server, ...jobParam }),
        api.searchItems({ type: "IT_WEAPON", q: query, limit: browse ? 100 : 20, server: data.server, ...jobParam }),
      ]).then(([shields, weapons]) => sortResults([
        ...shields.items.map((it: any) => ({ id: it.id, label: itemLabel(it), sublabel: `Shield #${it.id}`, disabled: !canEquip(it) })),
        ...weapons.items.map((it: any) => ({ id: it.id, label: itemLabel(it), sublabel: `Weapon #${it.id}`, disabled: !canEquip(it) })),
      ]));
    },
    [data.server, data.job_id, canEquip],
  );

  const fetchItemTooltip = useCallback(
    (id: number): Promise<string | null> =>
      api.getItem(id, data.server).then((item: any) => {
        let desc: string = item.description || "";
        // Strip unidentified-item prefix that appears in vanilla pre-re descriptions
        desc = desc.replace(/^Unknown Item[^.\n]*\.\n?/i, "");
        // Convert HTML line breaks (PS item overrides use raw game-client HTML)
        desc = desc.replace(/<br\s*\/?>/gi, "\n");
        // Strip remaining HTML tags (e.g. <font color='...'> from PS descriptions)
        desc = desc.replace(/<[^>]+>/g, "");
        // Normalize game-client visual separator lines
        desc = desc.replace(/_\n/g, "\n").trim();
        return desc || null;
      }).catch(() => null),
    [data.server],
  );

  const mobSearch = useCallback(
    (query: string): Promise<SearchResult[]> =>
      api.searchMobs({ q: query, limit: 12, server: data.server })
        .then((r) => r.items.map((m: any) => ({ id: m.id, label: m.name, sublabel: `Lv${m.level}` }))),
    [data.server],
  );

  const skillSearch = useCallback(
    (query: string): Promise<SearchResult[]> =>
      api.searchSkills({ q: query, limit: 12, server: data.server, damage_only: "true" })
        .then((r) => r.items.map((s: any) => ({ id: s.id, label: s.display_name || s.name || `Skill ${s.id}`, sublabel: s.name, max_level: s.max_level ?? 10 }))),
    [data.server],
  );

  const currentEditorState: UrlEditorState = { build: data, skill, targetMode, customTarget, targetMods };

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-left">
          <span className="brand-mark">⚔</span>
          <span className="brand-title">Open PS Calc</span>
          <span className="topbar-info-icon">
            <InfoTooltip>
              <strong>Open PS Calc</strong>
              A pre-renewal Ragnarok Online damage calculator for vanilla
              and Payon Stories servers — equip gear, pick a skill and
              target, and see the full step-by-step damage breakdown.
              <span className="tooltip-row">
                <span>Based on</span>
                <a href="https://github.com/StatGameDev/Open_PS_Calc" target="_blank" rel="noreferrer">Open PS Calc</a>
              </span>
              <span className="tooltip-row">
                <span>This repo</span>
                <a href="https://github.com/ervinkleitz/WebOpenPSCalc" target="_blank" rel="noreferrer">WebOpenPSCalc</a>
              </span>
            </InfoTooltip>
          </span>
        </div>
        <div className="topbar-right">
          {/* Server select — always visible on tablet+, hidden on phones (shown in dropdown instead) */}
          <select
            className="topbar-server-select topbar-server-inline"
            value={data.server}
            onChange={(e) => updateField(["server"], e.target.value)}
            aria-label="Server"
          >
            <option value="payon_stories">Payon Stories</option>
            <option value="standard">Standard pre-renewal</option>
          </select>

          <div style={{ position: "relative" }}>
            <button
              className="ghost theme-toggle"
              onClick={() => {
                setTheme(t => t === "dark" ? "light" : "dark");
                if (!themeHintSeen) {
                  setThemeHintSeen(true);
                  localStorage.setItem("themeHintSeen", "1");
                }
              }}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {!themeHintSeen && (
              <div className="theme-hint">{theme === "dark" ? "Try light mode" : "Try dark mode"}</div>
            )}
          </div>

          {/* Secondary actions — inline on desktop (>1100px), dropdown otherwise */}
          <div className={`topbar-secondary${menuOpen ? " topbar-secondary--open" : ""}`}>
            {/* Server select copy — shown only inside dropdown on phones */}
            <select
              className="topbar-server-select topbar-server-dropdown"
              value={data.server}
              onChange={(e) => { updateField(["server"], e.target.value); setMenuOpen(false); }}
              aria-label="Server"
            >
              <option value="payon_stories">Payon Stories</option>
              <option value="standard">Standard pre-renewal</option>
            </select>
            <button onClick={() => { setSavedBuildsOpen(true); setMenuOpen(false); }}>Save / Load</button>
            <button onClick={() => { onNewBuild(); setMenuOpen(false); }}>Start over</button>
            <button onClick={() => { setChangelogOpen(true); setMenuOpen(false); }}>Changelog</button>
            <button onClick={() => { onCopyLink(); setMenuOpen(false); }}>{copied ? "Copied!" : "Copy share link"}</button>
            <a className="topbar-kofi-btn" href="https://ko-fi.com/I7A322JOTP" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>☕ Support</a>
          </div>

          {/* Hamburger — hidden on desktop */}
          <button
            className="ghost topbar-hamburger"
            onClick={() => setMenuOpen(m => !m)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

          <button className="primary" onClick={() => onCalculate()} disabled={calculating}>
            {calculating ? "Calculating…" : "Calculate damage"}
          </button>
        </div>
        {menuOpen && <div className="topbar-backdrop" onClick={() => setMenuOpen(false)} />}
      </div>

      <div className="page">
        <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        <SavedBuildsModal
          open={savedBuildsOpen}
          onClose={() => setSavedBuildsOpen(false)}
          currentName={data.name}
          currentState={currentEditorState}
          onLoad={onLoadSavedState}
          onSave={(name) => setData((prev) => ({ ...prev, name }))}
        />
        {data.server === "payon_stories" && (
          <div className="reworks-banner">
            <button
              className="reworks-banner-toggle"
              onClick={() => {
                const next = !reworksBannerCollapsed;
                setReworksBannerCollapsed(next);
                localStorage.setItem("reworksBannerCollapsed", next ? "1" : "0");
              }}
              aria-expanded={!reworksBannerCollapsed}
              aria-label={reworksBannerCollapsed ? "Expand" : "Collapse"}
            >
              <strong>PS class reworks implemented</strong>
              <span className="reworks-banner-chevron">{reworksBannerCollapsed ? "▸" : "▾"}</span>
            </button>
            {!reworksBannerCollapsed && (
              <ul>
                <li>Assassin / Thief — dual-wield 3-hit model, Enchant Poison bonus, Katar second hit, Envenom element</li>
                <li>Hunter — offensive trap damage (Land Mine, Blast Mine, Freezing Trap, Claymore Trap)</li>
                <li>Monk — Triple Attack proc on auto-attack (procs can crit during Fury)</li>
                <li>Crusader — Reflect Shield formula, Spear Quicken (Hit/Flee), Magnum endow restricted to auto-attacks</li>
                <li>Knight — Sword Quickening CRIT, Blade Mastery covers 1H Sword, Spear Stab max level 5</li>
                <li>Rogue — Backstab formula (200+30×lv, +40% opportunity bonus), Trick Arrow 2-hit 200%, Raid 600%, Vulture's Eye enables bow Double Attack, Yser Card functional</li>
                <li>Wizard / High Wizard — Frost Nova base formula (190+15×lv, +10% per Frost Diver lv), Lord of Vermillion 200×lv% total (4 waves), Napalm Vulcan Shadow element + 50% MDEF ignore, Fire Pillar 50% MDEF ignore, Mystical Amplification +10%/lv (max lv 5), Sightrasher max lv 5, Soul Drain +1% MaxHP/lv</li>
                <li>Gunslinger — Triple Action 420% total (100+40×lv), Ground Drift 200+60×lv% (max 800%), Soul Bullet (50+DEX+BaseLvl)%, Heavy-Tipped Bullet ATK 45 +10% all races; Dust/Full Buster/Spread Attack 7% Neutral resist now also triggers with Grenade Launcher</li>
                <li>Sage — Soul Strike ignores 50% MDEF (lv 10 learned) and deals +5%×lv bonus vs Undead race; Fireball (70+30×lv)% per hit (lv 1–10: 70%→340%); Earth Spike and Heavens Drive 140%×lv per hit; Advanced Book ATK +10–30 flat (lv 1–5); Volcano/Deluge/Violent Gale persistence buffs at max level 3</li>
              </ul>
            )}
          </div>
        )}

        <ResultsPanel
          ref={resultsPanelRef}
          open={resultsOpen}
          onClose={() => setResultsOpen(false)}
          calcResult={calcResult}
          calculating={calculating}
          error={calcError}
          forceProcs={forceProcs}
          onToggleForceProcs={handleToggleForceProcs}
        />

        <div className="editor-grid">
        <div>
          <Panel eyebrow="01" title="Character">
            <div className="field-row">
              <div className="field">
                <label>Build name</label>
                <span className="field-static">{data.name || "—"}</span>
              </div>
              <div className="field">
                <label>Job</label>
                <select
                  value={data.job_id}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const job = jobs.find((j) => j.id === id);
                    setData((prev) => ({
                      ...prev,
                      job_id: id,
                      job_name: job?.name ?? "",
                      job_level: Math.min(prev.job_level, getJobLevelCap(id)),
                    }));
                  }}
                >
                  {jobs.length === 0 && <option value={data.job_id}>{data.job_name || `Job ${data.job_id}`}</option>}
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Base level</label>
                <input
                  className="mono"
                  type="number"
                  min={1}
                  max={BASE_LEVEL_CAP}
                  value={data.base_level}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateField(["base_level"], Math.max(1, Math.min(BASE_LEVEL_CAP, Number(e.target.value))))}
                />
              </div>
              <div className="field">
                <label>Job level</label>
                <input
                  className="mono"
                  type="number"
                  min={1}
                  max={getJobLevelCap(data.job_id)}
                  value={data.job_level}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateField(["job_level"], Math.max(1, Math.min(getJobLevelCap(data.job_id), Number(e.target.value))))}
                />
              </div>
            </div>
            <label style={{ marginTop: "0.3rem" }} className="section-label">
              Base stats
              <InfoTooltip>
                The bold total includes the job-level stat bonus, flat
                bonuses from equipped items (bStr, bAgi, etc.), passive
                skill bonuses (Dragonology → INT; Owl's Eye → DEX;
                Hilt Binding → STR), and buff bonuses (Blessing, Inc AGI,
                Gloria, Attention Concentrate) — all folded into the
                damage calculation.
              </InfoTooltip>
              <span className={`stat-pts-counter${remainingStatPoints < 0 ? " stat-pts-counter--over" : remainingStatPoints <= 10 ? " stat-pts-counter--low" : ""}`}>
                <span className="stat-pts-bar">
                  <span className="stat-pts-bar__fill" style={{ width: `${(Math.min(1, Math.max(0, 1 - remainingStatPoints / totalStatPoints)) * 100).toFixed(1)}%` }} />
                </span>
                {remainingStatPoints.toLocaleString()} SP remaining
              </span>
            </label>
            <div className="ro-stat-grid">
              {STATS.map((s) => {
                const jobBonus = jobBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const equipBonus = equipBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const buffBonus = buffBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const manualBonus = (data.bonus_stats?.[s] as number) ?? 0;
                const base = data.base_stats[s] ?? 1;
                const nextCost = Math.floor((base - 1) / 10) + 2;
                return (
                  <div className="ro-stat-card" key={s}>
                    <div className="ro-stat-name">{s.toUpperCase()}</div>
                    <div className="ro-stat-total">{base + jobBonus + equipBonus + buffBonus + manualBonus}</div>
                    <div className="ro-stat-detail">
                      <input
                        className="mono"
                        type="number"
                        min={1}
                        max={MAX_STAT}
                        value={base}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const newVal = Math.max(1, Math.min(MAX_STAT, Number(e.target.value)));
                          if (newVal > base) {
                            const capped = maxAffordableStat(base, remainingStatPoints);
                            updateField(["base_stats", s], Math.min(newVal, capped));
                          } else {
                            updateField(["base_stats", s], newVal);
                          }
                        }}
                      />
                      {jobBonus > 0 && <span className="ro-stat-bonus" title={`+${jobBonus} from job level`}>+{jobBonus}</span>}
                      {equipBonus > 0 && <span className="ro-stat-bonus ro-stat-bonus--equip" title={`+${equipBonus} from equipment`}>+{equipBonus}</span>}
                      {buffBonus > 0 && <span className="ro-stat-bonus ro-stat-bonus--buff" title={`+${buffBonus} from skills / buffs`}>+{buffBonus}</span>}
                      {manualBonus !== 0 && <span className="ro-stat-bonus ro-stat-bonus--manual" title={`${manualBonus > 0 ? "+" : ""}${manualBonus} manual`}>{manualBonus > 0 ? "+" : ""}{manualBonus}</span>}
                    </div>
                    <div className="ro-stat-cost">+{nextCost} pt</div>
                  </div>
                );
              })}
            </div>
            <label style={{ marginTop: "0.9rem" }} className="section-label">
              Manual stat bonuses
              <InfoTooltip>
                Flat additions applied on top of your allocated stats — use this
                to model any stat source the calculator doesn't cover (temporary
                food buffs, quest rewards, etc.). Folded into the bold total
                above and the damage calculation. Negative values are allowed.
              </InfoTooltip>
            </label>
            <div className="passive-grid">
              {STATS.map((s) => (
                <div className="field" key={s}>
                  <label>{s.toUpperCase()}</label>
                  <input
                    className="mono"
                    type="number"
                    value={(data.bonus_stats?.[s] as number) ?? 0}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => updateField(["bonus_stats", s], Math.trunc(Number(e.target.value) || 0))}
                  />
                </div>
              ))}
            </div>
            <label style={{ marginTop: "0.9rem" }} className="section-label">Combat stats</label>
            <div className="sec-stat-grid">
              {([
                { label: "Max HP",   value: charStatus?.max_hp?.toLocaleString() },
                { label: "Max SP",   value: charStatus?.max_sp?.toLocaleString() },
                { label: "HP Regen", value: charStatus ? `${charStatus.hp_regen} /tick` : undefined },
                { label: "SP Regen", value: charStatus ? `${charStatus.sp_regen} /tick` : undefined },
                { label: "ATK",      value: charStatus ? String(charStatus.batk + charStatus.weapon_atk) : undefined },
                { label: "MATK",     value: charStatus ? `${charStatus.matk_min}–${charStatus.matk_max}` : undefined },
                { label: "DEF",      value: charStatus ? `${charStatus.hard_def}+${charStatus.soft_def}` : undefined },
                { label: "MDEF",     value: charStatus ? `${charStatus.hard_mdef}+${charStatus.soft_mdef}` : undefined },
                { label: "ASPD",     value: charStatus?.aspd?.toFixed(1) },
                { label: "Flee",     value: charStatus?.flee?.toLocaleString() },
                { label: "Critical", value: charStatus ? `${(charStatus.cri / 10).toFixed(1)}%` : undefined },
              ] as { label: string; value?: string }[]).map(({ label, value }) => (
                <div key={label} className="sec-stat-card">
                  <div className="sec-stat-label">{label}</div>
                  <div className="sec-stat-value">{value ?? "—"}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="02" title="Equipment">
            <div className="equip-grid">
              {EQUIP_SLOTS.map((slot) => {
                const equippedId = data.equipped[slot.key] as number | null | undefined;
                const item = equippedId != null ? itemCache[equippedId] : null;
                const cardSlotCount = item?.slots ?? 0;
                const isWeaponSlot = slot.key === "right_hand" || (slot.key === "left_hand" && item?.type === "IT_WEAPON");
                const isRefineable = item?.refineable ?? false;
                const isInvalid = invalidSlots.has(slot.key);
                const cardLoc = slot.key === "left_hand" && item?.type === "IT_WEAPON"
                  ? "EQP_WEAPON"
                  : SLOT_CARD_LOC[slot.key];
                return (
                  <div key={slot.key} className="field">
                    <label>{slot.label}</label>
                    {equippedId != null ? (
                      <>
                      <div className={`selected-pill${isInvalid ? " selected-pill--invalid" : ""}`}>
                        <span title={isInvalid ? "Not equippable by this class — excluded from calculation" : undefined}>
                          {item ? item.name : `Item #${equippedId}`}
                          {isRefineable ? ` +${data.refine[slot.key] || 0}` : ""}
                        </span>
                        <button
                          onClick={() => {
                            setData((prev) => {
                              const next = structuredClone(prev) as any;
                              next.equipped[slot.key] = null;
                              for (let i = 1; i <= 4; i++) delete next.equipped[`${slot.key}_card${i}`];
                              return next;
                            });
                          }}
                        >
                          Unequip
                        </button>
                      </div>
                      {isInvalid && (
                        <span style={{ fontSize: "0.72rem", color: "var(--crit)", marginTop: "0.2rem", display: "block" }}>
                          Not equippable by this class
                        </span>
                      )}
                      </>
                    ) : (
                      <SearchPicker
                        placeholder={`Search ${slot.label.toLowerCase()}…`}
                        search={"dualWield" in slot && slot.dualWield ? leftHandSearch : itemSearch(slot.itemType, "loc" in slot ? slot.loc : undefined)}
                        onSelect={(r) => {
                          updateField(["equipped", slot.key], r.id);
                          api.getItem(r.id, data.server)
                            .then((full) => setItemCache((prev) => ({ ...prev, [r.id]: full })))
                            .catch(() => setItemCache((prev) => ({ ...prev, [r.id]: { id: r.id, name: r.label } })));
                        }}
                        fetchTooltip={fetchItemTooltip}
                      />
                    )}
                    {isRefineable && equippedId != null && (
                      <input
                        className="mono"
                        type="number"
                        min={0}
                        max={10}
                        style={{ marginTop: "0.4rem" }}
                        value={data.refine[slot.key] || 0}
                        onChange={(e) => updateField(["refine", slot.key], Math.min(10, Math.max(0, Number(e.target.value))))}
                        onFocus={(e) => e.target.select()}
                        title="Refine level"
                      />
                    )}
                    {cardSlotCount > 0 && (
                      <>
                        {isWeaponSlot && (
                          <div className="card-mode-toggle">
                            <button
                              className={!wildcardMode[slot.key] ? "active" : ""}
                              onClick={() => setWildcardMode((prev) => ({ ...prev, [slot.key]: false }))}
                            >
                              Cards
                            </button>
                            <button
                              className={wildcardMode[slot.key] ? "active" : ""}
                              onClick={() => {
                                setWildcardMode((prev) => ({ ...prev, [slot.key]: true }));
                                if (!data.wildcard_slots?.[slot.key]?.length) {
                                  const defaults = Array.from({ length: cardSlotCount }, () => ({
                                    type: "race" as const,
                                    bonus: 20,
                                  }));
                                  setData((prev) => ({
                                    ...prev,
                                    wildcard_slots: { ...(prev.wildcard_slots || {}), [slot.key]: defaults },
                                  }));
                                }
                              }}
                            >
                              Wildcard mix
                            </button>
                          </div>
                        )}
                        {isWeaponSlot && wildcardMode[slot.key] ? (
                          <div className="wildcard-slots">
                            {Array.from({ length: cardSlotCount }, (_, i) => {
                              const ws = data.wildcard_slots?.[slot.key]?.[i] ?? {
                                type: "race" as const,
                                bonus: 20,
                              };
                              return (
                                <div key={i} className="wildcard-slot-row">
                                  <select
                                    value={ws.type}
                                    onChange={(e) =>
                                      updateWildcardSlot(slot.key, i, {
                                        type: e.target.value as WildcardSlot["type"],
                                      })
                                    }
                                  >
                                    <option value="race">Race</option>
                                    <option value="size">Size</option>
                                    <option value="ele">Element</option>
                                  </select>
                                  {ws.type !== "size" ? (
                                    <select
                                      value={ws.bonus}
                                      onChange={(e) =>
                                        updateWildcardSlot(slot.key, i, { bonus: Number(e.target.value) })
                                      }
                                    >
                                      {WILDCARD_BONUS_OPTIONS.map((v) => (
                                        <option key={v} value={v}>
                                          {v}%
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="wildcard-size-label">15% +5 ATK</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="card-slots">
                            {Array.from({ length: cardSlotCount }, (_, i) => {
                              const cardKey = `${slot.key}_card${i + 1}`;
                              const cardId = data.equipped[cardKey] as number | null | undefined;
                              const card = cardId != null ? itemCache[cardId] : null;
                              return (
                                <div key={cardKey} className="card-slot">
                                  {cardId != null ? (
                                    <div className="selected-pill">
                                      <span>{card ? card.name : `Card #${cardId}`}</span>
                                      <button onClick={() => updateField(["equipped", cardKey], null)}>×</button>
                                    </div>
                                  ) : (
                                    <SearchPicker
                                      placeholder={`Card slot ${i + 1}…`}
                                      search={itemSearch("IT_CARD", cardLoc)}
                                      onSelect={(r) => {
                                        setItemCache((prev) => ({ ...prev, [r.id]: { id: r.id, name: r.label } }));
                                        updateField(["equipped", cardKey], r.id);
                                      }}
                                      fetchTooltip={fetchItemTooltip}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {data.server === "payon_stories" && (
            <Panel eyebrow="03" title="Pet">
              <div className="field">
                <label>
                  Active pet
                  <InfoTooltip>
                    Bonuses activate at Cordial (750+ intimacy). ATK/MATK%,
                    ASPD%, resist, and flat-stat bonuses are applied to the
                    calculation. HP drain procs and healing bonuses are noted
                    in the label but not modelled by the engine.
                  </InfoTooltip>
                </label>
                <select
                  value={data.selected_pet ?? ""}
                  onChange={(e) => updateField(["selected_pet"], e.target.value || undefined)}
                >
                  <option value="">None</option>
                  <optgroup label="Payon Stories custom pets">
                    {PS_PETS.filter((p) => p.psCustom).map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Standard pets">
                    {PS_PETS.filter((p) => !p.psCustom).map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </Panel>
          )}
        </div>

        <div>
          <Panel eyebrow="04" title="Passive skills">
            {passiveSkills.length === 0 ? (
              <p style={{ color: "var(--text-muted, #888)", fontSize: "0.875rem" }}>
                {data.job_id ? "No passive skills for this job." : "Select a job to see passive skills."}
              </p>
            ) : (
              <>
              <div className="field-row" style={{ marginBottom: "0.6rem" }}>
                <button
                  onClick={() => setData((prev) => {
                    const next = { ...(prev.mastery_levels || {}) };
                    for (const ps of passiveSkills) next[ps.mastery_key] = ps.max_level;
                    return { ...prev, mastery_levels: next };
                  })}
                >
                  Max all
                </button>
                <button
                  onClick={() => setData((prev) => {
                    const next = { ...(prev.mastery_levels || {}) };
                    for (const ps of passiveSkills) next[ps.mastery_key] = 0;
                    return { ...prev, mastery_levels: next };
                  })}
                >
                  Reset
                </button>
              </div>
              <div className="passive-grid">
                {passiveSkills.map((ps) => (
                  <div className="field" key={ps.name}>
                    <label title={ps.name}>{ps.description}</label>
                    <input
                      className="mono"
                      type="number"
                      min={0}
                      max={ps.max_level}
                      value={(data.mastery_levels || {})[ps.mastery_key] ?? 0}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const lv = Math.max(0, Math.min(ps.max_level, Number(e.target.value)));
                        setData((prev) => ({
                          ...prev,
                          mastery_levels: { ...(prev.mastery_levels || {}), [ps.mastery_key]: lv },
                        }));
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #888)" }}>/ {ps.max_level}</span>
                  </div>
                ))}
              </div>
              </>
            )}
          </Panel>

          <Panel eyebrow="05" title="Consumables">
            <div className="field">
              <label>ASPD potion</label>
              <select
                value={data.consumable_buffs?.aspd_potion ?? 0}
                onChange={(e) => updateConsumable("aspd_potion", Number(e.target.value) || undefined)}
              >
                {ASPD_POTION_LABELS.map((label, i) => (
                  <option key={i} value={i} disabled={i > aspdPotionCap(data.job_id)}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field-row" style={{ marginTop: "0.6rem" }}>
              <div className="field">
                <label>ATK item (flat BATK)</label>
                <input
                  className="mono"
                  type="number"
                  min={0}
                  value={data.consumable_buffs?.atk_item ?? 0}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateConsumable("atk_item", Number(e.target.value) || undefined)}
                />
              </div>
              <div className="field">
                <label>MATK item (flat MATK)</label>
                <input
                  className="mono"
                  type="number"
                  min={0}
                  value={data.consumable_buffs?.matk_item ?? 0}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateConsumable("matk_item", Number(e.target.value) || undefined)}
                />
              </div>
            </div>
          </Panel>

          <Panel eyebrow="06" title="Buffs">
            {(() => {
              const selfBuffs = SELF_BUFFS.filter((b) => (b.jobs as readonly number[]).includes(data.job_id));
              const supportBuffs = (data.support_buffs || {}) as Record<string, unknown>;
              const groundEffectType = (supportBuffs.ground_effect as string) || "";
              // SA_VOLCANO/SA_DELUGE/SA_VIOLENTGALE's vanilla max_level is 5;
              // PS overrides all three to 3 (wiki.payonstories.com/Volcano,
              // /Deluge, /Violent_Gale all show per-level tables stopping at 3
              // despite a "Levels: 5 (Fixed)" label likely inherited from
              // vanilla's max_level field) -- corroborated by PS_VOL_MATK_PCT
              // and PS_ENCHANT_EFF both being 3-element arrays.
              const groundEffectMax = data.server === "payon_stories" ? 3 : 5;
              const endowValue = supportBuffs.SC_ASPERSIO ? "SC_ASPERSIO" : (supportBuffs.weapon_endow_sc as string) || "";
              return (
                <>
                  {selfBuffs.length === 0 ? (
                    <p style={{ color: "var(--text-muted, #888)", fontSize: "0.875rem" }}>
                      {data.job_id ? "No self-cast buffs modeled for this job yet." : "Select a job to see its self buffs."}
                    </p>
                  ) : (
                    <>
                      <div className="buff-section-header">Self buffs</div>
                      <div className="passive-grid">
                        {selfBuffs.map((b) => {
                          const active = (data.active_buffs?.[b.key] ?? 0) > 0;
                          return (
                            <div className="field field-checkbox" key={b.key}>
                              <label title={b.key}>
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={(e) => updateBuffField("active_buffs", b.key, e.target.checked ? b.max : 0)}
                                />
                                <span>{b.label}</span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="buff-section-header">
                    Party buffs
                    <InfoTooltip>
                      Received from a party member, not self-cast — these are never
                      filtered by your own job, since any class can stand in
                      another player's buff range. Checking a buff applies its
                      max level (you don't control the caster's actual level).
                    </InfoTooltip>
                  </div>

                  <div className="buff-group">
                    <span className="buff-group-label">Priest</span>
                    <div className="passive-grid">
                      {PARTY_BUFFS.filter((b) => b.source === "Priest").map((b) => {
                        const current = (data.support_buffs as Record<string, number> | undefined)?.[b.key] ?? 0;
                        return (
                          <div className="field field-checkbox" key={b.key}>
                            <label title={b.key}>
                              <input
                                type="checkbox"
                                checked={current > 0}
                                onChange={(e) => updateBuffField("support_buffs", b.key, e.target.checked ? b.max : 0)}
                              />
                              <span>{b.label}</span>
                            </label>
                          </div>
                        );
                      })}
                      <div className="field">
                        <label title="Priest weapon endow / Aspersio, plus Enchant Poison and Cursed Water">Weapon endow</label>
                        <select value={endowValue} onChange={(e) => updateWeaponEndow(e.target.value)}>
                          <option value="">None</option>
                          <option value="SC_ASPERSIO">Aspersio (Holy)</option>
                          <option value="SC_PROPERTYFIRE">Endow Fire</option>
                          <option value="SC_PROPERTYWATER">Endow Water</option>
                          <option value="SC_PROPERTYWIND">Endow Wind</option>
                          <option value="SC_PROPERTYGROUND">Endow Ground</option>
                          <option value="SC_ENCHANTPOISON">Enchant Poison</option>
                          <option value="SC_ENCHANTARMS">Cursed Water (Shadow)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="buff-group">
                    <span className="buff-group-label">Blacksmith</span>
                    <div className="passive-grid">
                      {PARTY_BUFFS.filter((b) => b.source === "Blacksmith").map((b) => {
                        const current = (data.support_buffs as Record<string, number> | undefined)?.[b.key] ?? 0;
                        return (
                          <div className="field field-checkbox" key={b.key}>
                            <label title={b.key}>
                              <input
                                type="checkbox"
                                checked={current > 0}
                                onChange={(e) => updateBuffField("support_buffs", b.key, e.target.checked ? b.max : 0)}
                              />
                              <span>{b.label}</span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="buff-group">
                    <span className="buff-group-label">Sage</span>
                    <div className="passive-grid">
                      <div className="field">
                        <label title="SA_VOLCANO / SA_DELUGE / SA_VIOLENTGALE — applies max level when selected">Ground effect</label>
                        <select
                          value={groundEffectType}
                          onChange={(e) => updateGroundEffect(e.target.value, groundEffectMax)}
                        >
                          <option value="">None</option>
                          <option value="SC_VOLCANO">Volcano (Fire, +ATK/+MATK)</option>
                          <option value="SC_DELUGE">Deluge (Water, +HP regen)</option>
                          <option value="SC_VIOLENTGALE">Violent Gale (Wind, +Flee/move speed)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="buff-section-header" title="From a party member, never filtered by your own job">Bard / Dancer songs</div>
                  <div className="passive-grid">
                    {SONG_BUFFS.map((b) => (
                      <div className="field" key={b.key}>
                        <label title={b.key}>{b.label}</label>
                        <input
                          className="mono"
                          type="number"
                          min={0}
                          max={b.max}
                          value={data.song_state?.[b.key] ?? 0}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateBuffField("song_state", b.key, Math.max(0, Math.min(b.max, Number(e.target.value))))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="buff-section-header">Clan</div>
                  <div className="passive-grid">
                    <div className="field">
                      <label>Clan membership</label>
                      <select
                        value={data.clan ?? ""}
                        onChange={(e) => updateField(["clan"], e.target.value || undefined)}
                      >
                        <option value="">None</option>
                        <option value="sword_clan">Sword Clan (STR+1, VIT+1)</option>
                        <option value="arch_wand_clan">Arch Wand Clan (INT+1, DEX+1)</option>
                        <option value="golden_mace_clan">Golden Mace Clan (INT+1, VIT+1)</option>
                        <option value="crossbow_clan">Crossbow Clan (DEX+1, AGI+1)</option>
                        <option value="artisan_clan">Artisan Clan (DEX+1, LUK+1)</option>
                        <option value="vile_wind_clan">Vile Wind Clan (STR+1, AGI+1)</option>
                      </select>
                    </div>
                  </div>
                </>
              );
            })()}
          </Panel>

          <Panel eyebrow="07" title="Skill">
            <div className="selected-pill" style={{ marginBottom: "0.6rem" }}>
              <span>{skill.label}{skill.id !== 0 ? ` Lv.${skill.level}` : ""}</span>
              {skill.id !== 0 && (
                <input
                  className="mono"
                  type="number"
                  min={1}
                  max={skill.max_level}
                  style={{ width: 60 }}
                  value={skill.level}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setSkill((s) => ({ ...s, level: Math.max(1, Math.min(s.max_level, Number(e.target.value))) }))}
                />
              )}
            </div>
            <div className="field-row">
              <button onClick={() => setSkill(DEFAULT_SKILL)}>Use normal attack</button>
            </div>
            <div className="field" style={{ marginTop: "0.6rem" }}>
              <label>Or search a skill</label>
              <SearchPicker
                placeholder="Search skills…"
                search={skillSearch}
                onSelect={(r) => setSkill({ id: r.id, level: 1, label: r.label, max_level: r.max_level ?? 10 })}
              />
            </div>
            {skill.id === 212 && data.server === "payon_stories" && (
              <div className="field field-checkbox" style={{ marginTop: "0.5rem" }}>
                <label title="PS Rogue rework: monster not currently targeting the Rogue (PvP: player not facing the Rogue) — grants ×1.4 multiplicative damage bonus">
                  <input
                    type="checkbox"
                    checked={!!(data.support_buffs as Record<string, unknown>)?.backstab_opportunity}
                    onChange={(e) => setData((prev) => {
                      const next: Record<string, unknown> = { ...(prev.support_buffs || {}) };
                      if (e.target.checked) next.backstab_opportunity = true;
                      else delete next.backstab_opportunity;
                      return { ...prev, support_buffs: next };
                    })}
                  />
                  <span>Backstab opportunity (+40%)</span>
                </label>
              </div>
            )}
          </Panel>

          <Panel eyebrow="08" title="Target">
            <div className="tabs">
              <button className={targetMode === "monster" ? "active" : ""} onClick={() => setTargetMode("monster")}>Monster</button>
              <button className={targetMode === "custom" ? "active" : ""} onClick={() => setTargetMode("custom")}>Custom stats</button>
            </div>

            {targetMode === "monster" && (
              <>
                {data.target_mob_id != null ? (
                  <>
                  <div className="selected-pill">
                    <span>
                      {mobInfo ? mobInfo.name : `Mob #${data.target_mob_id}`}
                      {mobInfo ? ` (Lv.${mobInfo.level})` : ""}
                      {mobInfo?.is_boss ? " · Boss" : ""}
                    </span>
                    <button onClick={() => updateField(["target_mob_id"], null)}>Change</button>
                  </div>
                  {mobInfo && (
                    <div className="sec-stat-grid" style={{ marginTop: "0.6rem" }}>
                      {([
                        { label: "HP",      value: mobInfo.hp?.toLocaleString() },
                        { label: "Race",    value: mobInfo.race },
                        { label: "Element", value: mobInfo.element != null ? `${ELEMENT_NAMES[mobInfo.element] ?? mobInfo.element} ${mobInfo.element_level ?? 1}` : undefined },
                        { label: "Size",    value: mobInfo.size },
                        { label: "DEF",     value: mobInfo.def_ != null ? String(mobInfo.def_) : undefined },
                        { label: "MDEF",    value: mobInfo.mdef != null ? String(mobInfo.mdef) : undefined },
                        { label: "ATK",     value: (mobInfo.atk_min != null && mobInfo.atk_max != null) ? `${mobInfo.atk_min}–${mobInfo.atk_max}` : undefined },
                        { label: "STR",     value: mobInfo.stats ? String(mobInfo.stats.str) : undefined },
                        { label: "AGI",     value: mobInfo.stats ? String(mobInfo.stats.agi) : undefined },
                        { label: "VIT",     value: mobInfo.stats ? String(mobInfo.stats.vit) : undefined },
                        { label: "INT",     value: mobInfo.stats ? String(mobInfo.stats.int) : undefined },
                        { label: "DEX",     value: mobInfo.stats ? String(mobInfo.stats.dex) : undefined },
                        { label: "LUK",     value: mobInfo.stats ? String(mobInfo.stats.luk) : undefined },
                      ] as { label: string; value?: string }[]).map(({ label, value }) => (
                        <div key={label} className="sec-stat-card">
                          <div className="sec-stat-label">{label}</div>
                          <div className="sec-stat-value">{value ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  </>
                ) : (
                  <SearchPicker placeholder="Search monsters…" search={mobSearch} onSelect={(r) => updateField(["target_mob_id"], r.id)} />
                )}
              </>
            )}

            {targetMode === "custom" && (
              <>
                <div className="field-row">
                  <div className="field">
                    <label>DEF</label>
                    <input className="mono" type="number" value={customTarget.def_} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, def_: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>MDEF</label>
                    <input className="mono" type="number" value={customTarget.mdef_} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, mdef_: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>VIT</label>
                    <input className="mono" type="number" value={customTarget.vit} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, vit: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Level</label>
                    <input className="mono" type="number" value={customTarget.level} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, level: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>AGI</label>
                    <input className="mono" type="number" value={customTarget.agi} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, agi: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>LUK</label>
                    <input className="mono" type="number" value={customTarget.luk} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, luk: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Size</label>
                    <select value={customTarget.size} onChange={(e) => setCustomTarget((t) => ({ ...t, size: e.target.value }))}>
                      <option>Small</option><option>Medium</option><option>Large</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Race</label>
                    <select value={customTarget.race} onChange={(e) => setCustomTarget((t) => ({ ...t, race: e.target.value }))}>
                      {["Formless", "Undead", "Brute", "Plant", "Insect", "Fish", "Demon", "Demi-Human", "Angel", "Dragon"].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Element</label>
                    <select className="mono" value={customTarget.element} onChange={(e) => setCustomTarget((t) => ({ ...t, element: Number(e.target.value) }))}>
                      {ELEMENT_NAMES.map((name, idx) => (
                        <option key={idx} value={idx}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Element level</label>
                    <input className="mono" type="number" min={1} max={4} value={customTarget.element_level} onFocus={(e) => e.target.select()} onChange={(e) => setCustomTarget((t) => ({ ...t, element_level: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>Boss?</label>
                    <select value={customTarget.is_boss ? "yes" : "no"} onChange={(e) => setCustomTarget((t) => ({ ...t, is_boss: e.target.value === "yes" }))}>
                      <option value="no">No</option><option value="yes">Yes</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Target debuffs */}
            <div className="buff-section-header" style={{ marginTop: "1rem" }}>
              Target debuffs
              <InfoTooltip>
                Debuffs applied to the target before the damage calculation.
                Element status overrides the target&apos;s element and may trigger mechanic effects
                (Frozen/Stone Curse halve hard DEF and grant auto-hit).
                Lex Aeterna doubles all damage results.
                Skill debuffs and statuses apply their game mechanics to the target.
              </InfoTooltip>
            </div>

            <div className="field">
              <label title="Override target element; Frozen and Stone Curse also halve hard DEF and grant auto-hit">
                Element status
              </label>
              <select value={targetMods.element_status} onChange={(e) => setTargetMods((m) => ({ ...m, element_status: e.target.value }))}>
                <option value="">None</option>
                <option value="Poison">Poisoned (→ Poison element)</option>
                <option value="Frozen">Frozen (→ Water, −50% hard DEF, auto-hit)</option>
                <option value="Stone">Stone Curse (→ Earth, −50% hard DEF, auto-hit)</option>
              </select>
            </div>

            <div className="field field-checkbox" style={{ marginTop: "0.4rem" }}>
              <label title="SC_LEXAETERNA: next hit deals ×2 damage. Applied to all damage branches.">
                <input type="checkbox" checked={targetMods.lex_aeterna} onChange={(e) => setTargetMods((m) => ({ ...m, lex_aeterna: e.target.checked }))} />
                <span>Lex Aeterna (×2 damage)</span>
              </label>
            </div>

            <span className="buff-group-label" style={{ display: "block", marginTop: "0.75rem" }}>Debuff skills &amp; statuses</span>
            <div className="field field-checkbox">
              <label title="WZ_QUAGMIRE: removes flee from target — all physical attacks auto-hit">
                <input type="checkbox" checked={targetMods.quagmire} onChange={(e) => setTargetMods((m) => ({ ...m, quagmire: e.target.checked }))} />
                <span>Quagmire (auto-hit)</span>
              </label>
            </div>
            <div className="field field-checkbox">
              <label title={signumApplicable ? "PR_SIGNUM Lv10: hard DEF −35% (5 + 3×lv). Undead / Demon only." : "PR_SIGNUM only applies to Undead and Demon targets"} style={!signumApplicable ? { opacity: 0.4, cursor: "not-allowed" } : undefined}>
                <input type="checkbox" checked={targetMods.signum_crucis} disabled={!signumApplicable} onChange={(e) => setTargetMods((m) => ({ ...m, signum_crucis: e.target.checked }))} />
                <span>Signum Crucis Lv10 (−35% hard DEF)</span>
              </label>
            </div>
            <div className="field field-checkbox">
              <label title="SC_PROVOKE Lv10: target DEF −55% (5 + 5×lv). No effect on Boss monsters. Independent of the player's own Auto Berserk self-buff.">
                <input type="checkbox" checked={targetMods.provoke} onChange={(e) => setTargetMods((m) => ({ ...m, provoke: e.target.checked }))} />
                <span>Provoke Lv10 (−55% DEF)</span>
              </label>
            </div>
            <div className="field field-checkbox">
              <label title="SC_SLEEP: target cannot evade (auto-hit) and crit rate is doubled">
                <input type="checkbox" checked={targetMods.sleep} onChange={(e) => setTargetMods((m) => ({ ...m, sleep: e.target.checked }))} />
                <span>Asleep (auto-hit, ×2 crit rate)</span>
              </label>
            </div>
            <div className="field field-checkbox">
              <label title="SC_STUN: target cannot evade (auto-hit)">
                <input type="checkbox" checked={targetMods.stun} onChange={(e) => setTargetMods((m) => ({ ...m, stun: e.target.checked }))} />
                <span>Stunned (auto-hit)</span>
              </label>
            </div>
          </Panel>

        </div>
      </div>
      </div>

      <footer className="credits-footer">
        <div className="credits-support">
          <a className="kofi-btn" href="https://ko-fi.com/I7A322JOTP" target="_blank" rel="noreferrer">
            🍵 Buy me a milk tea
          </a>
          <span className="credits-support-text">This calc runs on milk tea</span>
        </div>
        <div className="credits-row">
          <span>Thanks to our testers:&nbsp;<span className="credits-names">Metan, hokageyyy, leafhill, knightzeroxx, kerfuffl, jenardpwet</span></span>
          <span className="credits-sep">·</span>
          <span>Base engine by&nbsp;<span className="credits-names">tochoco.latte</span></span>
          <span className="credits-sep">·</span>
          <a className="credits-link" href="https://discord.gg/payonstories" target="_blank" rel="noreferrer">Discord</a>
          <span className="credits-sep">·</span>
          <a className="credits-link" href="https://cp.payonstories.com/" target="_blank" rel="noreferrer">PS Website</a>
        </div>
      </footer>
    </div>
  );
}

