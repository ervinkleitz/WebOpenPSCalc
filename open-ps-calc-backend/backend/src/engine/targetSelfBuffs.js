/**
 * targetSelfBuffs.js — buffs a MONSTER casts on itself, applied to the target.
 *
 * A monster's own kit is already in the DB (`loader.getMobSkills`), including the
 * self-cast entries with the level and rate it uses them at — a Scout carries
 * `AC_CONCENTRATION lv10, target=self, rate=20%`. This turns the supported ones into
 * something the target panel can toggle, so a player does not have to work out the
 * stat change by hand and enter a custom monster.
 *
 * ALWAYS-ON, by design. The monster casts these on a rate with a duration; ticking one
 * applies it permanently. That is an upper bound on the monster, i.e. a lower bound on
 * your damage — the same fiction as the "Proc cards: Always" toggle, and the UI says so.
 *
 * Only buffs whose effect is sourced and expressible on our target model are marked
 * `modelled`. The rest are still LISTED, with the reason, rather than silently missing:
 * a buff we quietly ignore looks identical to a buff that does nothing.
 */
const { loader } = require("./dataLoader");
const { ELE_STR_TO_INT } = require("./bonusDefinitions");

// Every NPC_CHANGE* skill starts SC_ARMOR_PROPERTY, and status_calc_element returns that
// SC's val2 as the unit's defensive element (status.c:6092) — val2 being the SKILL's own
// element (skill.c:9004-9016). So the element to switch to is the skill's, read from the
// skill DB rather than hardcoded per skill. The element LEVEL is untouched:
// status_calc_element_lv has no SC_ARMOR_PROPERTY branch, so the monster keeps its own.
const ELEMENT_CHANGE_SKILLS = new Set([
  "NPC_CHANGEWATER", "NPC_CHANGEGROUND", "NPC_CHANGEFIRE", "NPC_CHANGEWIND",
  "NPC_CHANGEPOISON", "NPC_CHANGEHOLY", "NPC_CHANGEDARKNESS", "NPC_CHANGETELEKINESIS",
]);

function skillElementInt(skillName) {
  const sd = loader.getSkillByName(skillName);
  const ele = sd && Array.isArray(sd.element) ? sd.element[0] : null;
  const v = ele != null ? ELE_STR_TO_INT[String(ele)] : null;
  return Number.isFinite(v) ? v : null;
}

const SELF_BUFFS = {
  // SC_CONCENTRATION, val2 = 2 + lv, applied as a PERCENTAGE of the unit's AGI and DEX
  // (status.c status_calc_agi/dex). A monster has no equipment, so it is the whole stat —
  // unlike the player-side copy in statusCalculator.js, which excludes card AGI/DEX.
  AC_CONCENTRATION: {
    label: "Improve Concentration",
    modelled: true,
    describe: (lv) => `AGI and DEX +${2 + lv}% (raises its FLEE and HIT)`,
    apply(target, lv) {
      const pct = 2 + lv;
      const agiGain = Math.floor(target.agi * pct / 100);
      const dexGain = Math.floor(target.dex * pct / 100);
      target.agi += agiGain;
      target.dex += dexGain;
      if (target.flee > 0) target.flee += agiGain;
      if (target.hit > 0) target.hit += dexGain;
    },
    // The same buff on the RAW mob record, for the incoming direction. The DEX half is
    // the one that matters there: a monster's HIT is level + DEX, so Concentration makes
    // it land on you more often. Its damage per hit is unchanged — mob ATK comes from the
    // mob DB, not from its stats.
    applyRaw(stats, lv) {
      const pct = 2 + lv;
      stats.agi += Math.floor(stats.agi * pct / 100);
      stats.dex += Math.floor(stats.dex * pct / 100);
    },
  },
  // SC_INC_AGI, val2 = 2 + lv, a FLAT AGI gain (status.c:7855, 4091).
  AL_INCAGI: {
    label: "Increase AGI",
    modelled: true,
    describe: (lv) => `AGI +${2 + lv} (raises its FLEE)`,
    apply(target, lv) {
      const gain = 2 + lv;
      target.agi += gain;
      if (target.flee > 0) target.flee += gain;
    },
    applyRaw(stats, lv) { stats.agi += 2 + lv; },
  },
  // SC_INCFLEERATE at val1 = 100 for every level (skill.c:9170-9173), and
  // status_calc_flee reads it as `flee += flee * val1 / 100` (status.c:5065) — so the
  // monster's FLEE doubles. It is a flee-rate effect, not an AGI change, so AGI is
  // untouched and the level does not matter.
  NPC_AGIUP: {
    label: "Agi Up",
    modelled: true,
    describe: () => "FLEE x2 (a flee-rate buff, so its AGI is unchanged)",
    apply(target) {
      if (target.flee > 0) target.flee = Math.floor(target.flee * 2);
    },
  },
  // NPC_STONESKIN / NPC_ANTIMAGIC share SC_STONESKIN, which Hercules gives a FLAT
  // +-20 x level to DEF and MDEF in opposite directions (status.c:8820-8830, 5176, 5322).
  // At the levels monsters actually carry (up to 5) that is +-100, i.e. effectively
  // immune — a big enough claim that it should be confirmed on Payon Stories before the
  // calculator starts reporting it. Listed, not applied.
  NPC_STONESKIN: {
    label: "Stone Skin",
    modelled: false,
    reason: "not modelled yet — two readings of it differ by an order of magnitude. Hercules adds a FLAT +20 DEF per level, which at the levels monsters cast would put Beelzebub and Nidhoggr's Shadow past 100 DEF, i.e. 1 damage a hit; its own code says the official version is a DEF PERCENTAGE instead, which would be +20%/level. Needs one in-game reading before the calculator claims either.",
  },
  NPC_ANTIMAGIC: {
    label: "Anti-Magic",
    modelled: false,
    reason: "not modelled yet — the same status as Stone Skin with the signs swapped (MDEF up, DEF down), so it carries the same flat-vs-percentage ambiguity.",
  },
  // Random element on cast, so there is no deterministic element to switch to.
  NPC_ATTRICHANGE: {
    label: "Attribute Change",
    modelled: false,
    reason: "not modelled yet — it changes the monster's element to a RANDOM one, so there is nothing fixed to apply. Use the element-change toggles if you know what it rolled.",
  },
};

for (const name of ELEMENT_CHANGE_SKILLS) {
  SELF_BUFFS[name] = {
    label: (loader.getSkillByName(name) || {}).description || name,
    modelled: true,
    describe: () => {
      const ele = skillElementInt(name);
      return `defensive element becomes ${loader.getElementName(ele) || "?"} (its element LEVEL is unchanged)`;
    },
    apply(target) {
      const ele = skillElementInt(name);
      if (ele != null) target.element = ele;
    },
  };
}

/** Metadata for one self-cast skill, for the API to hand the UI. Null when it isn't a buff. */
function describeSelfBuff(skillName, level) {
  const spec = SELF_BUFFS[skillName];
  if (!spec) return null;
  return {
    label: spec.label,
    modelled: !!spec.modelled,
    effect: spec.modelled ? spec.describe(Number(level) || 1) : null,
    reason: spec.modelled ? null : spec.reason,
  };
}

/**
 * `buffs` is { SKILL_CONSTANT: level }. Unknown or unmodelled entries are ignored, so a
 * stale share URL cannot turn on something we have since decided we cannot price.
 * Applied BEFORE the player's debuffs: the monster buffs itself, then you cut it down.
 */
function applyTargetSelfBuffs(target, buffs) {
  if (!buffs || typeof buffs !== "object") return [];
  const applied = [];
  for (const [name, lv] of Object.entries(buffs)) {
    const spec = SELF_BUFFS[name];
    if (!spec || !spec.modelled || !lv) continue;
    spec.apply(target, Number(lv) || 1);
    applied.push(name);
  }
  return applied;
}

/**
 * The same buffs against the RAW mob record (`loader.getMonsterData` shape, stats nested
 * under `.stats`) for the INCOMING direction, where the monster is the attacker. Returns
 * a new object, leaving the caller's untouched.
 *
 * Only what changes the monster's offence is applied, which is why this is not simply the
 * same function: its FLEE and its defensive ELEMENT are meaningless when it is the one
 * swinging (its basic melee is Neutral regardless of its own property — incomingPipeline
 * documents that), so Agi Up and the element changes deliberately do nothing here.
 */
function applySelfBuffsToRawMob(mob, buffs) {
  if (!mob || !buffs || typeof buffs !== "object") return mob;
  let stats = null;
  for (const [name, lv] of Object.entries(buffs)) {
    const spec = SELF_BUFFS[name];
    if (!spec || !spec.modelled || !lv || !spec.applyRaw) continue;
    if (stats == null) stats = { ...(mob.stats || {}) };
    spec.applyRaw(stats, Number(lv) || 1);
  }
  return stats == null ? mob : { ...mob, stats };
}

module.exports = { SELF_BUFFS, applyTargetSelfBuffs, applySelfBuffsToRawMob, describeSelfBuff };
