// "add these" (2026-10-08, with a screenshot of another calculator's Manual Edits on
// Enemy panel), then "manual edits should be part of custom stats" (2026-10-09).
//
// So they live inside the Custom stats tab: deltas on top of the custom target's own
// fields, which is what you want straight after copying a monster in — "that, but 50
// more DEF" — plus the damage reductions, which have no field of their own up there.
//
// The two assertions that matter most are at the ends: that the edits are NOT offered
// or applied in Monster mode (hidden state must never move a number — the trap the
// wildcard-mix state used to be), and that with everything at 0 the damage is exactly
// the pre-feature figure.
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

const ORC = 1023;
const link = `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 80, agi: 40, vit: 40, int: 10, dex: 50, luk: 10 },
    equipped: { right_hand: 1129 }, target_mob_id: ORC,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 2300 } });
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
const panelShown = () => page.locator(".manual-enemy-head").count();
const badge = () => page.evaluate(() => document.querySelector(".manual-enemy-count")?.textContent?.trim() ?? null);

await page.goto(link, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

// --- it belongs to Custom stats, not to Monster mode ------------------------
check(await panelShown() === 0, "Monster mode does not offer manual edits");
const monsterBaseline = await damage();

await page.getByRole("button", { name: "Custom stats" }).click();
await page.waitForTimeout(1200);
check(await panelShown() === 1, "Custom stats does");

// The twenty fields are collapsed by default -- they are almost always all zero, and
// an always-expanded block made the Target panel tall enough to cost the editor its
// fourth column at full width (reported 2026-10-09). Open it to drive the fields.
check(await page.locator(".manual-enemy-group").count() === 0,
  "the fields start collapsed, keeping the panel short");
await page.getByRole("button", { name: /^Manual edits/ }).click();
await page.waitForTimeout(900);
check(await page.locator(".manual-enemy-group").count() === 2, "the toggle opens them");

// Start from the real monster so the numbers mean something.
await page.getByRole("button", { name: /Copy .*'s stats/ }).first().click();
await page.waitForTimeout(1500);
const copied = await damage();
check(copied === monsterBaseline,
  `the copied target still prices like the monster (${monsterBaseline} -> ${copied})`);
check(await badge() === null, "no badge before anything is edited");

// --- a flat delta on top of the copied stats --------------------------------
await setEdit("DEF", 50);
const withDef = await damage();
console.log(`    copied Orc Warrior, then +50 DEF : ${copied} -> ${withDef}`);
check(withDef != null && withDef < copied, "a flat DEF delta lowers your damage");
check(await badge() === "1 active", `the badge counts it (${await badge()})`);

// --- a reduction, which has no field of its own above -----------------------
await setEdit("DEF", 0);
await setEdit("All physical %", 50);
const withRes = await damage();
console.log(`    50% physical resist : ${copied} -> ${withRes}`);
check(withRes != null && Math.abs(withRes - Math.floor(copied / 2)) <= 2,
  `an enemy physical resistance halves your damage (${withRes} vs ~${Math.floor(copied / 2)})`);

// --- AGI must drag FLEE with it (it was inert; QA 2026-10-09) ---------------
await setEdit("All physical %", 0);
await setEdit("AGI", 400);
await damage();
const hitAfterAgi = await page.evaluate(() => {
  for (const c of document.querySelectorAll(".metric")) {
    if (c.querySelector(".label")?.textContent?.trim() === "Hit chance") {
      return c.querySelector(".value")?.textContent?.trim() ?? null;
    }
  }
  return null;
});
console.log(`    +400 AGI -> hit chance ${hitAfterAgi}`);
check(hitAfterAgi != null && parseFloat(hitAfterAgi) < 100,
  "editing AGI moves FLEE, so your hit chance drops");

// --- switching back to Monster must not carry the edits ---------------------
// The edits stay set in state; the panel is gone. If they still priced the monster,
// that is hidden state moving a number nobody can see.
//
// Leave a DAMAGE-affecting edit set, not just the AGI above: AGI moves hit chance
// and the comparison below is on damage, so a leak would have slipped through. (It
// did — the mutation run caught this assertion passing against a deliberate leak.)
await setEdit("AGI", 0);
await setEdit("All physical %", 50);
await page.getByRole("button", { name: "Monster" }).first().click();
await page.waitForTimeout(1200);
check(await panelShown() === 0, "the panel is gone again in Monster mode");
const monsterAgain = await damage();
console.log(`    back on the monster with edits still set : ${monsterAgain} (was ${monsterBaseline})`);
check(monsterAgain === monsterBaseline,
  "edits set in Custom stats do NOT follow you back to the monster");

// --- Reset, and the untouched path is unchanged -----------------------------
await page.getByRole("button", { name: "Custom stats" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^Reset$/ }).last().click();
await page.waitForTimeout(900);
check(await badge() === null, "Reset clears every edit");
const after = await damage();
console.log(`    after Reset : ${after} (copied baseline ${copied})`);
check(after === copied, "with nothing edited the damage is exactly the un-edited figure");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "manual-enemy-edits.png" });
console.log(ok ? "\nPASS - manual edits live in Custom stats and stay there." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
