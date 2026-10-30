// Changing class must not leave the OLD class's passives in your stats, not even
// for the second the new list takes to arrive.
//
// job-switch-stats covers the settled state: a Sage with Dragonology 10 who becomes
// an Acolyte must lose the +5 INT. It passed for months, because locally the passive
// list comes back in a few milliseconds. The full suite run against production found
// the hole -- the fetch effect replaced the list only when the reply landed, so for
// the whole round trip the readout filtered the Acolyte's masteries against the
// SAGE's passive list and went on paying the +5. Reported as "INT should be base 60
// + job 3 = 63, shown 68".
//
// So this test does what a slow connection does: it holds the skill-tree request
// open and watches the number for the whole window.
//
// Run: node tools/e2e/job-switch-slow-network.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const DELAY_MS = 2500;

const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
  "garment", "shoes", "accessory_left", "accessory_right"];
const blk = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of blk.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

// Dragonology 10 is +5 INT and is a SAGE passive. An Acolyte cannot learn it.
const BUILD = {
  job_id: 16, base_level: 99, job_level: 50,
  base_stats: { str: 20, agi: 20, vit: 20, int: 60, dex: 40, luk: 20 },
  mastery_levels: { SA_DRAGONOLOGY: 10 },
  target_mob_id: 1002,
};
const BASE_INT = BUILD.base_stats.int;

let ok = true;
const check = (c, m, extra) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!c) ok = false;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
const page = await ctx.newPage();
// The raw in-page fetch below bypasses the app's own API client, so it carries no
// X-API-Key of its own and 401s against a deployment whose key gate is on. That
// surfaced as a confusing null rather than an error, so set the header once here:
// export OPSCALC_API_KEY to the deployed key when running this against production.
if (process.env.OPSCALC_API_KEY) await page.setExtraHTTPHeaders({ "X-API-Key": process.env.OPSCALC_API_KEY });

// Hold the passive-list request open, which is all a slow connection is.
let delaying = false;
await page.route("**/api/data/skill-tree/**", async (route) => {
  if (delaying) await new Promise((r) => setTimeout(r, DELAY_MS));
  await route.continue();
});

const shownInt = async () => {
  const card = page.locator(".ro-stat-card", { has: page.locator(".ro-stat-name", { hasText: /^INT$/i }) }).first();
  const t = await card.locator(".ro-stat-total").first().innerText().catch(() => "");
  const n = Number(String(t).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
// Both jobs' own INT bonuses, from the endpoint the editor itself uses, rather
// than arithmetic in this file: the first draft guessed the Sage's and asserted a
// total of 70 against the correct 74.
await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const bonusInt = (id) => page.evaluate(async (j) => {
  const r = await fetch(`/api/data/job-bonus-stats/${j}?job_level=50&server=payon_stories`);
  return r.ok ? (await r.json()).int_ : null;
}, id);
const jobBonusInt = await bonusInt(4);    // Acolyte
const sageBonusInt = await bonusInt(16);  // Sage
check(jobBonusInt != null && sageBonusInt != null,
  "read both jobs' own INT bonuses", { acolyte: jobBonusInt, sage: sageBonusInt });
const ACOLYTE_CORRECT = BASE_INT + (jobBonusInt ?? 0);        // 63
const ACOLYTE_WITH_LEAK = ACOLYTE_CORRECT + 5;                // 68, the bug's signature

await page.goto(`${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: BUILD, skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})))}`, { waitUntil: "domcontentloaded" });

// Settle as a Sage. Waiting for the passives ROW to name Dragonology is one render
// too early -- the row and the stat readout update on separate effects, and that
// read 69 where the settled value is 74. Waiting for QUIESCENCE instead: the same
// number three polls running. Deliberately not "wait until it equals 74", which
// would make the assertion below assert itself.
const row = async () => (await page.locator('[data-panel="passives"] .equip-slot-value')
  .first().textContent().catch(() => "") || "").trim();
// Quiescence alone is not enough either: the pre-fetch 69 holds steady for longer
// than any sane stability window before jumping to 74. So BOTH -- the passives row
// is in the state we are waiting for AND the number has stopped moving. Still not
// "wait until it equals 74": the row is a different signal from the stat, so the
// assertion below is not asserting itself.
const settledInt = async (rowReady) => {
  let last = null, stable = 0;
  for (let i = 0; i < 150; i++) {
    const ready = rowReady(await row());
    const v = await shownInt();
    stable = (ready && v != null && v === last) ? stable + 1 : 0;
    last = v;
    // Eight polls, not three. The stat readout lags the passives row by more than
    // half a second -- they are separate effects and the stat one recomputes off a
    // good deal more -- so a short plateau returned the pre-fetch 69 while 74 was
    // still on its way.
    if (stable >= 8) return v;
    await page.waitForTimeout(200);
  }
  return last;
};
const hasDragon = (t) => /dragonology/i.test(t);
const noDragon = (t) => t.length > 0 && !/dragonology/i.test(t);
// Wait for the passives row, then for the number to stop moving. Chasing this
// precondition is what uncovered the second bug behind it: the stat effect read the
// job-filtered mastery map but did not list it as a dependency, so when the passive
// list arrived nothing recomputed and a Sage sat at 69 INT until some unrelated
// change happened to re-run the effect. No amount of waiting fixes that, which is
// why an eight-second settle here still failed one run in three.
await (async () => { for (let i = 0; i < 60; i++) { if (hasDragon(await row())) return; await page.waitForTimeout(500); } })();
const sageInt = await settledInt(hasDragon);
check(sageInt === BASE_INT + (sageBonusInt ?? 0) + 5,
  "a Sage with Dragonology 10 carries its +5 INT",
  { sageInt, expected: BASE_INT + (sageBonusInt ?? 0) + 5 });

// ---- the window ----------------------------------------------------------------
delaying = true;
await page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Character$/ }) })
  .locator("select").first().selectOption({ label: "Acolyte" });

// Sample across the whole delay, starting immediately. The bug is not the final
// value -- that was always right -- it is every frame in between.
const samples = [];
const started = Date.now();
while (Date.now() - started < DELAY_MS + 1500) {
  samples.push(await shownInt());
  await page.waitForTimeout(120);
}
delaying = false;
const seen = samples.filter((v) => v != null);
console.log(`    ${seen.length} samples over ${DELAY_MS + 1500}ms:`, JSON.stringify([...new Set(seen)]));

// Non-vacuity: a run that sampled nothing, or never actually waited, proves nothing.
check(seen.length >= 10, "the readout was actually sampled across the window", seen.length);
check(Date.now() - started >= DELAY_MS, "and the window really was held open");

const leaked = seen.filter((v) => v === ACOLYTE_WITH_LEAK);
check(leaked.length === 0,
  `an Acolyte never shows the Sage's Dragonology (+5 INT = ${ACOLYTE_WITH_LEAK})`,
  { leakedSamples: leaked.length, distinct: [...new Set(seen)] });

// And once the real list lands, the settled number is the one job-switch-stats wants.
const finalInt = await settledInt(noDragon);
check(finalInt === ACOLYTE_CORRECT,
  `settled, an Acolyte is base ${BASE_INT} + job ${jobBonusInt} = ${ACOLYTE_CORRECT}`,
  finalInt);

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
