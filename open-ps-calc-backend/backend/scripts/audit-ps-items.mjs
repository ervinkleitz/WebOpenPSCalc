/**
 * audit-ps-items.mjs — compare every item we serve against the LIVE Payon Stories
 * item API, and report only what is NEW since the last accepted run.
 *
 *   node scripts/audit-ps-items.mjs                  # equipment + cards (default)
 *   node scripts/audit-ps-items.mjs --all            # every item we serve
 *   node scripts/audit-ps-items.mjs --limit 50       # smoke test
 *   node scripts/audit-ps-items.mjs --max-age 0      # ignore the cache, refetch all
 *   node scripts/audit-ps-items.mjs --refresh        # also rewrite ps_item_db.json text
 *   node scripts/audit-ps-items.mjs --accept         # fold findings into the baseline
 *
 * Exit code 1 when there are findings not already in the baseline, so a scheduled
 * run can fail loudly instead of printing into the void.
 *
 * WHY THIS EXISTS
 * ---------------
 * ps_item_db.json carries NO stats — `atk` is null for all 6,237 entries; it supplies
 * only name, slots, refine and description. Every number we serve (ATK, DEF, weight,
 * level requirement, jobs, slots) comes from the VANILLA pre-renewal record. And the
 * bundled scrape is dated 2026-03-24. So a Payon Stories rework is invisible to this
 * calculator until a player notices: that is how the Wrench (1531) served vanilla's
 * item for six months, and how Hunter Fly Card kept a 3% leech PS had raised to 12%.
 * Curating items one at a time does not fix that; checking the whole catalogue on a
 * schedule does.
 *
 * WHAT IT CHECKS
 * --------------
 *   NUMERIC  live stat vs the stat we serve (atk, def, weapon level, level
 *            requirement, slots, weight).
 *   DRIFT    live effect text vs the bundled scrape's text. A change means PS
 *            reworked the item since the scrape. This is the pass that catches a
 *            Wrench: nothing numeric looks wrong, because our stats match the stale
 *            text rather than the live server.
 *   ABSENT   the id returns "No data". Candidate unobtainable duplicate — but only
 *            after the safety checks below.
 *
 * TWO ENCODING ARTIFACTS, OR THE REPORT IS 70% NOISE
 * --------------------------------------------------
 * Found the hard way: a naive comparison reported 174 differences, of which ~120 were
 * these two and nothing else.
 *   * Level requirement — vanilla stores "none" as 0, PS prints it as 1.
 *   * Weight — the DB stores TENTHS and PS prints a TRUNCATED whole number, so our
 *     1 (0.1 kg) shows as 0 and our 44 (4.4 kg) shows as 4. The test is
 *     ps === floor(ours / 10), never ps * 10 === ours.
 *
 * THE SAFETY CHECKS ON "ABSENT" ARE NOT OPTIONAL
 * ----------------------------------------------
 * The 2026-09-26 Apple-of-Archer work nearly removed real items with a wide rule.
 * An absent id is protected if it is hand-curated, already hidden, part of a combo,
 * or DROPPED BY A MONSTER. Note the drop check reads the raw mob_db.json and keys on
 * AEGIS NAME — an earlier version called loader.getMonster(), which returns combat
 * stats with no drops, silently found zero drops and duly cleared Doom Slayer (1370),
 * a real drop. If this check ever reports 0 dropped names, it is broken, not clean;
 * the script refuses to continue in that case.
 *
 * Polite by construction: 4 requests in flight, a pause between batches, backoff on
 * failure, and a cache so an interrupted run resumes instead of refetching.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PS_DIR = path.join(HERE, "../src/engine/data/ps");
const PRE_DIR = path.join(HERE, "../src/engine/data/pre-re/db");
const CACHE = path.join(HERE, ".cache-ps-items.json");
const BASELINE = path.join(PS_DIR, "ps_item_audit_baseline.json");
const REPORT = path.join(HERE, "ps-item-audit-report.json");

const API = "https://tools.payonstories.com/api/pc/item?id=";
const UA = "Mozilla/5.0 (compatible; WebOpenPSCalc/1.0; +https://github.com/ervinkleitz/WebOpenPSCalc)";
const CONCURRENCY = 4;
const PAUSE_MS = 120;

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OPT = {
  all: has("--all"),
  limit: Number(val("--limit", 0)) || 0,
  maxAgeH: Number(val("--max-age", 24)),
  refresh: has("--refresh"),
  accept: has("--accept"),
};

// ---------------------------------------------------------------- helpers (exported for tests)
export const plain = (h) =>
  String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

export const field = (text, label) => {
  const m = text.match(new RegExp(label + "\\s*:?\\s*([\\d,]+)", "i"));
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

/** The effect half of a description — everything before the stat block. */
export const effectText = (html) =>
  plain(html).split(/\n\s*(?:Class|Type|Defense|Attack|Compound)\s*:/)[0]
    .replace(/\s+/g, " ").replace(/[.,]/g, "").trim().toLowerCase();

/**
 * Numeric differences between what we serve and what PS prints. Returns [] when they
 * agree. Encapsulates the two encoding artifacts documented at the top.
 */
export function numericDiffs(ours, live) {
  const t = plain(live.description);
  const out = [];
  const push = (f, a, b) => out.push({ field: f, ours: a, ps: b });

  const atk = field(t, "Attack");
  if (atk != null && ours.atk != null && atk !== ours.atk) push("atk", ours.atk, atk);

  const def = field(t, "Defense");
  if (def != null && ours.def != null && def !== ours.def) push("def", ours.def, def);

  const wlv = field(t, "Weapon Level");
  if (wlv != null && ours.level != null && wlv !== ours.level) push("weapon_level", ours.level, wlv);

  // vanilla stores "no requirement" as 0; PS prints 1.
  const req = field(t, "Level Requirement");
  if (req != null && ours.equip_level != null
      && !(req === ours.equip_level || (ours.equip_level === 0 && req === 1)))
    push("equip_level", ours.equip_level, req);

  // DB stores tenths; PS prints a truncated whole number of kg.
  const w = field(t, "Weight");
  if (w != null && ours.weight != null && w !== Math.floor(ours.weight / 10))
    push("weight_kg", ours.weight / 10, w);

  if (live.slots != null && ours.slots != null && live.slots !== ours.slots)
    push("slots", ours.slots, live.slots);

  return out;
}

// ---------------------------------------------------------------- data
function loadLoader() {
  const { loader } = require("../src/engine/dataLoader");
  const { getProfile } = require("../src/engine/serverProfiles");
  loader.setProfile(getProfile("payon_stories"));
  return loader;
}

/** Every aegis_name any monster drops, from BOTH mob databases. */
function droppedAegisNames() {
  const names = new Set();
  for (const f of [path.join(PRE_DIR, "mob_db.json"), path.join(PS_DIR, "ps_mob_db.json")]) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    for (const m of Object.values(raw.mobs || raw)) {
      if (!m || typeof m !== "object") continue;
      for (const key of ["drops", "mvp_drops"]) {
        for (const d of m[key] || []) if (d && d.item) names.add(String(d.item).toLowerCase());
      }
    }
  }
  return names;
}

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

// ---------------------------------------------------------------- fetch
async function fetchAll(ids, cache) {
  const now = Date.now();
  const fresh = (id) => {
    const e = cache[String(id)];
    return e && e._fetchedAt && (now - e._fetchedAt) < OPT.maxAgeH * 3600e3;
  };
  const todo = ids.filter((id) => !fresh(id));
  console.log(`${ids.length} targets · ${ids.length - todo.length} cached within ${OPT.maxAgeH}h · ${todo.length} to fetch`);
  let done = 0, failed = 0, streak = 0;

  const one = async (id, attempt = 0) => {
    try {
      const res = await fetch(API + id, { headers: { accept: "application/json", "user-agent": UA } });
      if (!res.ok) throw new Error("http " + res.status);
      const j = await res.json();
      cache[String(id)] = { ...(j && j.error ? { _error: j.error } : j), _fetchedAt: Date.now() };
      streak = 0;
    } catch (e) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        return one(id, attempt + 1);
      }
      cache[String(id)] = { _error: String(e.message || e), _fetchedAt: Date.now() };
      failed++; streak++;
    }
    done++;
  };

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map((id) => one(id)));
    if (streak >= 20) { console.error("20 consecutive failures — stopping rather than hammering their server"); break; }
    if (done % 400 < CONCURRENCY) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      console.log(`  ${done}/${todo.length} (${failed} failed)`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  if (todo.length) console.log(`fetched ${done}, failed ${failed}`);
}

// ---------------------------------------------------------------- main
async function main() {
  const loader = loadLoader();
  const scrape = readJson(path.join(PS_DIR, "ps_item_db.json"), {});
  const manual = readJson(path.join(PS_DIR, "ps_item_manual.json"), {});
  const overrides = readJson(path.join(PS_DIR, "ps_item_overrides.json"), {});
  const hiddenRaw = readJson(path.join(PS_DIR, "ps_hidden_items.json"), {});
  const hidden = new Set(Object.keys(hiddenRaw.hidden || {}));
  const comboText = (() => { try { return fs.readFileSync(path.join(PS_DIR, "ps_item_combo_db.json"), "utf8"); } catch { return ""; } })();
  const dropped = droppedAegisNames();

  // Guard: a silently empty drop set is how a previous version cleared a real item.
  if (dropped.size === 0) {
    console.error("ABORT: the monster-drop check found 0 dropped item names. That is a broken\n"
      + "check, not a clean database — every 'absent' verdict below would be unsafe.\n"
      + "Drops live in mob_db.json keyed by aegis_name; fix droppedAegisNames() first.");
    process.exit(2);
  }
  console.log(`drop check armed: ${dropped.size} distinct dropped aegis names`);

  // Which items to audit.
  const KINDS = new Set(["IT_WEAPON", "IT_ARMOR", "IT_CARD"]);
  let ids = [];
  for (let id = 1; id < 32000; id++) {
    const it = loader.getItem(id);
    if (!it) continue;
    if (!OPT.all && !KINDS.has(it.type)) continue;
    ids.push(id);
  }
  if (OPT.limit) ids = ids.slice(0, OPT.limit);

  const cache = readJson(CACHE, {});
  await fetchAll(ids, cache);

  // ---- compare
  const findings = { numeric: [], drift: [], absent: [], protected: [] };
  let descRefreshed = 0;
  for (const id of ids) {
    const key = String(id);
    const live = cache[key];
    const ours = loader.getItem(id);
    if (!live || !ours) continue;

    if (live._error) {
      const aegis = String(ours.aegis_name || "").toLowerCase();
      const why = [];
      if (manual[key]) why.push("hand-curated");
      if (overrides[key]) why.push("override");
      if (aegis && dropped.has(aegis)) why.push("monster drop");
      if (comboText.includes(key)) why.push("item combo");
      if (hidden.has(key)) why.push("already hidden");
      (why.length ? findings.protected : findings.absent).push({ id, name: ours.name, type: ours.weapon_type || ours.type, why });
      continue;
    }

    const diffs = numericDiffs(ours, live);
    if (diffs.length) findings.numeric.push({ id, name: ours.name, type: ours.weapon_type || ours.type, diffs });

    const old = scrape[key] && scrape[key].description;
    if (old && live.description) {
      const a = effectText(old), b = effectText(live.description);
      if (a && b && a !== b) findings.drift.push({ id, name: ours.name, was: a.slice(0, 200), now: b.slice(0, 200) });
      if (OPT.refresh && old !== live.description) { scrape[key].description = live.description; descRefreshed++; }
    }
  }

  if (OPT.refresh) {
    fs.writeFileSync(path.join(PS_DIR, "ps_item_db.json"), JSON.stringify(scrape, null, 1));
    console.log(`--refresh: rewrote ${descRefreshed} descriptions in ps_item_db.json`);
  }

  // ---- baseline: only report what is NEW
  const baseline = readJson(BASELINE, { _comment: "", numeric: {}, drift: {}, absent: [] });
  const sig = (f) => f.diffs.map((d) => `${d.field}:${d.ours}>${d.ps}`).sort().join(",");
  const newNumeric = findings.numeric.filter((f) => baseline.numeric[String(f.id)] !== sig(f));
  const newDrift = findings.drift.filter((f) => baseline.drift[String(f.id)] !== f.now);
  const knownAbsent = new Set((baseline.absent || []).map(String));
  const newAbsent = findings.absent.filter((f) => !knownAbsent.has(String(f.id)));

  // ---- report
  const line = (s) => console.log(s);
  line("");
  line(`audited ${ids.length} items`);
  line(`  numeric differences : ${findings.numeric.length} total, ${newNumeric.length} NEW`);
  line(`  text drift          : ${findings.drift.length} total, ${newDrift.length} NEW`);
  line(`  absent from PS      : ${findings.absent.length} total, ${newAbsent.length} NEW  (+${findings.protected.length} protected)`);

  if (newNumeric.length) {
    line("\n=== NEW numeric differences ===");
    for (const f of newNumeric.slice(0, 40))
      line(`  ${String(f.id).padEnd(6)} ${String(f.name).slice(0, 26).padEnd(28)} ${f.diffs.map((d) => `${d.field} ours=${d.ours} ps=${d.ps}`).join("; ")}`);
    if (newNumeric.length > 40) line(`  ... +${newNumeric.length - 40} more`);
  }
  if (newDrift.length) {
    line("\n=== NEW text drift (PS reworked these since our scrape) ===");
    for (const f of newDrift.slice(0, 25)) {
      line(`  ${f.id} ${f.name}`);
      line(`     was: ${f.was.slice(0, 130)}`);
      line(`     now: ${f.now.slice(0, 130)}`);
    }
    if (newDrift.length > 25) line(`  ... +${newDrift.length - 25} more`);
  }
  if (newAbsent.length) {
    line("\n=== NEW items PS does not have ===");
    line("  (verify by NAME before hiding any of these — PS often has the same item at a different id)");
    for (const f of newAbsent.slice(0, 40)) line(`  ${String(f.id).padEnd(6)} ${String(f.name).slice(0, 30).padEnd(32)} ${f.type}`);
    if (newAbsent.length > 40) line(`  ... +${newAbsent.length - 40} more`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), findings, new: { numeric: newNumeric, drift: newDrift, absent: newAbsent } }, null, 1));
  line(`\nfull report -> ${path.relative(process.cwd(), REPORT)}`);

  if (OPT.accept) {
    const next = {
      _comment: "Accepted PS-vs-ours differences. audit-ps-items.mjs reports only what is NOT here, "
        + "so a scheduled run stays quiet until Payon Stories actually changes something. "
        + "Regenerate with: node scripts/audit-ps-items.mjs --accept",
      _acceptedAt: new Date().toISOString(),
      numeric: Object.fromEntries(findings.numeric.map((f) => [String(f.id), sig(f)])),
      drift: Object.fromEntries(findings.drift.map((f) => [String(f.id), f.now])),
      absent: findings.absent.map((f) => f.id).sort((a, b) => a - b),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 1));
    line(`--accept: baseline updated (${findings.numeric.length} numeric, ${findings.drift.length} drift, ${findings.absent.length} absent)`);
    return 0;
  }

  const total = newNumeric.length + newDrift.length + newAbsent.length;
  if (total) {
    line(`\n${total} NEW finding(s). Review them, fix what is real, then run with --accept to quieten the rest.`);
    return 1;
  }
  line("\nNo new differences since the last accepted baseline.");
  return 0;
}

// Only run when invoked directly, so tests can import the helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
}
