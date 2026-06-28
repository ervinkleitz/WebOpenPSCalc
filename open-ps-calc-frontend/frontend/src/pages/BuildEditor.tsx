import { useEffect, useCallback, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import SearchPicker from "../components/SearchPicker";
import Panel from "../components/Panel";
import InfoTooltip from "../components/InfoTooltip";
import ChangelogModal from "../components/ChangelogModal";
import ResultsModal from "../components/ResultsModal";
import SavedBuildsModal from "../components/SavedBuildsModal";
import {
  BuildData, SkillState, CustomTarget, TargetMode,
  UrlEditorState, SearchResult, PassiveSkill, EquippedItemInfo, ConsumableBuffs,
} from "../types";

const STATS = ["str", "agi", "vit", "int", "dex", "luk"] as const;
// statusCalculator.js / dataLoader.js's getJobBonusStats reads from the
// same keys it writes to status.{str_,agi,vit,int_,dex,luk} -- str/int get
// a trailing underscore there to dodge the JS reserved-ish "int" naming.
const STAT_TO_BONUS_KEY: Record<typeof STATS[number], string> = {
  str: "str_", agi: "agi", vit: "vit", int: "int_", dex: "dex", luk: "luk",
};
const BASE_LEVEL_CAP = 99;
const MAX_STAT = 99;

// Pre-renewal job level caps, derived from job_db.json's job list (28 jobs,
// no baby classes in this dataset): Novice 10, 1st job 50, regular 2nd job
// 50, Super Novice 99, trans 2nd job 70. Gunslinger/Ninja are classic kRO's
// "extended" classes (job level 60 there), but wiki.payonstories.com/
// Gunslinger references planning around "JobLv70 gunslinger", so this PS
// instance appears to have retuned them to the trans cap instead.
const TRANS_JOB_IDS = new Set([4008, 4009, 4010, 4011, 4012, 4013, 4015, 4016, 4017, 4018, 4019, 4020, 4021]);
// Novice + 1st job + Super Novice: Concentration Potion only (can't use Awakening/Berserk)
const NOVICE_OR_1ST_JOB_IDS = new Set([0, 1, 2, 3, 4, 5, 6, 23]);
const JOB_LEVEL_CAP_OVERRIDES: Record<number, number> = { 0: 10, 23: 99, 24: 70, 25: 70 };
function getJobLevelCap(jobId: number): number {
  if (TRANS_JOB_IDS.has(jobId)) return 70;
  return JOB_LEVEL_CAP_OVERRIDES[jobId] ?? 50;
}
// Returns the highest ASPD potion index allowed for a job (1=Conc, 2=Awak, 3=Berserk).
// 0 (no job selected) → no restriction so the form isn't locked before a class is chosen.
function aspdPotionCap(jobId: number): number {
  if (!jobId) return 3;
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
  { key: "armor", label: "Armor", itemType: "IT_ARMOR", loc: "EQP_ARMOR" },
  { key: "garment", label: "Garment", itemType: "IT_ARMOR", loc: "EQP_GARMENT" },
  { key: "shoes", label: "Shoes", itemType: "IT_ARMOR", loc: "EQP_SHOES" },
  { key: "accessory_left", label: "Accessory (left)", itemType: "IT_ARMOR", loc: "EQP_ACC" },
  { key: "accessory_right", label: "Accessory (right)", itemType: "IT_ARMOR", loc: "EQP_ACC" },
  { key: "ammo", label: "Ammo", itemType: "IT_AMMO" },
] as const;

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
  // Knight / Lord Knight
  { key: "SC_TWOHANDQUICKEN",  label: "Two-Hand Quicken",      max: 10, jobs: [7, 4008] },
  { key: "SC_ONEHANDQUICKEN",  label: "One-Hand Quicken",      max: 10, jobs: [7, 4008] },
  // Crusader / Paladin
  { key: "SC_SPEARQUICKEN",    label: "Spear Quicken",         max: 10, jobs: [14, 4015] },
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

const DEFAULT_SKILL: SkillState = { id: 0, level: 1, label: "Normal Attack" };

const DEFAULT_CUSTOM_TARGET: CustomTarget = {
  def_: 0, mdef_: 0, vit: 1, level: 1, size: "Medium", race: "Formless",
  element: 0, element_level: 1, is_boss: false, luk: 0, agi: 0, int_: 0,
};

function encodeState(state: UrlEditorState): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

function decodeState(encoded: string): UrlEditorState | null {
  try {
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
  const [skill, setSkill] = useState<SkillState>(initialState?.skill ?? DEFAULT_SKILL);
  const [targetMode, setTargetMode] = useState<TargetMode>(initialState?.targetMode ?? "monster");
  const [customTarget, setCustomTarget] = useState<CustomTarget>(initialState?.customTarget ?? DEFAULT_CUSTOM_TARGET);

  const [jobs, setJobs] = useState<{ id: number; name: string }[]>([]);
  const [passiveSkills, setPassiveSkills] = useState<PassiveSkill[]>([]);
  const [itemCache, setItemCache] = useState<Record<number, EquippedItemInfo>>({});
  const [mobInfo, setMobInfo] = useState<{ name: string; level: number } | null>(null);
  const [jobBonusStats, setJobBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });
  const [equipBonusStats, setEquipBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });
  const [buffBonusStats, setBuffBonusStats] = useState<Record<string, number>>({ str_: 0, agi: 0, vit: 0, int_: 0, dex: 0, luk: 0 });

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

  const [calcResult, setCalcResult] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState("");
  const [copied, setCopied] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [savedBuildsOpen, setSavedBuildsOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);

  useEffect(() => { api.listJobs().then(setJobs).catch(() => {}); }, []);

  // Keep URL in sync with editor state (debounced 400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      const state: UrlEditorState = { build: data, skill, targetMode, customTarget };
      setSearchParams({ b: encodeState(state) }, { replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [data, skill, targetMode, customTarget]);

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

  const updateField = useCallback((path: string[], value: unknown) => {
    setData((prev) => {
      const next = structuredClone(prev) as any;
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return next;
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

  async function onCalculate() {
    setCalculating(true);
    setCalcError("");
    setResultsOpen(true);
    try {
      const target = targetMode === "monster"
        ? { mob_id: data.target_mob_id }
        : customTarget;
      const normalPayload = { build: sanitizedBuild, skill: { id: 0, level: 1 }, target };
      const skillPayload  = { build: sanitizedBuild, skill: { id: skill.id, level: skill.level }, target };
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
    }
  }

  function onNewBuild() {
    if (!window.confirm("Start over? Any unsaved changes will be lost (save it first from Save / Load if you want to keep it).")) return;
    setData(DEFAULT_BUILD);
    setSkill(DEFAULT_SKILL);
    setTargetMode("monster");
    setCustomTarget(DEFAULT_CUSTOM_TARGET);
    setCalcResult(null);
    setCalcError("");
    setResultsOpen(false);
  }

  function onLoadSavedState(state: UrlEditorState) {
    setData(state.build);
    setSkill(state.skill);
    setTargetMode(state.targetMode);
    setCustomTarget(state.customTarget);
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
    (itemType: string, loc?: string) => (query: string): Promise<SearchResult[]> =>
      api.searchItems({ type: itemType, ...(loc ? { loc } : {}), q: query, limit: 20, server: data.server })
        .then((r) => sortResults(r.items.map((it: any) => ({
          id: it.id, label: itemLabel(it), sublabel: `#${it.id}`, disabled: !canEquip(it),
        })))),
    [data.server, data.job_id, canEquip],
  );

  const leftHandSearch = useCallback(
    (query: string): Promise<SearchResult[]> =>
      Promise.all([
        api.searchItems({ type: "IT_ARMOR", loc: "EQP_SHIELD", q: query, limit: 20, server: data.server }),
        api.searchItems({ type: "IT_WEAPON", q: query, limit: 20, server: data.server }),
      ]).then(([shields, weapons]) => sortResults([
        ...shields.items.map((it: any) => ({ id: it.id, label: itemLabel(it), sublabel: `Shield #${it.id}`, disabled: !canEquip(it) })),
        ...weapons.items.map((it: any) => ({ id: it.id, label: itemLabel(it), sublabel: `Weapon #${it.id}`, disabled: !canEquip(it) })),
      ])),
    [data.server, data.job_id, canEquip],
  );

  const mobSearch = useCallback(
    (query: string): Promise<SearchResult[]> =>
      api.searchMobs({ q: query, limit: 12, server: data.server })
        .then((r) => r.items.map((m: any) => ({ id: m.id, label: m.name, sublabel: `Lv${m.level}` }))),
    [data.server],
  );

  const skillSearch = useCallback(
    (query: string): Promise<SearchResult[]> =>
      api.searchSkills({ q: query, limit: 12, server: data.server })
        .then((r) => r.items.map((s: any) => ({ id: s.id, label: s.display_name || s.name || `Skill ${s.id}`, sublabel: s.name }))),
    [data.server],
  );

  const currentEditorState: UrlEditorState = { build: data, skill, targetMode, customTarget };

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-left">
          <span className="brand-mark">⚔</span>
          <span className="brand-title">Open PS Damage Calc</span>
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
        </div>
        <div className="topbar-right">
          <select
            className="topbar-server-select"
            value={data.server}
            onChange={(e) => updateField(["server"], e.target.value)}
            aria-label="Server"
          >
            <option value="payon_stories">Payon Stories</option>
            <option value="standard">Standard pre-renewal</option>
          </select>
          <button onClick={onNewBuild}>Start over</button>
          <button onClick={() => setSavedBuildsOpen(true)}>Save / Load</button>
          <button onClick={() => setChangelogOpen(true)}>Changelog</button>
          <button onClick={onCopyLink}>{copied ? "Copied!" : "Copy share link"}</button>

          <button className="primary" onClick={onCalculate} disabled={calculating}>
            {calculating ? "Calculating…" : "Calculate damage"}
          </button>
        </div>
      </div>

      <div className="page">
        <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        <SavedBuildsModal
          open={savedBuildsOpen}
          onClose={() => setSavedBuildsOpen(false)}
          currentName={data.name}
          currentState={currentEditorState}
          onLoad={onLoadSavedState}
        />
        <ResultsModal
          open={resultsOpen}
          onClose={() => setResultsOpen(false)}
          calcResult={calcResult}
          calculating={calculating}
          error={calcError}
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
            </label>
            <div className="ro-stat-grid">
              {STATS.map((s) => {
                const jobBonus = jobBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const equipBonus = equipBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const buffBonus = buffBonusStats[STAT_TO_BONUS_KEY[s]] ?? 0;
                const base = data.base_stats[s] ?? 1;
                return (
                  <div className="ro-stat-card" key={s}>
                    <div className="ro-stat-name">{s.toUpperCase()}</div>
                    <div className="ro-stat-total">{base + jobBonus + equipBonus + buffBonus}</div>
                    <div className="ro-stat-detail">
                      <input
                        className="mono"
                        type="number"
                        min={1}
                        max={MAX_STAT}
                        value={base}
                        onChange={(e) => updateField(["base_stats", s], Math.max(1, Math.min(MAX_STAT, Number(e.target.value))))}
                      />
                      {jobBonus > 0 && <span className="ro-stat-bonus" title={`+${jobBonus} from job level`}>+{jobBonus}</span>}
                      {equipBonus > 0 && <span className="ro-stat-bonus ro-stat-bonus--equip" title={`+${equipBonus} from equipment`}>+{equipBonus}</span>}
                      {buffBonus > 0 && <span className="ro-stat-bonus ro-stat-bonus--buff" title={`+${buffBonus} from skills / buffs`}>+{buffBonus}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel eyebrow="02" title="Equipment">
            <div className="equip-grid">
              {EQUIP_SLOTS.map((slot) => {
                const equippedId = data.equipped[slot.key] as number | null | undefined;
                const item = equippedId != null ? itemCache[equippedId] : null;
                const cardSlotCount = item?.slots ?? 0;
                const isRefineable = item?.refineable ?? false;
                const isInvalid = invalidSlots.has(slot.key);
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
                      />
                    )}
                    {isRefineable && equippedId != null && (
                      <input
                        className="mono"
                        type="number"
                        min={0}
                        max={20}
                        style={{ marginTop: "0.4rem" }}
                        value={data.refine[slot.key] || 0}
                        onChange={(e) => updateField(["refine", slot.key], Number(e.target.value))}
                        title="Refine level"
                      />
                    )}
                    {cardSlotCount > 0 && (
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
                                  search={itemSearch("IT_CARD")}
                                  onSelect={(r) => {
                                    setItemCache((prev) => ({ ...prev, [r.id]: { id: r.id, name: r.label } }));
                                    updateField(["equipped", cardKey], r.id);
                                  }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
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
                  max={10}
                  style={{ width: 60 }}
                  value={skill.level}
                  onChange={(e) => setSkill((s) => ({ ...s, level: Number(e.target.value) }))}
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
                onSelect={(r) => setSkill({ id: r.id, level: 1, label: r.label })}
              />
            </div>
          </Panel>

          <Panel eyebrow="08" title="Target">
            <div className="tabs">
              <button className={targetMode === "monster" ? "active" : ""} onClick={() => setTargetMode("monster")}>Monster</button>
              <button className={targetMode === "custom" ? "active" : ""} onClick={() => setTargetMode("custom")}>Custom stats</button>
            </div>

            {targetMode === "monster" && (
              <>
                {data.target_mob_id != null ? (
                  <div className="selected-pill">
                    <span>
                      {mobInfo ? mobInfo.name : `Mob #${data.target_mob_id}`}
                      {mobInfo ? ` (Lv.${mobInfo.level})` : ""}
                    </span>
                    <button onClick={() => updateField(["target_mob_id"], null)}>Change</button>
                  </div>
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
                    <input className="mono" type="number" value={customTarget.def_} onChange={(e) => setCustomTarget((t) => ({ ...t, def_: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>MDEF</label>
                    <input className="mono" type="number" value={customTarget.mdef_} onChange={(e) => setCustomTarget((t) => ({ ...t, mdef_: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>VIT</label>
                    <input className="mono" type="number" value={customTarget.vit} onChange={(e) => setCustomTarget((t) => ({ ...t, vit: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Level</label>
                    <input className="mono" type="number" value={customTarget.level} onChange={(e) => setCustomTarget((t) => ({ ...t, level: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>AGI</label>
                    <input className="mono" type="number" value={customTarget.agi} onChange={(e) => setCustomTarget((t) => ({ ...t, agi: Number(e.target.value) }))} />
                  </div>
                  <div className="field">
                    <label>LUK</label>
                    <input className="mono" type="number" value={customTarget.luk} onChange={(e) => setCustomTarget((t) => ({ ...t, luk: Number(e.target.value) }))} />
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
                      {["Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Dark", "Ghost", "Undead"].map((name, idx) => (
                        <option key={idx} value={idx}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Element level</label>
                    <input className="mono" type="number" min={1} max={4} value={customTarget.element_level} onChange={(e) => setCustomTarget((t) => ({ ...t, element_level: Number(e.target.value) }))} />
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
          </Panel>

        </div>
      </div>
      </div>
    </div>
  );
}

