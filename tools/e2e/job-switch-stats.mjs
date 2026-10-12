// "If you load a saved stat and gear, then change the class, the stat bonuses get
// really wonky" — Beerbelly Slinger via Frennetix, 2026-10-06.
//
// mastery_levels is deliberately NOT pruned when you change class, so switching away
// and back does not wipe ranks you typed. But the stat readout was still counting
// class-specific passives the new job cannot learn: a Sage with Dragonology 10 who
// became an Acolyte kept +5 INT, while the Passive skills panel beside it correctly
// no longer listed Dragonology.
//
// The engine already filtered them (playerStateBuilder -> filterMasteryLevelsForJob),
// so the displayed stats disagreed with the damage they were feeding.
//
// The check is against base + the job's own stat bonus, read from the same endpoint
// the editor uses, rather than a hardcoded total: /calculate/status exposes only
// derived values (batk, hit, flee), not raw stats, so that is the exact comparison
// available. With no gear and no learnable passives the two must agree precisely,
// and any leftover from the previous class shows up as a difference.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const FE = new URL("file:///C:/Users/ervin/WebOpenPSCalc/open-ps-calc-frontend/frontend/");
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of blk.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

// Dragonology is a Sage passive (+INT); Hilt Binding a Blacksmith one (+1 STR).
// An Acolyte can learn neither.
const BUILD = {
  job_id: 16, base_level: 99, job_level: 50,
  base_stats: { str: 20, agi: 20, vit: 20, int: 60, dex: 40, luk: 20 },
  mastery_levels: { SA_DRAGONOLOGY: 10, BS_HILTBINDING: 1 },
  target_mob_id: 1002,
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } };

const shown = async (name) => {
  const card = page.locator(".ro-stat-card", { has: page.locator(".ro-stat-name", { hasText: new RegExp(`^${name}$`, "i") }) }).first();
  return Number((await card.locator(".ro-stat-total").first().innerText().catch(() => "0")).trim());
};
/** The job's own stat bonus at this job level — the authority the editor itself
 *  uses. With no gear and no learnable passives, a stat is exactly base + this.
 *  (/calculate/status only exposes derived values like batk and hit, not raw stats,
 *  so this is the precise comparison available.) */
const jobBonus = async (jobId) => page.evaluate(async (id) => {
  const res = await fetch(`/api/data/job-bonus-stats/${id}?job_level=50&server=payon_stories`);
  return res.ok ? res.json() : null;
}, jobId);

await page.goto(`${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: BUILD, skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})))}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

const sageInt = await shown("INT");
console.log("as a Sage — INT shown:", sageInt);

// Switch to a class that can learn neither passive.
await page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Character$/ }) })
  .locator("select").first().selectOption({ label: "Acolyte" });
await page.waitForTimeout(4500);

const acoInt = await shown("INT");
const acoStr = await shown("STR");
console.log("as an Acolyte — INT shown:", acoInt, " STR shown:", acoStr);

// With no gear and no passives an Acolyte can learn, each stat must be exactly
// base + job bonus. Any leftover from the Sage build shows up here.
const jb = await jobBonus(4);
console.log("Acolyte job bonus:", JSON.stringify(jb));
check(jb != null, "could not read the Acolyte job bonus");
if (jb) {
  check(acoInt === BUILD.base_stats.int + jb.int_,
    `INT should be base ${BUILD.base_stats.int} + job ${jb.int_} = ${BUILD.base_stats.int + jb.int_}, shown ${acoInt}`);
  check(acoStr === BUILD.base_stats.str + jb.str_,
    `STR should be base ${BUILD.base_stats.str} + job ${jb.str_} = ${BUILD.base_stats.str + jb.str_}, shown ${acoStr}`);
}
check(acoInt < sageInt, "losing Dragonology should lower INT, not leave it where it was");

// And the passive panel must agree: neither skill is offered to an Acolyte.
const passive = (await page.locator(".panel", { has: page.locator(".panel-title", { hasText: /Passive skills/i }) })
  .first().innerText().catch(() => "")).replace(/\s+/g, " ");
check(!/dragonology/i.test(passive), "an Acolyte should not be offered Dragonology");
console.log("passive panel offers Dragonology:", /dragonology/i.test(passive));

// Switching BACK must restore it — the ranks are kept on purpose, only ignored.
await page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Character$/ }) })
  .locator("select").first().selectOption({ label: "Sage" });
await page.waitForTimeout(4500);
const backInt = await shown("INT");
console.log("back to Sage — INT shown:", backInt);
check(backInt === sageInt, `switching back should restore INT (${sageInt} -> ${backInt})`);

await page.screenshot({ path: "job-switch-stats.png" });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
