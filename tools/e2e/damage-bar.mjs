// The number stays on screen, and keeps itself current.
//
// Measured on production 2026-10-17: nothing on the first screen carried a damage
// figure, because the only place one existed was the results panel, on a page 2–4
// screens tall. So the loop a damage calculator is actually used for — swap the
// card, see what it does — cost four actions: edit, scroll up, read, scroll back.
//
// Two halves, and the test holds both:
//   * a bar fixed to the foot of the viewport carries the damage range, DPS and
//     time-to-kill once a result exists;
//   * after the first Calculate, editing the build refreshes it by itself.
//
// WHAT THIS LEARNED THE HARD WAY: raising a stat does not necessarily change
// anything. The first version pushed STR from 83 to 120 on a level-99 build, the
// editor correctly clamped it back to 83 for want of stat points, and the test then
// reported "live recalc is broken" — it had never made an edit at all. Every edit
// below is one the build can afford, and each is confirmed to have stuck before its
// effect is asserted.
//
// Run: node tools/e2e/damage-bar.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const feSrc = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = feSrc.slice(feSrc.indexOf("const Z3_KEYS: string[] = ["), feSrc.indexOf("const Z3_ENC"));
const z3Keys = [];
for (const line of blk.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) {
    for (const sl of SLOTS) for (const i of [1, 2, 3, 4]) z3Keys.push(`${sl}_card${i}`);
    continue;
  }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) z3Keys.push(m[1]);
}
const z3Enc = {};
z3Keys.forEach((k, i) => { if (!(k in z3Enc)) z3Enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [z3Enc[k] ?? k, ren(x)])) : v;
const GEARED = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
    equipped: { right_hand: 1220, armor: 2302 },
    refine: { right_hand: 7 }, target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const bar = () => page.locator(".damage-bar");
const barText = async () => (await bar().innerText()).replace(/\s+/g, " ").trim();
const range = (t) => (t.match(/([\d,]+)[–-]([\d,]+)/) || []).slice(1).join("-");

await page.goto(GEARED, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// ---- 1. nothing is claimed before anything is calculated ------------------------
check(await bar().count() === 0,
  "no bar before the first calculation — there is no number to show yet");
check(await page.evaluate(() => document.querySelector(".app-shell").classList.contains("has-damage-bar")) === false,
  "and the page reserves no room for one");

// ---- 2. after Calculate it carries the figure, pinned to the viewport -----------
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(7000);

const first = await barText();
console.log(`    bar: ${first}`);
check(await bar().count() === 1, "Calculate puts the bar up");
check(/\d/.test(first) && range(first) !== "", `with a damage range in it (${range(first)})`, first);
check(/DPS/.test(first), "and DPS");

const box = await page.evaluate(() => {
  const el = document.querySelector(".damage-bar");
  const b = el.getBoundingClientRect();
  return { bottom: Math.round(b.bottom), vh: innerHeight, pos: getComputedStyle(el).position,
    padBottom: getComputedStyle(document.querySelector(".page")).paddingBottom };
});
check(box.pos === "fixed" && Math.abs(box.bottom - box.vh) <= 1,
  "sitting on the bottom edge of the viewport", box);
check(parseFloat(box.padBottom) >= 40,
  "and the page reserves room so it covers nothing", box.padBottom);

// It has to survive a scroll — that is the entire point.
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
const afterScroll = await page.evaluate(() => {
  const b = document.querySelector(".damage-bar").getBoundingClientRect();
  return { bottom: Math.round(b.bottom), vh: innerHeight };
});
check(Math.abs(afterScroll.bottom - afterScroll.vh) <= 1,
  "and stays there at the foot of a 2+ screen page", afterScroll);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

// ---- 3. editing refreshes it without pressing anything --------------------------
// DOWN, not up: this build has no spare stat points, so raising STR is silently
// clamped back and nothing changes. See the note at the top.
const strCard = page.locator("[class*='stat-card']").filter({ hasText: /^STR/ }).first();
const strInput = strCard.locator('input[type="number"]').first();
check(await strInput.count() === 1, "the STR card is where the test thinks it is");
await strInput.fill("60");
await strInput.dispatchEvent("change");
await page.waitForTimeout(900);
check(await strInput.inputValue() === "60",
  "the edit stuck (an unaffordable one is clamped back and tests nothing)",
  await strInput.inputValue());

// Poll for the refresh instead of sleeping past it: the delta badge clears itself
// after a few seconds, and a fixed 8s wait sailed straight past the window it is
// visible in, then reported the badge missing.
const waitForChange = async (was) => {
  for (let i = 0; i < 40; i++) {
    const t = await barText();
    if (t !== was) return t;
    await page.waitForTimeout(400);
  }
  return await barText();
};
const second = await waitForChange(first);
console.log(`    bar: ${second}`);
check(second !== first, "the bar refreshed itself with no Calculate pressed");
const a = Number(range(first).split("-")[0].replace(/,/g, ""));
const b2 = Number(range(second).split("-")[0].replace(/,/g, ""));
check(b2 < a, `and 23 fewer STR lowered the damage (${a} → ${b2})`, { a, b: b2 });

// The delta is the answer to "is that better", so it has to actually appear.
check(await page.locator(".damage-bar-delta").count() === 1,
  "showing what just changed");
const deltaText = await page.locator(".damage-bar-delta").innerText();
check(/^[−+-]/.test(deltaText.trim()), `signed (${deltaText.trim()})`, deltaText);
check(await page.locator(".damage-bar-delta.is-down").count() === 1,
  "and coloured as a loss, because it was one");

// ---- 4. the panel's own state is left alone -------------------------------------
// A background refresh must not reopen a panel the player closed, or every edit
// yanks the page around.
const closer = page.locator(".results-panel-header button").first();
if (await closer.count()) {
  await closer.click();
  await page.waitForTimeout(800);
  const openBefore = await page.locator(".results-panel-body").count();
  const was = await barText();
  await strInput.fill("55");
  await strInput.dispatchEvent("change");
  await waitForChange(was);
  check(await page.locator(".results-panel-body").count() === openBefore,
    "a live refresh does not reopen the results panel the player closed");
  check(await bar().count() === 1, "but the bar keeps working while it is closed");
}

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
