/**
 * psToolsImport.js — read a skill build out of a tools.payonstories.com/skill link.
 *
 * Players plan their skill tree in PS's own tool and then want those levels here
 * without re-entering them. The whole build travels in the URL, so nothing is ever
 * fetched from their site:
 *
 *     https://tools.payonstories.com/skill?state=eJxdk71u3TAMhd...
 *     -> URL-decode -> base64 -> zlib inflate -> JSON
 *     -> { "job": "Swordsman", "levels": { "SM_BASH": 9, "SM_TWOHAND": 10, ... } }
 *
 * Two things make this a cleaner source than the fan tools: it is first-party, and
 * because the state is self-contained there is no asset to scrape and nothing to go
 * stale behind our back.
 *
 * WHAT COMES BACK IS NOT A WHOLE BUILD. The link carries a job and skill levels and
 * nothing else — no stats, no gear. So this importer is a MERGE, unlike the jaludev
 * one that replaces everything: the caller keeps the player's equipment and stats and
 * only takes the job and the skill levels.
 */
const zlib = require("zlib");
const { loader } = require("./dataLoader");

/**
 * PS tools names a handful of PS-custom skills differently from us. The numeric id
 * is the same on both sides, so this table was DERIVED by walking their skill-tree
 * chunk and matching `skid` against our own ids rather than by eye — the id is in
 * the trailing comment so a future check can repeat it.
 *
 * Their side is mostly the raw Hercules-style constant; ours prefixes PS customs with
 * `PS_` and sometimes files them under the class that actually gets them (Resource
 * Roundup is `AM_` for them, `PS_BS_` here).
 */
const CONSTANT_ALIASES = {
  // Tool Mastery is NOT a new skill on PS: they repurposed Overcharge in place, so
  // it is still id 38 / MC_OVERCHARGE. Their tree labels it "Overcharge / Tools
  // Mastery" and their UI renders it "Tool Mastery" -- Passive, "Increases damage
  // inflicted with Axe and Mace class weapons", +4 damage a level, which is our
  // Tool Mastery exactly. We model it as a synthetic PS_MC_TOOLMASTERY at 2637
  // because it arrived via ps_skill_desc_overrides rather than the scrape, so the
  // ids do not line up and this alias is the bridge.
  //
  // Missing it meant a Merchant-line import reported Tool Mastery as "not used by
  // any damage formula here" -- which is false, we price it at 4 ATK a level. Found
  // when the maintainer pointed at the skill sitting in their planner (2026-09-26).
  MC_OVERCHARGE: "PS_MC_TOOLMASTERY",          // 38    Overcharge / Tools Mastery
  AM_DETONATOR: "PS_AM_REMOTEDETONATOR",       // 2613  Remote Detonator
  AM_HERBICIDE: "PS_AM_HERBICIDE",             // 2614  Herbicide
  AC_SCATTERING: "PS_AC_SCATTERING",           // 2615  Scattering
  SA_GEMEXTRACT: "PS_SA_GEMSTONEEXTRACTION",   // 2618  Gemstone Extraction
  AM_RESOURCE: "PS_BS_RESOURCEROUNDUP",        // 2619  Resource Roundup
  NV_SOULFRAG: "PS_SN_SOULHARVEST",            // 2621  Soul Harvest
  AL_HOLYSTRIKE: "PS_PR_HOLYSTRIKE",           // 2622  Holy Strike
  NJ_SHADOW_WITHIN: "PS_NJ_SHADOWSWITHIN",     // 2626  Shadow's Within
  MC_ZENYPINCHER: "PS_BS_ZENYPINCHER",         // 2627  Zeny Pincher
  RG_TRICKARROW: "PS_RG_TRICKARROW",           // 2631  Trick Arrow
  SN_TACTICALDEPLOY: "PS_HT_FLIGHTPATTERN",    // 2632  Flight Pattern
  RG_QUICKSTEP: "PS_RG_QUICKSTEP",             // 2633  Quick Step
  ST_WEAKNESSEXPLOIT: "PS_RG_WEAKNESSEXPLOIT", // 2635  Weakness Exploit
  RG_BLACKMARKET: "PS_RG_STOLENGOODS",         // 2636  Stolen Goods
  // SM_TWOHAND needs no alias — it is "Blade Mastery" on both sides — but it IS
  // stored here under the mastery key SM_TWOHANDSWORD. passivePanelIndex below
  // reads that pairing off the panel rather than restating it.
};

/** Pull the compressed state out of whatever the player pasted. */
function extractState(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Paste a Payon Stories skill link.");
  // `state` can sit in the query or the hash depending on how the link was copied;
  // and a player may paste just the blob.
  const m = /[?&#]state=([^&\s]+)/.exec(raw);
  const blob = m ? m[1] : (/^[A-Za-z0-9%+/=_-]+$/.test(raw) ? raw : null);
  if (!blob) {
    throw new Error("That does not look like a Payon Stories skill link — it should contain `state=`.");
  }
  return blob;
}

/** state blob -> { job, levels }. Throws with a player-readable message. */
function decodePsToolsSkillUrl(input) {
  const blob = extractState(input);
  let json;
  try {
    const bytes = Buffer.from(decodeURIComponent(blob), "base64");
    json = JSON.parse(zlib.inflateSync(bytes).toString("utf8"));
  } catch {
    throw new Error("Could not read that link — it may be truncated. Copy the whole URL from the address bar.");
  }
  if (!json || typeof json !== "object" || typeof json.job !== "string" || typeof json.levels !== "object") {
    throw new Error("That link does not carry a skill build.");
  }
  return { job: json.job, levels: normaliseLevels(json.levels) };
}

/**
 * PS's planner emits `levels` in MORE THAN ONE SHAPE, and the difference is invisible
 * until you count what came through.
 *
 *   object  { "AL_DEMONBANE": 5, "AL_HEAL": 10, ... }
 *   array   [ { "AL_DEMONBANE": 5 }, { "AL_HEAL": 10 }, ... ]
 *
 * Both are `typeof === "object"`, so the guard above passes either way. But
 * Object.entries() on the array form yields ["0", {AL_DEMONBANE: 5}] — the key is the
 * index and the value is an object — so every level reads as NaN, every skill is
 * skipped as unallocated, and the import reports "none of these affect damage here"
 * while quietly holding a full tree.
 *
 * Reported by the maintainer 2026-10-05: three links from the same planner session,
 * two in the object form (which worked) and one in the array form (which silently
 * imported nothing). Flattening here means the rest of the importer only ever sees a
 * plain map.
 */
function normaliseLevels(levels) {
  if (!levels || typeof levels !== "object") return {};
  if (!Array.isArray(levels)) return levels;
  const out = {};
  for (const item of levels) {
    if (!item || typeof item !== "object") continue;
    for (const [constant, level] of Object.entries(item)) {
      // A list of {name, level} pairs would be a third shape; it is not one PS has
      // been seen to emit, and guessing at it would risk inventing skills. Only the
      // {CONSTANT: level} form is accepted, and anything else is left out rather
      // than mis-read.
      if (typeof constant === "string" && Number.isFinite(Number(level))) out[constant] = Number(level);
    }
  }
  return out;
}

/**
 * Status changes whose source skill the skill DB does not declare, so they cannot be
 * resolved from `status_change` alone. Kept tiny and explicit rather than guessed.
 *
 * Two self-buffs in the editor have no learnable source on a 2nd job and are
 * deliberately absent:
 *   SC_AMPLIFYMAGICPOWER — a High Wizard skill (maintainer ruling, 2026-09-22), and
 *     this calculator models base and 2nd jobs only.
 *   SC_PS_ZENYPINCHER — a PS-custom passive; it arrives through mastery_levels, not
 *     as a rank you pick when toggling a buff.
 */
const SC_SOURCE_SKILL = {
  // Our synthetic "self-cast" variant of SC_ADRENALINE. The DB declares
  // BS_ADRENALINE -> SC_ADRENALINE; the editor splits the self-cast case out so a
  // Blacksmith's own Adrenaline Rush is separable from a party member's.
  SC_ADRENALINE_SELF: "BS_ADRENALINE",
};

/**
 * Our mastery_levels map is keyed by MASTERY KEY, which is the skill constant for
 * almost everything but differs where PS merged two skills (SM_TWOHAND is stored as
 * SM_TWOHANDSWORD, the Blade Mastery key). The passive panel is the authority on
 * that pairing, so read it from there rather than duplicating the rule.
 */
function passivePanelIndex(jobId) {
  const byConstant = new Map();
  for (const entry of loader.getPassiveSkillsForJob(jobId) || []) {
    byConstant.set(entry.name, entry);
  }
  return byConstant;
}

/** Display name for a constant we know of but do not offer in the passive panel. */
function skillLabel(constant, profile) {
  try {
    const name = loader.getSkillDisplayName(constant, profile);
    return name && name !== constant ? name : constant;
  } catch {
    return constant;
  }
}

/**
 * Decode a PS tools skill link into the job and the skill levels this calculator
 * models. Returns what it applied and what it could not, so the editor can say so
 * rather than quietly dropping half the build.
 */
function importPsToolsSkills(input, profile = null) {
  const { job, levels } = decodePsToolsSkillUrl(input);

  const jobEntry = (loader.getAllJobs() || []).find((j) => j.name === job);
  if (!jobEntry) {
    // Baby classes, 3rd jobs, Taekwon/Soul Linker/Summoner and the rest. Name the
    // class rather than failing blankly — the player picked it deliberately.
    throw new Error(`This calculator does not model ${String(job).replace(/_/g, " ")} builds.`);
  }

  const panel = passivePanelIndex(jobEntry.id);
  const masteryLevels = {};
  // EVERY skill on this character's tree that they put points in, keyed by our
  // constant. mastery_levels only carries the passives the bonus engine reads, which
  // is a small slice: handing the importer a full tree applies 4 of a Knight's 28 and
  // 1 of a Ninja's 30. The rest are not junk — 92 of them are skills this calculator
  // already prices as the SELECTED skill, and 37 drive self-buffs it models through
  // active_status_levels. What was missing was anywhere to put the LEVEL.
  //
  // So this is the player's spellbook: what they know and at what rank. It does NOT
  // turn anything on. Importing a tree says what you have learned, not what you are
  // currently buffed with, and auto-enabling 37 self-buffs would quietly inflate
  // everyone's damage the moment they imported. The editor uses these as the level a
  // skill takes when YOU pick it or switch it on.
  const knownSkillLevels = {};
  // The same ranks again, keyed by STATUS CHANGE, for the editor's self-buff
  // toggles. Two-Hand Quicken, Adrenaline Rush, Providence, Energy Coat and the rest
  // are switched on by SC key, so without this the toggle has no idea the character
  // only has the skill at rank 3 and starts it at the buff's max.
  //
  // Same rule as the spellbook above: this records the rank a buff WOULD run at, it
  // does not switch anything on.
  const knownBuffLevels = {};
  const applied = [];
  // Two very different reasons to skip something, and a player cares about only one
  // of them. Their planner hands every class the whole platinum skill list at Lv1, so
  // most of what arrives is simply not this character's - that is noise and a count is
  // plenty. A skill the character REALLY has, that we do not price, is worth naming:
  // it is the difference between "the import worked" and "where did my Provoke go".
  const notModelled = [];
  let offTree = 0;

  for (const [theirConstant, rawLevel] of Object.entries(levels)) {
    const level = Math.max(0, Number(rawLevel) || 0);
    if (level <= 0) continue; // unallocated
    const ourConstant = CONSTANT_ALIASES[theirConstant] || theirConstant;

    // Record the rank before deciding whether a passive slot exists for it, and cap
    // it at what the skill can actually reach here — their planner hands out the
    // whole platinum list, and a stale link can carry a rank PS has since lowered.
    const known = loader.getSkillByName(ourConstant);
    if (known) {
      const onTree = loader.filterMasteryLevelsForJob(jobEntry.id, { [ourConstant]: level });
      if (!onTree.dropped.length) {
        const capped = Math.min(level, known.max_level || level);
        knownSkillLevels[ourConstant] = capped;
        for (const sc of [].concat(known.status_change || [])) {
          if (sc) knownBuffLevels[sc] = capped;
        }
      }
    }

    const entry = panel.get(ourConstant);
    if (!entry) {
      // Is it on this job's tree at all? filterMasteryLevelsForJob is the same check
      // the engine uses to strip a stale share link, so the two cannot disagree.
      const { dropped } = loader.filterMasteryLevelsForJob(jobEntry.id, { [ourConstant]: level });
      if (dropped.length) offTree++;
      else notModelled.push({ constant: ourConstant, display: skillLabel(ourConstant, profile), level });
      continue;
    }
    const capped = Math.min(level, entry.max_level || level);
    masteryLevels[entry.mastery_key] = capped;
    applied.push({
      constant: ourConstant,
      display: entry.description || ourConstant,
      level: capped,
      ...(capped !== level ? { requested: level } : {}),
    });
  }

  const byName = (a, b) => a.display.localeCompare(b.display);
  applied.sort(byName);
  notModelled.sort(byName);
  return {
    job_id: jobEntry.id,
    job_name: jobEntry.name,
    mastery_levels: masteryLevels,
    // What the character knows, for the skill picker and the buff toggles.
    known_skill_levels: knownSkillLevels,
    known_buff_levels: (() => {
      // Fold in the handful of SCs the DB does not attribute to a skill.
      const out = { ...knownBuffLevels };
      for (const [sc, constant] of Object.entries(SC_SOURCE_SKILL)) {
        if (knownSkillLevels[constant] != null) out[sc] = knownSkillLevels[constant];
      }
      return out;
    })(),
    applied,
    // Skills this character really has that no damage formula here reads.
    not_modelled: notModelled,
    // Everything their planner hands out that this class cannot learn.
    off_tree_count: offTree,
    // What was in the link at all, for when nothing lands. "None of the skills in
    // that link affect damage here" is true but useless on its own: it cannot tell
    // an empty tree from a job mismatch from a skill we failed to map. Reported by
    // the maintainer 2026-10-05 after an import of a Priest tree with Demon Bane in
    // it came back with nothing applied.
    link_summary: {
      // Skills with at least one point, before any of our filtering.
      allocated: Object.values(levels).filter((v) => Number(v) > 0).length,
      // Their constants, so a mismatch against ours is visible at a glance.
      sample: Object.entries(levels)
        .filter(([, v]) => Number(v) > 0)
        .slice(0, 12)
        .map(([k, v]) => `${k} Lv${v}`),
    },
    // What was in the link at all, for when nothing lands. "None of the skills in
    // that link affect damage here" is true but useless on its own: it cannot tell
    // an empty tree from a job mismatch from a skill we failed to map. Reported by
    // the maintainer 2026-10-05 after an import of a Priest tree with Demon Bane in
    // it came back with nothing applied.
    link_summary: {
      // Skills with at least one point, before any of our filtering.
      allocated: Object.values(levels).filter((v) => Number(v) > 0).length,
      // Their constants, so a mismatch against ours is visible at a glance.
      sample: Object.entries(levels)
        .filter(([, v]) => Number(v) > 0)
        .slice(0, 12)
        .map(([k, v]) => `${k} Lv${v}`),
    },
  };
}

module.exports = { importPsToolsSkills, decodePsToolsSkillUrl, normaliseLevels, CONSTANT_ALIASES, SC_SOURCE_SKILL };
