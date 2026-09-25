// The three legality rules the 2026-09-24 QA sweep found the calculator holding in
// its data and never applying. All of them are worth a browser test rather than a
// unit test, because in every case the engine was only half the problem — the editor
// happily offered the illegal combination and said nothing.
//
//   1. A two-handed weapon (EQP_ARMS) fills both hands. A Claymore plus a four-Hydra
//      dagger in the off-hand read +80% damage vs Demi-Human.
//   2. An item's base-level requirement was never checked anywhere: a level-1
//      character wore a level-33 Claymore at full ATK.
//   3. A skill's weapon requirement was never checked: Double Strafe priced happily
//      with a dagger.
//
// Target: Orc Warrior (1023), Demi-Human, so the Hydra cards would bite if they loaded.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
function shareLink(state) {
  const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
  const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_left", "accessory_right"];
  const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
  const keys = [];
  for (const line of block.split("\n").slice(1)) {
    if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
    for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
  }
  const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
  const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object") ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
  return `${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1600 } });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

const page = await ctx.newPage();
const build = (over) => ({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 99, agi: 60, vit: 60, int: 1, dex: 90, luk: 1 },
    equipped: {}, target_mob_id: 1023, ...over,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
});

async function load(state) {
  await page.goto(shareLink(state), { waitUntil: "networkidle" });
  await page.waitForTimeout(2400);
}
async function damage() {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(4500);
  const t = (await page.locator(".metric-range .value").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  const n = [...t.matchAll(/([\d,]+)\s*(?:min|max)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
  return n.length === 2 ? (n[0] + n[1]) / 2 : null;
}
const slotField = (label) => page.locator(".field", { has: page.locator("label", { hasText: label }) }).first();

// ------------------------------------------------- 1. two-handed fills both hands
const HYDRA_OFFHAND = {
  left_hand: 1208, left_hand_card1: 4035, left_hand_card2: 4035, left_hand_card3: 4035, left_hand_card4: 4035,
};
await load(build({ equipped: { right_hand: 1163 } }));
const claymoreAlone = await damage();
const offHandText = (await slotField(/Left hand/i).innerText()).replace(/\s+/g, " ");
console.log("two-handed, empty off-hand slot reads:", JSON.stringify(offHandText));
check(/no off-hand/i.test(offHandText),
  `the off-hand slot should explain itself under a two-hander, got "${offHandText}"`);
check(!(await slotField(/Left hand/i).locator("input").count()),
  "no search box should be offered for a hand you do not have");

await load(build({ equipped: { right_hand: 1163, ...HYDRA_OFFHAND } }));
const claymorePlusHydras = await damage();
const lhPill = (await slotField(/Left hand/i).innerText()).replace(/\s+/g, " ");
console.log(`Claymore alone ${claymoreAlone}  |  + 4x Hydra dagger off-hand ${claymorePlusHydras}`);
console.log("  off-hand slot:", JSON.stringify(lhPill));
check(claymoreAlone != null && claymorePlusHydras === claymoreAlone,
  `an off-hand under a two-hander must add nothing (${claymoreAlone} vs ${claymorePlusHydras})`);
check(/two-handed/i.test(lhPill), `the slot must say why it is excluded, got "${lhPill}"`);
check(!!(await slotField(/Left hand/i).locator(".selected-pill--invalid").count()),
  "the off-hand pill must be flagged invalid");

// A ONE-handed weapon is the control: the off-hand must still work.
await load(build({ equipped: { right_hand: 1129 } }));
const oneHandAlone = await damage();
await load(build({ equipped: { right_hand: 1129, ...HYDRA_OFFHAND } }));
const oneHandPlus = await damage();
console.log(`one-handed control: alone ${oneHandAlone}  |  + Hydras ${oneHandPlus}`);
check(oneHandPlus > oneHandAlone,
  `a one-handed weapon must keep its off-hand (${oneHandAlone} -> ${oneHandPlus})`);

// ------------------------------------------------------- 2. level requirement
await load({ ...build({ equipped: { right_hand: 1163 } }), build: { ...build({ equipped: { right_hand: 1163 } }).build, base_level: 1, job_level: 1, base_stats: { str: 9, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 } } });
const rhText = (await slotField(/Right hand/i).innerText()).replace(/\s+/g, " ");
console.log("level 1 wearing a level 33 Claymore:", JSON.stringify(rhText));
check(/base level 33/i.test(rhText), `the slot must name the level it needs, got "${rhText}"`);
check(!!(await slotField(/Right hand/i).locator(".selected-pill--invalid").count()),
  "an item you are too low for must be flagged invalid");

// ------------------------------------------------- 3. skill's weapon requirement
const notice = () => page.locator(".notice.warn").first().innerText().catch(() => "");
// Hunter holding a DAGGER (which a Hunter really can wear, so the slot itself is
// legal and the only thing wrong is the skill), asking for Double Strafe.
await load({ ...build({ equipped: { right_hand: 1208 } }), build: { ...build({ equipped: { right_hand: 1208 } }).build, job_id: 11 } });
await page.locator(".search-combo input").last().fill("Double Strafing");
await page.waitForTimeout(1800);
const warnDagger = (await notice()).replace(/\s+/g, " ");
console.log("Double Strafe with a dagger:", JSON.stringify(warnDagger));
check(/needs a Bow/i.test(warnDagger), `expected a bow warning, got "${warnDagger}"`);
check(/Main Gauche/i.test(warnDagger), `it should name the weapon you are actually holding, got "${warnDagger}"`);

// ...and with the right weapon there is nothing to say.
await load({ ...build({ equipped: { right_hand: 1718 } }), build: { ...build({ equipped: { right_hand: 1718 } }).build, job_id: 11 } });
await page.locator(".search-combo input").last().fill("Double Strafing");
await page.waitForTimeout(1800);
const warnBow = (await notice()).replace(/\s+/g, " ");
console.log("Double Strafe with a bow:", JSON.stringify(warnBow) || "(none)");
check(!/needs a Bow/i.test(warnBow), `a bow must not warn, got "${warnBow}"`);

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
