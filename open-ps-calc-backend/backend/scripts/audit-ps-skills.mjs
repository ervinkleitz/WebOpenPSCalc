/**
 * audit-ps-skills.mjs — compare our bundled Payon Stories skill data against their
 * LIVE skill planner, and report only what is NEW since the last accepted run.
 *
 *   node scripts/audit-ps-skills.mjs            # report drift
 *   node scripts/audit-ps-skills.mjs --accept   # fold findings into the baseline
 *   node scripts/audit-ps-skills.mjs --refresh  # also rewrite ps_skill_db.json
 *
 * Exit code 1 when there are findings not already in the baseline, so a scheduled
 * run fails loudly instead of printing into the void.
 *
 * WHY THIS EXISTS
 * ---------------
 * ps_skill_db.json is a point-in-time scrape, and the engine's skill numbers are
 * tuned against it by hand (serverProfiles' mastery_per_level, ratio overrides, cast
 * tables...). So a Payon Stories rework is invisible here until a player notices.
 * That is exactly how Spear Mastery was caught: the maintainer pointed at the
 * planner's tooltip, which reads "Damage +5 / Mounted Damage +7" per level, while
 * the description we served beside our (correct) numbers was still vanilla's
 * "+4 per level ... the bonus damage increased by 1 per level". Checking the whole
 * skill list on a schedule finds that class of drift without a player having to.
 *
 * WHERE THE LIVE DATA COMES FROM
 * ------------------------------
 * The planner is JS-rendered with no API, but everything is in two of the page's
 * chunks, which are discovered from the HTML because their names carry a build hash:
 *
 *   TOOLTIPS  "<skid>":["<name>","Max Level: N","Skill Form: ...","Description: ...",
 *             " ","[Lv 1]:^777777 <effect> ^000000", ...]
 *   TREE      {"skid":55,"id":"KN_SPEARMASTERY","name":"Spear Mastery","job":"Crusader",
 *             "max":10,...}
 *
 * The tree chunk is what maps a numeric skid onto the constant we key skills by.
 * Their chunk is JavaScript, not JSON — description strings contain \' sequences that
 * are valid JS and invalid JSON — so both are read with regexes against the literal
 * source rather than parsed. ^RRGGBB colour codes are stripped.
 *
 * WHAT IT CHECKS, per skill we already know about
 * -----------------------------------------------
 *   NAME     their display name vs ours
 *   MAXLV    their max level vs ours
 *   DESC     their description prose vs ours
 *   EFFECT   their per-level effect text vs ours, level by level. This is the pass
 *            that catches a rework: the numbers the engine computes are tuned to
 *            this text, so when it moves, something in serverProfiles probably has
 *            to move with it.
 *   NEW      a skill the planner has and we do not (an import that would be dropped)
 *
 * It does NOT fail on skills we deliberately do not model (trans/3rd class): those
 * are reported under NEW once and then live in the baseline.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ORIGIN = "https://tools.payonstories.com";
const UA = "Mozilla/5.0 (compatible; WebOpenPSCalc/1.0; +https://github.com/ervinkleitz/WebOpenPSCalc)";

const PS_DB = path.join(HERE, "../src/engine/data/ps/ps_skill_db.json");
const BASELINE = path.join(HERE, "../src/engine/data/ps/ps_skill_audit_baseline.json");
const REPORT = path.join(HERE, "ps-skill-audit-report.json");

const ACCEPT = process.argv.includes("--accept");
const REFRESH = process.argv.includes("--refresh");

/** Strip PS's ^RRGGBB colour codes and tidy whitespace. */
export function clean(s) {
  return String(s ?? "")
    .replace(/\^[0-9a-fA-F]{6}/g, "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull `"<skid>":[ "...", "..." ]` tooltip blocks out of the chunk source.
 * Returns { skid: [line, line, ...] }.
 */
export function parseTooltips(js) {
  const out = {};
  // Match an id key followed by an array of double-quoted strings. Escapes inside
  // the strings are honoured so a \" does not end the match early.
  const re = /"(\d{1,4})":\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)+)\]/g;
  for (const m of js.matchAll(re)) {
    const parts = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((p) => clean(p[1]));
    if (parts.length < 2) continue;
    out[m[1]] = parts;
  }
  return out;
}

/** Pull the skill-tree records that map skid -> constant. */
export function parseTree(js) {
  const out = {};
  const re = /\{"skid":(\d{1,4}),"id":"([A-Z0-9_]+)","name":"((?:[^"\\]|\\.)*)"[^}]*?"max":(\d+)/g;
  for (const m of js.matchAll(re)) {
    out[m[1]] = { constant: m[2], name: clean(m[3]), max: Number(m[4]) };
  }
  return out;
}

/** A tooltip block -> the fields we store. */
export function shapeTooltip(lines) {
  const name = lines[0];
  let maxLevel = null, skillForm = null;
  const descParts = [];
  const levels = [];
  let inDesc = false;
  for (const raw of lines.slice(1)) {
    const line = clean(raw);
    if (!line) continue;
    let m;
    if ((m = line.match(/^Max Level:\s*(\d+)$/))) { maxLevel = Number(m[1]); inDesc = false; continue; }
    if ((m = line.match(/^Skill Form:\s*(.+)$/))) { skillForm = m[1].trim(); inDesc = false; continue; }
    if ((m = line.match(/^Description:\s*(.*)$/))) { descParts.push(m[1]); inDesc = true; continue; }
    if ((m = line.match(/^\[Lv\s*(\d+)\]:\s*(.*)$/))) { levels.push({ level: Number(m[1]), effect: m[2].trim() }); inDesc = false; continue; }
    // Their description wraps across several array entries.
    if (inDesc) descParts.push(line);
  }
  return {
    name,
    max_level: maxLevel,
    skill_form: skillForm,
    description: clean(descParts.join(" ")),
    levels,
  };
}

async function get(url, accept) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept } });
  if (!res.ok) throw new Error(`${url} -> http ${res.status}`);
  return res.text();
}

async function fetchLive() {
  const html = await get(ORIGIN + "/skill", "text/html");
  const bd = html.match(/"buildDate":"([^"]+)"/);
  const version = bd ? bd[1] : null;

  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/pages\/skill~[A-Za-z0-9~_-]+\.js/g)].map((m) => m[0]))];
  if (!chunks.length) throw new Error("no skill chunk referenced by the page — their build layout changed");

  let tooltips = {}, tree = {};
  for (const c of chunks) {
    const js = await get(ORIGIN + c, "application/javascript");
    Object.assign(tooltips, parseTooltips(js));
    Object.assign(tree, parseTree(js));
  }
  // Abort rather than report "everything vanished" if their layout moved. An empty
  // parse must never look like PS deleting their skill list — that is the failure
  // mode the item audit's empty-drop-set guard exists for.
  if (Object.keys(tree).length < 200) {
    throw new Error(`only ${Object.keys(tree).length} skill-tree records parsed — their chunk format changed; fix the parser before trusting this run`);
  }
  if (Object.keys(tooltips).length < 200) {
    throw new Error(`only ${Object.keys(tooltips).length} tooltips parsed — their chunk format changed`);
  }

  const live = {};
  for (const [skid, meta] of Object.entries(tree)) {
    const tip = tooltips[skid];
    live[meta.constant] = {
      id: Number(skid),
      ...(tip ? shapeTooltip(tip) : { name: meta.name, max_level: meta.max, levels: [] }),
      constant: meta.constant,
    };
  }
  return { version, live, counts: { tree: Object.keys(tree).length, tooltips: Object.keys(tooltips).length } };
}

const OVERRIDES = path.join(HERE, "../src/engine/data/ps/ps_skill_desc_overrides.json");

function ourSkills() {
  const raw = JSON.parse(fs.readFileSync(PS_DB, "utf8"));
  const out = {};
  for (const rec of Object.values(raw)) if (rec && rec.constant) out[rec.constant] = rec;
  // Apply ps_skill_desc_overrides exactly as dataLoader._loadPsSkillDb does, or the
  // audit re-reports every correction we have already made by hand -- Spear
  // Boomerang's scraped "Sonic Wave", Blade Mastery, Tool Mastery. What we want to
  // see is drift we have NOT handled.
  if (fs.existsSync(OVERRIDES)) {
    const ov = JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
    for (const [constant, patch] of Object.entries(ov)) {
      if (constant.startsWith("_comment")) continue;
      out[constant] = out[constant] ? { ...out[constant], ...patch } : patch;
    }
  }
  return { raw, byConstant: out };
}

function diff(ours, live) {
  const findings = [];
  const push = (kind, constant, field, oursVal, liveVal) =>
    findings.push({ kind, constant, field, ours: oursVal ?? null, live: liveVal ?? null });

  for (const [constant, l] of Object.entries(live)) {
    const o = ours[constant];
    if (!o) { push("NEW", constant, "-", null, l.name); continue; }
    if (l.name && o.name && clean(l.name) !== clean(o.name)) push("NAME", constant, "name", o.name, l.name);
    if (l.max_level != null && o.max_level != null && l.max_level !== o.max_level)
      push("MAXLV", constant, "max_level", o.max_level, l.max_level);
    if (l.description && clean(l.description) !== clean(o.description || ""))
      push("DESC", constant, "description", o.description || null, l.description);

    const ourLv = new Map((Array.isArray(o.levels) ? o.levels : []).map((x) => [x.level, clean(x.effect)]));
    for (const lv of l.levels) {
      const mine = ourLv.get(lv.level);
      if (mine === undefined) push("EFFECT", constant, `Lv${lv.level} (missing)`, null, lv.effect);
      else if (mine !== clean(lv.effect)) push("EFFECT", constant, `Lv${lv.level}`, mine, lv.effect);
    }
  }
  return findings;
}

const key = (f) => `${f.kind}|${f.constant}|${f.field}|${f.live}`;

(async () => {
  const { version, live, counts } = await fetchLive();
  const { raw, byConstant } = ourSkills();
  const findings = diff(byConstant, live);

  const baseline = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : { _comment: "Accepted PS skill-audit findings. Regenerate with: npm run ps:audit-skills:accept", version: null, accepted: [] };
  const accepted = new Set((baseline.accepted || []).map((f) => (typeof f === "string" ? f : key(f))));
  const fresh = findings.filter((f) => !accepted.has(key(f)));

  const byKind = {};
  for (const f of fresh) (byKind[f.kind] ||= []).push(f);

  console.log(`PS skill planner version: ${version} (ours: ${baseline.version ?? "unrecorded"})`);
  console.log(`parsed ${counts.tree} tree records, ${counts.tooltips} tooltips; we know ${Object.keys(byConstant).length} skills`);
  console.log(`${findings.length} findings, ${fresh.length} not in the baseline\n`);

  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`--- ${kind} (${list.length}) ---`);
    for (const f of list.slice(0, 40)) {
      console.log(`  ${f.constant} ${f.field}`);
      if (f.kind !== "NEW") {
        console.log(`      ours: ${String(f.ours).slice(0, 110)}`);
        console.log(`      live: ${String(f.live).slice(0, 110)}`);
      }
    }
    if (list.length > 40) console.log(`  … and ${list.length - 40} more (see the report)`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ version, generated: new Date().toISOString(), counts, findings }, null, 2));
  console.log(`\nreport: ${path.relative(process.cwd(), REPORT)}`);

  if (REFRESH) {
    const next = { ...raw };
    for (const rec of Object.values(next)) {
      const l = rec && rec.constant ? live[rec.constant] : null;
      if (!l) continue;
      rec.name = l.name ?? rec.name;
      rec.max_level = l.max_level ?? rec.max_level;
      rec.skill_form = l.skill_form ?? rec.skill_form;
      rec.description = l.description ?? rec.description;
      if (l.levels && l.levels.length) rec.levels = l.levels;
    }
    fs.writeFileSync(PS_DB, JSON.stringify(next, null, 2));
    console.log("ps_skill_db.json refreshed from the live planner");
  }

  if (ACCEPT) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      _comment: "Accepted PS skill-audit findings. Regenerate with: npm run ps:audit-skills:accept",
      version, accepted: findings.map(key),
    }, null, 2));
    console.log(`baseline updated: ${findings.length} findings accepted at version ${version}`);
    process.exit(0);
  }

  process.exit(fresh.length ? 1 : 0);
})().catch((e) => { console.error("audit failed:", e.message); process.exit(2); });
