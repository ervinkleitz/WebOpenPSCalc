// "Can't modify stats of existing monster so we need to make a custom one from
// scratch" — the maintainer, 2026-10-08, asking for the selected monster's stats to
// be copyable into the custom target.
//
// Typing twelve fields in by hand to ask "what if this thing had more DEF" is the
// thing being removed, so the test is: pick a monster, copy it, and every field must
// match what the monster actually has.
//
// Orc Warrior (1023) is the deliberate choice — its race is "DemiHuman" in the
// vanilla mob DB and "Demi-Human" in the race dropdown and every race bonus. If the
// copy ever stops going through the loader's MOB_RACE_ALIASES normalisation, the
// select lands on a value it has no option for and silently reads blank.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const API_BASE = process.argv[3] || "http://localhost:4000";
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

const ORC_WARRIOR = 1023;
const link = (mobId) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 80, agi: 40, vit: 40, int: 10, dex: 50, luk: 10 },
    equipped: { right_hand: 1129 }, target_mob_id: mobId,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

// What the monster actually is, straight from the API the editor itself reads.
const mob = await (await fetch(`${API_BASE}/api/data/mobs/${ORC_WARRIOR}?server=payon_stories`)).json();
console.log(`${mob.name}: lvl ${mob.level}, DEF ${mob.def_}, MDEF ${mob.mdef}, ${mob.size} ${mob.race}, `
  + `ele ${mob.element}/${mob.element_level}, VIT ${mob.stats.vit} AGI ${mob.stats.agi} LUK ${mob.stats.luk} INT ${mob.stats.int}\n`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(link(ORC_WARRIOR), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6500);

// Switch to Custom stats — the monster must still be remembered over there.
await page.getByRole("button", { name: "Custom stats" }).click();
await page.waitForTimeout(1500);

const copyBtn = page.getByRole("button", { name: new RegExp(`Copy ${mob.name}'s stats`) }).first();
check(await copyBtn.count() > 0, `the copy button names the selected monster ("Copy ${mob.name}'s stats")`);

// Read a labelled field out of the custom panel.
const fieldVal = (label) => page.evaluate((l) => {
  for (const f of document.querySelectorAll(".field")) {
    const lab = f.querySelector("label");
    if (!lab || lab.textContent.trim() !== l) continue;
    const el = f.querySelector("input, select");
    return el ? el.value : null;
  }
  return null;
}, label);

const before = await fieldVal("DEF");
await copyBtn.click();
await page.waitForTimeout(1500);

const expected = {
  DEF: String(mob.def_), MDEF: String(mob.mdef), VIT: String(mob.stats.vit),
  Level: String(mob.level), AGI: String(mob.stats.agi), LUK: String(mob.stats.luk),
  Size: mob.size, Race: mob.race,
  Element: String(mob.element), "Element level": String(mob.element_level),
};
for (const [label, want] of Object.entries(expected)) {
  const got = await fieldVal(label);
  check(got === want, `${label} copied as ${JSON.stringify(got)} (monster has ${JSON.stringify(want)})`);
}
check(before !== expected.DEF || mob.def_ === 0, `DEF actually changed (was ${before})`);

// The race select must have landed on a real option, not an unmatched value — the
// "DemiHuman" vs "Demi-Human" trap this monster was chosen for.
const raceOk = await page.evaluate(() => {
  for (const f of document.querySelectorAll(".field")) {
    if (f.querySelector("label")?.textContent?.trim() !== "Race") continue;
    const sel = f.querySelector("select");
    if (!sel) return null;
    return { value: sel.value, matched: [...sel.options].some((o) => o.value === sel.value) };
  }
  return null;
});
check(raceOk && raceOk.matched, `the Race dropdown holds a selectable option (${JSON.stringify(raceOk)})`);

// And the copied target must actually price: same damage as hitting the monster
// itself, since the stats are now identical.
const dmg = async () => {
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const vals = [...document.querySelectorAll(".pl-track .pl-step .pl-val")];
    if (!vals.length) return null;
    const m = [...vals[vals.length - 1].textContent.replace(/,/g, "").matchAll(/\d+/g)].map(Number);
    return m.length ? m[m.length - 1] : null;
  });
};
const custom = await dmg();
await page.getByRole("button", { name: "Monster" }).first().click();
await page.waitForTimeout(1500);
const real = await dmg();
console.log(`    damage vs the copied custom target: ${custom} | vs the monster itself: ${real}`);
check(custom != null && custom === real,
  "a copied target prices identically to the monster it came from");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "custom-target-copy-mob.png" });
console.log(ok ? "\nPASS - a monster's stats can be copied into the custom target." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
