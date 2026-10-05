/**
 * check-ps-skills.mjs — has Payon Stories changed its skill list since we last looked?
 *
 *   node scripts/check-ps-skills.mjs            # report what changed
 *   node scripts/check-ps-skills.mjs --accept   # record the current state as the baseline
 *
 * Exit code 1 when something changed, so a scheduled run fails loudly.
 *
 * WHY
 * ---
 * The planner importer (src/engine/psToolsImport.js) maps PS's skill constants onto
 * ours, and that mapping is only correct for the skill list PS had when it was
 * written. When they add, rename or re-purpose a skill the import silently drops it:
 * that is exactly how Tool Mastery was missed — PS repurposed Overcharge in place, our
 * round-trip test only ever proved self-consistency, and it took the maintainer
 * pointing at their planner to catch it. A round trip through our own constants cannot
 * find that class of bug. Asking PS what skills they have can.
 *
 * WHAT IT READS
 * -------------
 * Two signals, both from a plain fetch — no browser, no API key, nothing to scrape
 * visually:
 *   * the VERSION the site shows in its left sidebar, which is `buildDate` in the
 *     page's __NEXT_DATA__ (the sidebar renders it as "V" + that value);
 *   * the SKILL LIST itself, as id -> display name, out of the skill page's data
 *     chunk. The chunk filename carries a content hash that changes on every deploy,
 *     so it is discovered from the page HTML rather than hardcoded.
 *
 * The list is the important half. A version bump with an identical skill list is
 * noise; a new or renamed skill is a mapping we may be missing.
 *
 * NOTE ON PARSING: their chunk is JavaScript, not JSON, and the description strings
 * contain \' sequences that are valid JS but invalid JSON — JSON.parse fails on most
 * of the job trees. So the id -> name pairs are read with a regex against the literal
 * source, which is why this looks for `"<id>":["<name>"` rather than parsing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SNAPSHOT = path.join(HERE, "../src/engine/data/ps/ps_tools_skill_snapshot.json");
const ORIGIN = "https://tools.payonstories.com";
const UA = "Mozilla/5.0 (compatible; WebOpenPSCalc/1.0; +https://github.com/ervinkleitz/WebOpenPSCalc)";
const ACCEPT = process.argv.includes("--accept");

/** id -> display name, straight out of the chunk source. */
export function parseSkillPairs(js) {
  const out = {};
  for (const m of String(js).matchAll(/"(\d{1,4})":\s*\[\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2].replace(/\^[0-9a-fA-F]{6}/g, "").replace(/\\'/g, "'").trim();
  }
  return out;
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

  // The data chunk is whichever one actually yields skills; the others are UI code.
  let skills = {}, from = null;
  for (const c of chunks) {
    const pairs = parseSkillPairs(await get(ORIGIN + c, "*/*"));
    if (Object.keys(pairs).length > Object.keys(skills).length) { skills = pairs; from = c.split("/").pop(); }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!Object.keys(skills).length) {
    throw new Error("fetched the chunks but parsed 0 skills — the regex no longer matches their format");
  }
  return { version, skills, chunk: from };
}

function main() {
  return fetchLive().then((live) => {
    const count = Object.keys(live.skills).length;
    console.log(`PS skill tool: version ${live.version ?? "(unknown)"} · ${count} skills · chunk ${live.chunk}`);

    const snap = (() => { try { return JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")); } catch { return null; } })();

    if (ACCEPT || !snap) {
      fs.writeFileSync(SNAPSHOT, JSON.stringify({
        _comment: "What tools.payonstories.com/skill listed when we last checked. "
          + "check-ps-skills.mjs diffs the live site against this and fails on any change, "
          + "so a new or renamed PS skill surfaces as a failed job instead of a silently "
          + "dropped import. Re-accept with: npm run ps:check-skills:accept",
        checkedAt: new Date().toISOString(),
        version: live.version,
        skill_count: count,
        skills: Object.fromEntries(Object.entries(live.skills).sort((a, b) => Number(a[0]) - Number(b[0]))),
      }, null, 1));
      console.log(snap ? "--accept: snapshot updated." : "no snapshot yet — wrote the first one.");
      return 0;
    }

    const added = [], removed = [], renamed = [];
    for (const [id, name] of Object.entries(live.skills)) {
      if (!(id in snap.skills)) added.push({ id, name });
      else if (snap.skills[id] !== name) renamed.push({ id, was: snap.skills[id], now: name });
    }
    for (const id of Object.keys(snap.skills)) if (!(id in live.skills)) removed.push({ id, name: snap.skills[id] });

    const versionChanged = snap.version !== live.version;
    if (versionChanged) console.log(`version changed: ${snap.version} -> ${live.version}`);

    // Which of the changed skills do we not know about? That is the actionable bit —
    // a new PS skill with no counterpart here is an import that will drop silently.
    const { loader } = require("../src/engine/dataLoader");
    const { getProfile } = require("../src/engine/serverProfiles");
    loader.setProfile(getProfile("payon_stories"));
    const knownIds = new Set((loader.getAllSkills() || []).map((s) => String(s.id)));
    const flag = (x) => (knownIds.has(String(x.id)) ? "" : "   <-- we have no skill with this id");

    if (added.length) {
      console.log(`\n=== ${added.length} skill(s) PS added ===`);
      for (const a of added.slice(0, 40)) console.log(`   ${a.id.padStart(5)} ${a.name}${flag(a)}`);
    }
    if (renamed.length) {
      console.log(`\n=== ${renamed.length} skill(s) PS renamed ===`);
      for (const r of renamed.slice(0, 40)) console.log(`   ${r.id.padStart(5)} "${r.was}" -> "${r.now}"${flag(r)}`);
    }
    if (removed.length) {
      console.log(`\n=== ${removed.length} skill(s) PS removed ===`);
      for (const r of removed.slice(0, 40)) console.log(`   ${r.id.padStart(5)} ${r.name}`);
    }

    const changed = added.length + renamed.length + removed.length;
    if (!changed && !versionChanged) { console.log("\nUnchanged since the last accepted snapshot."); return 0; }
    if (!changed) {
      console.log("\nOnly the version moved — the skill list is identical. Re-accept to record it:"
        + "\n  npm run ps:check-skills:accept");
      return 1;
    }
    console.log(`\n${changed} skill change(s). Check whether psToolsImport.js needs a new alias,`
      + "\nthen re-accept:\n  npm run ps:check-skills:accept");
    return 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(String(e.message || e)); process.exit(2); });
}
