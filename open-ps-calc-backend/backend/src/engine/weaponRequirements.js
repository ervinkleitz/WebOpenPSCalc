/**
 * weaponRequirements.js — "can this weapon actually cast this skill?"
 *
 * The skill DB has carried `requirements.weapon_types` all along (123 skills use
 * it) and nothing read it, so the calculator happily priced Double Strafe with a
 * sword, Pierce with a sword and Sonic Blow with a sword — numbers for characters
 * that cannot exist, with no warning. Found in the 2026-09-24 QA sweep.
 *
 * Two vocabularies have to meet here. The skill DB names weapon classes in the
 * plural ("Bows", "Daggers", "Instruments"); item records and the engine's weapon
 * object use the singular item type ("Bow", "Knife", "MusicalInstrument"). The map
 * below is the whole translation, built from the 24 distinct values the skill DB
 * actually uses against the 22 the item DB actually produces.
 *
 * Anything unmapped is treated as NO OPINION rather than a violation: a warning
 * that fires on a legal build is worse than no warning at all, and the same sweep
 * flagged the existing "PS unaudited" notice for exactly that.
 *
 * The long lists are not noise. Bash and Asura Strike name 22 weapon classes each
 * and both leave Bows out, which is Hercules' real rule — melee skills are not
 * castable with a bow. That matters for a Rogue, who can plagiarise Bash and hold a
 * bow at the same time. So a list is read as written; only an empty list means
 * "no restriction".
 */

// Skill-DB requirement name -> the item weapon_type(s) that satisfy it.
const REQUIREMENT_TO_WEAPON_TYPE = {
  NoWeapon: ["Unarmed"],
  Daggers: ["Knife"],
  "1HSwords": ["1HSword"],
  "2HSwords": ["2HSword"],
  "1HSpears": ["1HSpear"],
  "2HSpears": ["2HSpear"],
  "1HAxes": ["1HAxe"],
  "2HAxes": ["2HAxe"],
  Maces: ["Mace"],
  // No pre-renewal item is typed 2HMace; the requirement exists in the DB but
  // nothing can satisfy it, so it contributes nothing rather than blocking.
  "2HMaces": [],
  Staves: ["Staff"],
  "2HStaves": ["2HStaff"],
  Knuckles: ["Knuckle"],
  Instruments: ["MusicalInstrument"],
  Whips: ["Whip"],
  Books: ["Book"],
  Katars: ["Katar"],
  Bows: ["Bow"],
  Revolvers: ["Revolver"],
  Rifles: ["Rifle"],
  GatlingGuns: ["Gatling"],
  Shotguns: ["Shotgun"],
  GrenadeLaunchers: ["Grenade"],
  FuumaShurikens: ["Fuuma"],
};

/**
 * The item weapon_types that can cast `skillData`, or null when we have no opinion:
 * a missing record, an empty list (the DB's way of saying "any weapon"), or a list
 * containing a name this map cannot translate.
 */
function allowedWeaponTypes(skillData) {
  const req = skillData && skillData.requirements && skillData.requirements.weapon_types;
  if (!Array.isArray(req) || req.length === 0) return null;
  const allowed = [];
  let unknown = false;
  for (const name of req) {
    const mapped = REQUIREMENT_TO_WEAPON_TYPE[name];
    if (mapped === undefined) { unknown = true; continue; }
    for (const t of mapped) if (!allowed.includes(t)) allowed.push(t);
  }
  // A name we cannot translate means the list is not fully understood — stay quiet.
  if (unknown || allowed.length === 0) return null;
  return allowed;
}

/**
 * `null` when the skill is castable with this weapon (or states no restriction),
 * otherwise { allowed, have } describing the mismatch.
 */
function weaponRequirementViolation(skillData, weaponType) {
  const allowed = allowedWeaponTypes(skillData);
  if (!allowed) return null;
  const have = weaponType || "Unarmed";
  if (allowed.includes(have)) return null;
  return { allowed, have };
}

// Player-facing wording, shared by the damage breakdown and the editor's notice.
const WEAPON_TYPE_LABEL = {
  Unarmed: "bare hands", Knife: "a Dagger", "1HSword": "a One-Handed Sword",
  "2HSword": "a Two-Handed Sword", "1HSpear": "a One-Handed Spear", "2HSpear": "a Two-Handed Spear",
  "1HAxe": "a One-Handed Axe", "2HAxe": "a Two-Handed Axe", Mace: "a Mace",
  Staff: "a Staff", "2HStaff": "a Two-Handed Staff", Knuckle: "Knuckles",
  MusicalInstrument: "an Instrument", Whip: "a Whip", Book: "a Book", Katar: "a Katar",
  Bow: "a Bow", Revolver: "a Revolver", Rifle: "a Rifle", Gatling: "a Gatling Gun",
  Shotgun: "a Shotgun", Grenade: "a Grenade Launcher", Fuuma: "a Fuuma Shuriken",
};

const describeWeapon = (t) => WEAPON_TYPE_LABEL[t] || t;

/**
 * A short list reads best as what the skill NEEDS ("needs a Bow"); a long one is
 * really an exclusion (Bash allows 21 weapon classes and bars bows), and spelling
 * all 21 out is unreadable — so that case names what you are holding instead.
 */
function describeViolation(v) {
  const have = describeWeapon(v.have);
  const needs = describeRequirement(v.allowed);
  if (!needs) return `This skill cannot be used with ${have}.`;
  return `This skill needs ${needs}; you are holding ${have}.`;
}

/**
 * "a Bow", "a One-Handed Spear or a Two-Handed Spear", or null for a list too long
 * to read out (see describeViolation). Exported so the editor can say the same thing
 * the breakdown does without carrying its own copy of the vocabulary.
 */
function describeRequirement(allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.length > 3) return null;
  return allowed.map(describeWeapon).join(" or ");
}

module.exports = {
  REQUIREMENT_TO_WEAPON_TYPE,
  allowedWeaponTypes,
  weaponRequirementViolation,
  describeViolation,
  describeRequirement,
  describeWeapon,
};
