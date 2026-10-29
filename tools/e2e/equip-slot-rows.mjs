// Equipment is eleven lines you can read, not forty controls you scroll past.
//
// Each slot can carry an item, a refine, up to four cards and a forge, so a geared
// build turned the Equipment panel into the tallest thing in the editor by a wide
// margin — most of it belonging to slots the player was not touching. A slot is now
// one line that reads like the in-game equip window ("RIGHT HAND (WEAPON)  +7 Double
// Boned Bloody Gladius"), and opening one costs a click.
//
// WHAT HAS TO HOLD, beyond "it collapses":
//   * the closed line names the item the way the pill inside does, refine included —
//     a row saying "Gladius" for a +7 triple-carded Gladius is worse than no row;
//   * an empty slot says "Empty" rather than being blank, which reads as broken;
//   * a slot the engine EXCLUDES is visible as such while closed, or the player has
//     to open all eleven to find out why a number looks wrong;
//   * the hidden controls are genuinely out of reach — not merely invisible — or
//     tabbing through the panel walks into forty inputs nobody can see;
//   * the state is remembered, and the editing controls still work once open.
//
// Run: node tools/e2e/equip-slot-rows.mjs [baseUrl]
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
    equipped: {
      right_hand: 1220, right_hand_card1: 4092, right_hand_card2: 4035,
      armor: 2302, armor_card1: 4014, shoes: 2403, head_top: 5002,
    },
    refine: { right_hand: 7, armor: 4 }, target_mob_id: 1002,
  },
  skill: { id: 28, level: 10, label: "Sonic Blow" }, targetMode: "monster",
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// SCOPED to the equipment panel. `.equip-slot` is no longer the equipment panel's
// alone: buffs adopted it for their class groups and consumables for theirs, both
// deliberately, so the three stay the same control. A bare `.equip-slot` therefore
// sweeps in rows from two other panels -- which made this file count 17 slots where
// it wanted 11, and pair "Ammo" against "Self buffs" when checking that the two
// columns line up, two rows that are 1410px and two panels apart.
const EQ = '[data-panel="equipment"]';
const panel = () => page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Equipment$/ }) });
const rows = () => page.evaluate((eq) => [...document.querySelectorAll(eq + " .equip-slot")].map((e) => ({
  label: e.querySelector(".equip-slot-label")?.textContent ?? "",
  value: e.querySelector(".equip-slot-value")?.textContent ?? null,
  open: e.querySelector(".equip-slot-head")?.getAttribute("aria-expanded") === "true",
})), EQ);
const panelH = () => panel().evaluate((e) => Math.round(e.getBoundingClientRect().height));
const visibleControls = () => panel().locator("input:visible, select:visible, button:visible").count();

await page.goto(GEARED, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await panel().scrollIntoViewIfNeeded();

// ---- 1. one line per slot, naming what is worn ----------------------------------
const r = await rows();
check(r.length === 11, `every slot is a row (${r.length})`, r.length);
check(r.every((x) => !x.open), "and they all start closed");
for (const x of r) console.log(`    ${x.label.padEnd(26)} ${x.value}`);

const byLabel = Object.fromEntries(r.map((x) => [x.label, x.value]));
// The refine is part of the name, and the cards are in it — this is the assembled
// game name, the same string the pill shows.
check(/^\+7 .*Gladius$/.test(byLabel["Right hand (weapon)"] ?? ""),
  "the weapon row carries its refine and its card name",
  byLabel["Right hand (weapon)"]);
check(/^\+4 /.test(byLabel["Armor"] ?? ""), "so does the armour", byLabel["Armor"]);
check(byLabel["Garment"] === "Empty", "an empty slot says Empty, not nothing", byLabel["Garment"]);

// ---- 2. the hidden controls are out of reach, not merely invisible --------------
const reachable = await page.evaluate((eq) =>
  [...document.querySelectorAll(`${eq} .equip-slot-body input, ${eq} .equip-slot-body select`)]
    .filter((e) => e.offsetParent !== null).length, EQ);
check(reachable === 0,
  "nothing inside a closed slot is focusable — tabbing does not walk into it", reachable);

const closedH = await panelH();
const closedControls = await visibleControls();

// ---- 3. expand all / collapse all, and what it is worth -------------------------
await page.locator(`${EQ} .equip-slot-actions button`).first().click();   // Expand all
await page.waitForTimeout(700);
const openH = await panelH();
const openControls = await visibleControls();
console.log(`    panel ${closedH}px / ${closedControls} controls closed → ${openH}px / ${openControls} open`);
check(openH > closedH * 1.5 && closedControls < openControls / 2,
  `collapsing is worth the click (${closedH}px vs ${openH}px, ${closedControls} vs ${openControls} controls)`,
  { closedH, openH, closedControls, openControls });

await page.locator(`${EQ} .equip-slot-actions button`).nth(1).click();    // Collapse all
await page.waitForTimeout(700);
check((await rows()).every((x) => !x.open), "Collapse all shuts them again");

// ---- 4. an open slot still edits, and does not print its name twice -------------
const weapon = page.locator(`${EQ} .equip-slot`).first();
await weapon.locator(".equip-slot-head").click();
await page.waitForTimeout(600);
check((await rows())[0].open, "clicking a row opens that slot");
check((await rows())[0].value === null,
  "and the row stops repeating the name the pill below already shows", (await rows())[0].value);

// The refine select is the quickest proof the controls inside are live.
const refine = weapon.locator(".refine-select").first();
check(await refine.count() === 1, "the refine picker is there once open");
check(await refine.inputValue() === "7", "at the refine the build carries", await refine.inputValue());
await refine.selectOption("9");
await page.waitForTimeout(800);
await weapon.locator(".equip-slot-head").click();   // close it again
await page.waitForTimeout(600);
check(/^\+9 /.test((await rows())[0].value ?? ""),
  "editing inside the slot updates the line that summarises it", (await rows())[0].value);

// ---- 4b. the two columns line up, and stay lined up when a slot opens ----------
// Reported 2026-10-19: "alignment doesn't work in compact and non-compact". Empty
// slots used to sit on ONE line while filled ones took two, so any row pairing them
// put its two separators 18px apart in comfortable and 10px in compact. Every slot
// stacks now, so a closed row is exactly two lines whatever it holds.
//
// The separator is the slot's TOP border, so what has to agree is the two cells'
// TOP edges. That is also what lets an open slot stay in its column: a bottom
// border would only line up if the row were stretched to equalise its cells, and
// the stretch was what shoved the neighbouring slot about - see 4c.
//
// Checked at two widths AND both densities, because the failure modes differ: a
// narrow cell can wrap the LABEL on one side and the NAME on the other, which is
// three lines either way but only equal in height because both are given a line
// height expressed as a LENGTH rather than a multiplier.
const tops = () => page.evaluate((eq) => {
  const all = [...document.querySelectorAll(eq + " .equip-slot")]
    .map((e) => ({ label: e.querySelector(".equip-slot-label").textContent,
                   x: Math.round(e.getBoundingClientRect().left),
                   top: Math.round(e.getBoundingClientRect().top) }));
  const bad = [];
  for (let i = 0; i + 1 < all.length; i += 2) {
    const d = Math.abs(all[i].top - all[i + 1].top);
    if (d > 2) bad.push(`${all[i].label} / ${all[i + 1].label}: ${d}px`);
  }
  return { all, bad };
}, EQ);

for (const w of [1100, 1900]) {
  await page.setViewportSize({ width: w, height: 1200 });
  for (const density of ["comfortable", "compact"]) {
    await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
    await page.waitForTimeout(400);
    const { bad } = await tops();
    check(bad.length === 0, `${w}px / ${density}: the two columns' rows line up`, bad);
  }
}
await page.evaluate(() => document.documentElement.setAttribute("data-density", "comfortable"));

// ---- 4c. an open slot stays in its own column ----------------------------------
// Reported 2026-10-19: "when i expand the equipment selection, it should stay in
// the same spot not go down another row". It had been given `grid-column: 1 / -1`
// so that a full-width body had room; that pulled it out of the two-column flow and
// left its neighbour stranded on a row of its own. Nothing is pulled out now, so
// every slot - the opened one included - keeps the column it started in.
const colsBefore = (await tops()).all;
const headMid = page.locator(`${EQ} .equip-slot`).filter({ hasText: "Headgear (mid)" });
await headMid.locator(".equip-slot-head").click();
await page.waitForTimeout(500);
const colsAfter = (await tops()).all;
check(colsBefore.every((r, i) => r.x === colsAfter[i].x),
  "opening a slot leaves every slot in the column it was in",
  colsBefore.filter((r, i) => r.x !== colsAfter[i].x).map((r, i) => r.label));

// and the body must sit BELOW the head rather than under it: a full-height head was
// once used to push the old bottom border down, and it painted over the card rows.
const clear = await headMid.evaluate((el) => {
  const head = el.querySelector(".equip-slot-head").getBoundingClientRect();
  const body = el.querySelector(".equip-slot-body").getBoundingClientRect();
  return Math.round(body.top - head.bottom);
});
check(clear >= 0, "an open slot's body starts below its head, not behind it", clear);
await headMid.locator(".equip-slot-head").click();
await page.waitForTimeout(400);

await page.setViewportSize({ width: 900, height: 1200 });
await page.waitForTimeout(400);

// ---- 5. remembered across a reload ----------------------------------------------
await weapon.locator(".equip-slot-head").click();
await page.waitForTimeout(500);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const after = await rows();
check(after[0]?.open === true, "a slot left open is open next time", after[0]);
check(after.slice(1).every((x) => !x.open),
  "and only that one", after.filter((x) => x.open).map((x) => x.label));

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
