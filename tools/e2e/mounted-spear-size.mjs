// "being mounted on a pecopeco with a spear doesn't give me 100% dmg to medium size
// monsters" — a player via Frennetix, 2026-10-07. It didn't:
//
//   if ((pc_isridingpeco(sd) || pc_isridingdragon(sd))
//    && (sd->weapontype == W_1HSPEAR || sd->weapontype == W_2HSPEAR))
//       sd->right_weapon.atkmods[1] = sd->right_weapon.atkmods[2];   // status.c:1856
//
// ...was never implemented. The flag WAS wired up for the ASPD penalty and for Spear
// Mastery's mounted ATK, so ticking the box moved those numbers and left the size
// penalty at 75% — which is what made it look deliberate rather than missing.
//
// Driven through the Riding Peco Peco checkbox a player actually clicks, reading the
// Size Fix line out of the damage breakdown.
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

const LANCE = 1410;          // 2HSpear
const TWOH_SWORD = 1163;     // control: riding must not touch it
const PORING = 1002;         // Medium

const link = (weapon, mob) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 40, vit: 50, int: 10, dex: 50, luk: 10 },
    equipped: { right_hand: weapon }, target_mob_id: mob,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The damage breakdown as rendered. Note the display label is "Size penalty", and a
// step that becomes a no-op (x1.0, running total unchanged) is deliberately hidden —
// so once the penalty is gone the row disappears rather than reading 100%. Both the
// row and the running total are checked, because "row vanished" alone would also be
// satisfied by the breakdown failing to render at all.
const track = () => page.evaluate(() => {
  const t = document.querySelector(".pl-track");
  return t ? t.innerText.replace(/\s+/g, " ") : null;
});
/** The last running total in the pipeline — the damage a player reads off the end.
 *  Taken from the running-total column (.pl-val), not by scraping the text, because
 *  the step notes are full of numbers of their own. */
const finalTotal = () => page.evaluate(() => {
  const vals = [...document.querySelectorAll(".pl-track .pl-step .pl-val")];
  if (!vals.length) return null;
  const t = vals[vals.length - 1].textContent.replace(/,/g, "");
  const m = [...t.matchAll(/\d+/g)].map(Number);
  return m.length ? m[m.length - 1] : null;      // a range reads "min–max"; take max
});

const run = async (weapon, riding) => {
  await page.goto(link(weapon, PORING), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  if (riding) {
    const box = page.getByRole("checkbox", { name: /Riding Peco Peco/i }).first();
    if (!(await box.count())) return { err: "no Riding Peco Peco checkbox" };
    await box.check();
    await page.waitForTimeout(2500);
  }
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5000);
  const txt = await track();
  return { txt, total: await finalTotal() };
};

const spearOff = await run(LANCE, false);
const spearOn = await run(LANCE, true);
check(spearOff.txt && spearOn.txt, "the damage breakdown rendered in both runs");
console.log(`    spear on foot : total ${spearOff.total}, size row ${/Size penalty/.test(spearOff.txt || "") ? "shown" : "absent"}`);
console.log(`    spear mounted : total ${spearOn.total}, size row ${/Size penalty/.test(spearOn.txt || "") ? "shown" : "absent"}`);

check(/Size penalty/.test(spearOff.txt || "") && /vs Medium target → 75%/.test(spearOff.txt || ""),
  "on foot the breakdown shows the spear taking the 75% Medium penalty");
check(!/vs Medium target → 75%/.test(spearOn.txt || ""),
  "mounted, the 75% Medium penalty is gone from the breakdown");
check(spearOff.total != null && spearOn.total != null && spearOn.total > spearOff.total,
  `and the damage actually rises (${spearOff.total} on foot -> ${spearOn.total} mounted)`);

// Control: riding must not touch a non-spear. Hercules rewrites only the spear rows.
const swordOff = await run(TWOH_SWORD, false);
const swordOn = await run(TWOH_SWORD, true);
console.log(`    2H sword      : ${swordOff.total} on foot -> ${swordOn.total} mounted`);
check(swordOff.total != null && swordOff.total === swordOn.total,
  `riding leaves a two-handed sword alone (${swordOff.total} either way)`);
check(/vs Medium target → 75%/.test(swordOn.txt || ""),
  "and the sword keeps its own Medium penalty while mounted");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "mounted-spear-size.png" });
console.log(ok ? "\nPASS - a mounted spear loses its Medium-size penalty." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
