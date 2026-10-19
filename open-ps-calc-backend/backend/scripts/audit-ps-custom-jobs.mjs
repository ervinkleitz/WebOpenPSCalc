/**
 * audit-ps-custom-jobs.mjs — check every PS-custom skill's job list against the wiki.
 *
 *   node scripts/audit-ps-custom-jobs.mjs            # audit all, print findings
 *   node scripts/audit-ps-custom-jobs.mjs --json     # machine-readable report only
 *   node scripts/audit-ps-custom-jobs.mjs --limit 3  # smoke test
 *
 * WHY THIS EXISTS: `ps_custom_constants.json` carries a hand-written `job` array per
 * PS-custom skill, and it is the ONLY source of truth for who can take that skill —
 * those skills are absent from the vanilla `skill_tree.conf` we scrape, so nothing
 * else in the repo can contradict a wrong list. Two have been wrong so far, both for
 * Super Novice (Crazy Uproar 2026-08-18, Tool Mastery 2026-08-30), both because a
 * rework PDF frames a skill as belonging to the class it reworks. A wrong list is
 * silent in both directions: a class that should see the skill does not, or one that
 * should not is offered a passive it cannot learn, which then prices damage.
 *
 * HOW: each skill's wiki page carries `Category:<Class>` links. Those are read and
 * expanded down the class tree — a skill categorised under Merchant is usable by
 * Blacksmith, Alchemist and their transcendent forms, which is why Tool Mastery's
 * six-job array is correct against a wiki page that names only two classes. The
 * comparison is therefore between EXPANDED SETS, not between the raw lists.
 *
 * It reports, it does not edit. A diff here is a question for a person: the wiki can
 * lag a patch, and a category can be missing rather than wrong.
 *
 * Polite by construction: sequential, 250ms apart, same UA as scrape-ps-cooldowns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS = path.join(HERE, "../src/engine/data/ps/ps_custom_constants.json");
const SKILL_DB = path.join(HERE, "../src/engine/data/ps/ps_skill_db.json");
const OUT = path.join(HERE, "ps-custom-jobs-report.json");
const UA = "Mozilla/5.0 (compatible; OpenPSCalc/1.0; +https://openpscalc.com)";
const DELAY_MS = 250;

const args = process.argv.slice(2);
const jsonOnly = args.includes("--json");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

// The class tree, as job ids. A skill a class can take is also takeable by everything
// below it — that is what makes a two-category wiki page agree with a six-job array.
// Super Novice, Gunslinger and Ninja inherit from nobody.
const CHILDREN = {
  1: [7, 14], 7: [4008], 14: [4015],          // Swordsman → Knight / Crusader
  2: [9, 16], 9: [4010], 16: [4017],          // Magician  → Wizard / Sage
  3: [11, 19, 20], 11: [4012], 19: [4020], 20: [4021], // Archer → Hunter / Bard / Dancer
  4: [8, 15], 8: [4009], 15: [4016],          // Acolyte   → Priest / Monk
  5: [10, 18], 10: [4011], 18: [4019],        // Merchant  → Blacksmith / Alchemist
  6: [12, 17], 12: [4013], 17: [4018],        // Thief     → Assassin / Rogue
};
const CLASS_IDS = {
  Novice: 0, Swordsman: 1, Swordman: 1, Magician: 2, Mage: 2, Archer: 3, Acolyte: 4,
  Merchant: 5, Thief: 6, Knight: 7, Priest: 8, Wizard: 9, Blacksmith: 10, Hunter: 11,
  Assassin: 12, Crusader: 14, Monk: 15, Sage: 16, Rogue: 17, Alchemist: 18, Bard: 19,
  Dancer: 20, Super_Novice: 23, Gunslinger: 24, Ninja: 25,
  Lord_Knight: 4008, High_Priest: 4009, High_Wizard: 4010, Whitesmith: 4011,
  Sniper: 4012, Assassin_Cross: 4013, Paladin: 4015, Champion: 4016, Professor: 4017,
  Stalker: 4018, Creator: 4019, Clown: 4020, Gypsy: 4021,
};
const NAME_OF = Object.fromEntries(
  Object.entries(CLASS_IDS).map(([k, v]) => [v, k]).reverse(),
);

const descendants = (id, acc = new Set()) => {
  acc.add(id);
  for (const c of CHILDREN[id] || []) descendants(c, acc);
  return acc;
};
const expand = (ids) => {
  const out = new Set();
  for (const id of ids) for (const d of descendants(id)) out.add(d);
  return out;
};
const show = (ids) => [...ids].sort((a, b) => a - b)
  .map((i) => `${NAME_OF[i] ?? "?"}(${i})`).join(", ") || "none";

const constants = JSON.parse(fs.readFileSync(CONSTANTS, "utf8"));
const rawDb = JSON.parse(fs.readFileSync(SKILL_DB, "utf8"));
const recs = Array.isArray(rawDb) ? rawDb : (rawDb.skills || Object.values(rawDb));
const nameOfConstant = {};
for (const r of recs) if (r && r.constant) nameOfConstant[r.constant] = r.name;
// ps_skill_db has no name for a few constants, which would leave them unchecked.
// Where the page title is known, say so rather than skipping the skill: Tool Mastery
// is one of the two that have actually been wrong, so it is the last one that should
// go unaudited.
const PAGE_OVERRIDE = {
  PS_MC_TOOLMASTERY: "Tool_Mastery",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function categoriesFor(pageName) {
  const url = `https://wiki.payonstories.com/${encodeURIComponent(pageName)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return { ok: false, status: res.status, url };
  const html = await res.text();
  // A page that does not exist still returns 200 with MediaWiki's "noarticletext".
  const missing = /noarticletext/.test(html);
  // A removed skill keeps its page, its navbox and its class Category, so without
  // this it reads as "the wiki says Rogue, we say nobody" — which is backwards.
  // Ambushing is the live example: "Note : This skill has been removed".
  const removed = /This skill has been removed/i.test(html.replace(/<[^>]+>/g, " "));
  const found = new Set();
  for (const m of html.matchAll(/Category:([A-Za-z_0-9]+)/g)) {
    const id = CLASS_IDS[m[1]];
    if (id !== undefined) found.add(id);
  }
  return { ok: true, missing, removed, url, classes: found };
}

const findings = [];
let n = 0;
for (const [itemId, entry] of Object.entries(constants)) {
  if (n >= limit) break;
  n++;
  const constant = entry.constant;
  const label = nameOfConstant[constant] || (PAGE_OVERRIDE[constant] || "").replace(/_/g, " ") || undefined;
  const ours = expand(entry.job || []);
  const row = { id: itemId, constant, name: label ?? null, ours_raw: entry.job || [] };

  if (!label) {
    row.status = "no-name";
    row.note = "no name in ps_skill_db.json, so no wiki page can be resolved";
    findings.push(row);
    if (!jsonOnly) console.log(`?   ${constant.padEnd(26)} no name in ps_skill_db — cannot resolve a wiki page`);
    continue;
  }

  const page = label.replace(/'/g, "'").replace(/ /g, "_");
  const r = await categoriesFor(page);
  await sleep(DELAY_MS);
  row.page = r.url;

  if (!r.ok) { row.status = "fetch-failed"; row.note = `HTTP ${r.status}`; findings.push(row);
    if (!jsonOnly) console.log(`?   ${constant.padEnd(26)} HTTP ${r.status} for ${page}`); continue; }
  if (r.missing) { row.status = "no-page"; findings.push(row);
    if (!jsonOnly) console.log(`?   ${constant.padEnd(26)} no wiki page at ${page}`); continue; }
  if (r.classes.size === 0) { row.status = "no-class-category"; findings.push(row);
    if (!jsonOnly) console.log(`?   ${constant.padEnd(26)} page has no class Category`); continue; }
  if (r.removed) {
    // Removed on PS: an empty job array is the CORRECT answer, and a populated one
    // is the finding.
    row.status = ours.size === 0 ? "removed-ok" : "removed-but-listed";
    row.note = "the wiki page says this skill has been removed";
    findings.push(row);
    if (!jsonOnly) {
      console.log(ours.size === 0
        ? `ok  ${constant.padEnd(26)} removed on PS, and we offer it to nobody`
        : `!!  ${constant.padEnd(26)} removed on PS, but we still offer it to ${show(ours)}`);
    }
    continue;
  }

  const theirs = expand(r.classes);
  const weOmit = [...theirs].filter((i) => !ours.has(i));
  const weAdd = [...ours].filter((i) => !theirs.has(i));
  row.wiki_raw = [...r.classes].sort((a, b) => a - b);
  row.missing_from_ours = weOmit.sort((a, b) => a - b);
  row.extra_in_ours = weAdd.sort((a, b) => a - b);
  row.status = weOmit.length === 0 && weAdd.length === 0 ? "match" : "differs";
  findings.push(row);

  if (!jsonOnly) {
    if (row.status === "match") {
      console.log(`ok  ${constant.padEnd(26)} ${show(ours)}`);
    } else {
      console.log(`!!  ${constant.padEnd(26)} ${label}`);
      console.log(`      wiki says : ${show(theirs)}`);
      console.log(`      we say    : ${show(ours)}`);
      if (weOmit.length) console.log(`      MISSING   : ${show(weOmit)}`);
      if (weAdd.length) console.log(`      EXTRA     : ${show(weAdd)}`);
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  _note: "Generated by scripts/audit-ps-custom-jobs.mjs. A 'differs' row is a question "
    + "for a person, not a bug: the wiki can lag a patch, and a category can be missing "
    + "rather than wrong. Check the page before editing ps_custom_constants.json.",
  _generated: new Date().toISOString().slice(0, 10),
  findings,
}, null, 1) + "\n");

const differs = findings.filter((f) => ["differs", "removed-but-listed"].includes(f.status));
const matched = findings.filter((f) => ["match", "removed-ok"].includes(f.status));
const unchecked = findings.filter((f) => !["match", "removed-ok", "differs", "removed-but-listed"].includes(f.status));
if (!jsonOnly) {
  console.log(`\n${findings.length} skills: ${matched.length} match, `
    + `${differs.length} differ, ${unchecked.length} could not be checked`);
  console.log(`report: ${path.relative(process.cwd(), OUT)}`);
}
process.exit(0);
