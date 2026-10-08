// "add these" — the maintainer, 2026-10-08, with a screenshot of another calculator's
// "Manual Edits on Enemy" panel: flat and percentage adjustments layered on whatever
// enemy is selected, plus the enemy's own damage reductions.
//
// The point is that it works on a REAL monster. You cannot edit a monster's stats, and
// rebuilding one as a custom target just to ask "what if it had 50 more DEF" is a lot
// of typing. So every check here runs against a real monster, not a custom target.
//
// The assertion that matters most is the last one: with every field left at 0 the
// damage must be byte-identical to before the feature existed.
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

const PORING = 1002;
const link = `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 80, agi: 40, vit: 40, int: 10, dex: 50, luk: 10 },
    equipped: { right_hand: 1129 }, target_mob_id: PORING,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 2100 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const setEdit = async (label, value) => {
  const f = page.locator(".field", { has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) }).last();
  await f.locator("input").fill(String(value));
  await page.waitForTimeout(700);
};
const damage = async () => {
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const vals = [...document.querySelectorAll(".pl-track .pl-step .pl-val")];
    if (!vals.length) return null;
    const m = [...vals[vals.length - 1].textContent.replace(/,/g, "").matchAll(/\d+/g)].map(Number);
    return m.length ? m[m.length - 1] : null;
  });
};
const badge = () => page.evaluate(() => {
  const b = document.querySelector(".manual-enemy-count");
  return b ? b.textContent.trim() : null;
});

await page.goto(link, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

check(await page.locator(".manual-enemy-head").count() > 0,
  "the Manual edits panel is offered against a real monster, not only a custom target");

const baseline = await damage();
check(baseline != null && baseline > 0, `baseline damage vs Poring is ${baseline}`);
check(await badge() === null, "no badge while nothing is edited");

// --- a flat defensive edit ---------------------------------------------------
await setEdit("DEF", 50);
const withDef = await damage();
console.log(`    +50 DEF : ${baseline} -> ${withDef}`);
check(withDef != null && withDef < baseline, "adding DEF to the enemy lowers your damage");
check(await badge() === "1 active", `the badge counts it (${await badge()})`);

// --- a percentage reduction --------------------------------------------------
await setEdit("DEF", 0);
await setEdit("All physical %", 50);
const withRes = await damage();
console.log(`    50% physical resist : ${baseline} -> ${withRes}`);
check(withRes != null && withRes < baseline,
  "an enemy physical resistance cuts your damage, on a real monster");
check(Math.abs(withRes - Math.floor(baseline / 2)) <= 2,
  `and cuts it by about half (${withRes} vs ~${Math.floor(baseline / 2)})`);

// --- it survives a share link ------------------------------------------------
await page.getByRole("button", { name: /^Menu$|^☰$/ }).first().click().catch(() => {});
await page.waitForTimeout(500);
await page.getByRole("button", { name: /Copy share link|Copied!/ }).first().click();
await page.waitForTimeout(2500);
const p2 = await ctx.newPage();
await p2.goto(page.url(), { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(6500);
const sharedBadge = await p2.evaluate(() => document.querySelector(".manual-enemy-count")?.textContent?.trim() ?? null);
const sharedVal = await p2.evaluate(() => {
  for (const f of document.querySelectorAll(".field")) {
    if (f.querySelector("label")?.textContent?.trim() !== "All physical %") continue;
    return f.querySelector("input")?.value ?? null;
  }
  return null;
});
await p2.close();
check(sharedBadge === "1 active" && sharedVal === "50",
  `a share link carries the edits (badge ${JSON.stringify(sharedBadge)}, value ${JSON.stringify(sharedVal)})`);

// --- Reset, and the no-edit path must be untouched ---------------------------
await page.getByRole("button", { name: /^Reset$/ }).last().click();
await page.waitForTimeout(900);
check(await badge() === null, "Reset clears every edit");
const after = await damage();
console.log(`    after Reset : ${after} (baseline was ${baseline})`);
check(after === baseline,
  "with nothing edited the damage is exactly what it was before the feature existed");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "manual-enemy-edits.png" });
console.log(ok ? "\nPASS - manual enemy edits apply, share, and reset cleanly." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
