// Passive skills is one equipment slot, holding the whole list.
//
// ONE slot rather than several, unlike the buffs, consumables and target debuffs:
// this list is fetched per job and runs 2-8 entries for almost every one of them
// (11 and 13 at the two extremes), so there is no grouping in it to split by, and
// splitting it would put a click in front of four checkboxes. What it takes from
// the others is the part that matters -- closed, the row NAMES what is on, where
// the panel used to say "3 of 8".
//
// The row is labelled with the JOB, not "Passive skills": the panel above already
// says that, and the buffs panel sets the precedent that a group is named for where
// its contents come from.
//
// Two of the checks below guard CSS rather than behaviour. A lone slot in the
// two-column .equip-grid sat at half width with dead space beside it, and a slot
// body normally forces its checkbox grid to ONE column -- right for a half-width
// slot, and eight tall wrapping rows for a full-width one.
//
// Run: node tools/e2e/passive-slot.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
  "garment", "shoes", "accessory_left", "accessory_right"];
const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of block.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of SLOTS) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

// Knight holding a Spear, so Spear Mastery has something to apply to. Masteries are
// NOT set through this link: the build state keys them by `mastery_key`, which is not
// always the skill's name (SM_TWOHAND is keyed SM_TWOHANDSWORD), and a link written
// with the wrong key silently does nothing. They are ticked through the UI instead.
const KNIGHT = `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 40, vit: 40, int: 1, dex: 60, luk: 1 },
    equipped: { right_hand: 1404 },   // Spear
    target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(KNIGHT, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

const PANEL = '[data-panel="passives"]';
const slots = () => page.$$eval(PANEL + " .equip-slot", (els) => els.map((e) => ({
  label: (e.querySelector(".equip-slot-label")?.textContent || "").trim(),
  value: (e.querySelector(".equip-slot-value")?.textContent || "").trim() || null,
  open: e.className.includes("equip-slot--open"),
  w: Math.round(e.getBoundingClientRect().width),
})));
const panel = page.locator(PANEL);

// ---- 1. one row, named for the job, holding nothing yet ------------------------
{
  const rows = await slots();
  check(rows.length === 1, "the passives are a single row", rows.map((r) => r.label));
  check(rows[0]?.label === "Knight",
    "named for the job, not for the panel it sits in", rows[0]?.label);
  check(rows[0]?.open === false, "closed for a browser that has never opened it");
  check(rows[0]?.value === "None", "and it says None", rows[0]?.value);
}

// ---- 2. the row spans the panel ------------------------------------------------
// A lone slot in the two-column grid sat at half width. Measured against the grid
// it lives in rather than a pixel count, which would be a viewport assertion.
{
  const gridW = await page.locator(PANEL + " .equip-grid").first()
    .evaluate((e) => Math.round(e.getBoundingClientRect().width));
  const slotW = (await slots())[0]?.w ?? 0;
  check(gridW > 0 && slotW / gridW > 0.95,
    "the row spans its grid rather than sitting in one of two columns", { gridW, slotW });
}

// ---- 3. open it: the checkboxes lay out in columns ------------------------------
await panel.locator(".equip-slot-head").first().click();
await page.waitForTimeout(600);
{
  const lefts = await page.$$eval(PANEL + " .equip-slot-body .field-checkbox",
    (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
  check(lefts.length >= 2,
    "the checkboxes use the width instead of stacking in one column", lefts);
}

// ---- 4. Max all, and the closed row names what it turned on --------------------
await panel.getByRole("button", { name: /max all/i }).click();
await page.waitForTimeout(900);
const boxes = await page.$$eval(PANEL + " .field-checkbox", (els) => els.map((e) => ({
  name: (e.querySelector("span")?.textContent || "").trim(),
  on: !!e.querySelector("input")?.checked,
})));
check(boxes.length > 0 && boxes.every((b) => b.on), "Max all ticks every one", boxes);

await panel.locator(".equip-slot-head").first().click();
await page.waitForTimeout(700);
{
  const v = (await slots())[0]?.value ?? "";
  // Names with ranks, in the panel's own order -- the rank is part of the fact.
  check(v === "Cavalry Mastery 5, Spear Mastery 10, Bash 10, Blade Mastery 10",
    "closed, the row names them with their ranks", v);
  // The old summary said "4 of 4", which answered a question nobody asks.
  check(!/^\d+ of \d+$/.test(v), "and does not merely count them", v);
}

// ---- 5. the panel's own summary says the same -----------------------------------
await page.locator(PANEL + " h2.panel-header").first().click();
await page.waitForTimeout(600);
{
  const summary = await page.locator(PANEL + " .panel-summary").first().textContent().catch(() => null);
  check(!!summary && /Spear Mastery 10/.test(summary) && !/ of /.test(summary),
    "the collapsed panel names them too", summary);
  await page.locator(PANEL + " h2.panel-header").first().click();
  await page.waitForTimeout(600);
}

// ---- 6. Reset puts it back ------------------------------------------------------
await panel.locator(".equip-slot-head").first().click();
await page.waitForTimeout(500);
await panel.getByRole("button", { name: /^reset$/i }).click();
await page.waitForTimeout(800);
await panel.locator(".equip-slot-head").first().click();
await page.waitForTimeout(700);
check((await slots())[0]?.value === "None", "Reset empties the row again", (await slots())[0]?.value);

// ---- 7. the controls still reach the engine -------------------------------------
// Spear Mastery adds ATK to a spear, so the damage has to move. A control that looks
// right while reaching nothing is invisible in a screenshot.
{
  const finalOf = async () => {
    await page.getByRole("button", { name: /calculate damage/i }).first().click();
    await page.waitForTimeout(5000);
    const rows = await page.$$eval(".pl-step", (els) => els.map((e) => ({
      val: (e.querySelector(".pl-val")?.textContent || "").trim(),
    })));
    const last = [...rows].reverse().find((r) => r.val && r.val !== "—");
    if (!last) return null;
    const nums = [...last.val.replace(/,/g, "").matchAll(/\d+/g)].map(Number);
    return nums.length ? nums[nums.length - 1] : null;
  };
  const bare = await finalOf();
  await panel.locator(".equip-slot-head").first().click();
  await page.waitForTimeout(500);
  await panel.getByRole("button", { name: /max all/i }).click();
  await page.waitForTimeout(1200);
  const maxed = await finalOf();
  check(bare != null && maxed != null, "a damage figure came back both times", { bare, maxed });
  // Guard the comparison: two nulls, or two equal numbers, must not pass.
  check(bare != null && maxed != null && maxed > bare,
    "Spear Mastery still raises a spear's damage, so the controls are wired", { bare, maxed });
}

check(errors.length === 0, "no page errors", errors);
await page.screenshot({ path: "passive-slot.png" });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
