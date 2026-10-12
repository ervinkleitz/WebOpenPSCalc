// "Ardent helm doesn't give me card option" — a player via Frennetix, 2026-10-07,
// with an in-game tooltip screenshot.
//
// Ardent Helm (8417) is a Payon Stories custom the item API returns "No data" for, so
// its entry here was hand-written from the wiki's List of Custom Items and came out
// with slots: 0 — no card slot in the picker. The wiki had in fact named it "Ardent
// Helm [1]" all along, and the client's own item lookup agrees.
//
// The same screenshot filled in the rest of the item (Defense 3, Mdef +2, Weight 80)
// and settled what the entry had flagged as unknown: "Converts Magnum Break damage
// and weapon buff element to Holy" — so the lingering enchant turns Holy too, not
// just the skill's hit.
//
// Checked the way the player hit it: equip the helm and look for the card slot.
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

const ARDENT = 8417, SWORD = 1129;
const link = (equipped, extra = {}) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 14, base_level: 99, job_level: 50,                 // Crusader
    base_stats: { str: 80, agi: 40, vit: 50, int: 20, dex: 50, luk: 10 },
    equipped, target_mob_id: 1002, ...extra,
  },
  skill: { id: 7, level: 10, label: "Magnum Break" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 6000) => page.waitForTimeout(ms);

// --- the report: a card slot must be offered -------------------------------
await page.goto(link({ right_hand: SWORD, head_top: ARDENT }), { waitUntil: "domcontentloaded" });
await settle();
const cardsWith = await page.locator("input[placeholder^='Card slot']").count();

// Count again with the helm off: the difference is the helm's own slots, which keeps
// the check honest no matter how many the weapon contributes. It must be exactly 1 —
// the item is "Ardent Helm [1]", not [2].
await page.goto(link({ right_hand: SWORD }), { waitUntil: "domcontentloaded" });
await settle();
const cardsWithout = await page.locator("input[placeholder^='Card slot']").count();
check(cardsWith - cardsWithout === 1,
  `the helm contributes exactly one card slot (${cardsWithout} card inputs without it, ${cardsWith} with)`);

// --- the rest of the tooltip: DEF 3 and MDEF 2 -----------------------------
const stat = (lbl) => page.evaluate((l) => {
  for (const c of document.querySelectorAll(".sec-stat-card"))
    if (c.querySelector(".sec-stat-label")?.textContent?.trim() === l)
      return (c.querySelector(".sec-stat-value")?.textContent ?? "").trim();
  return null;
}, lbl);
// (the slot check above left the page on the no-helm build)
const defWithout = await stat("DEF"), mdefWithout = await stat("MDEF");
await page.goto(link({ right_hand: SWORD, head_top: ARDENT }), { waitUntil: "domcontentloaded" });
await settle();
const defWith = await stat("DEF"), mdefWith = await stat("MDEF");
const hard = (s) => Number(String(s || "0").split("+")[0]);
check(hard(defWith) - hard(defWithout) === 3, `the helm adds its Defense 3 (${defWithout} -> ${defWith})`);
check(hard(mdefWith) - hard(mdefWithout) === 2, `the helm adds its Mdef +2 (${mdefWithout} -> ${mdefWith})`);

// --- Magnum Break, and the weapon buff it leaves, both turn Holy -----------
// Poring is Water: Fire does 50% to it, Holy 100%, so the conversion doubles both
// the skill's hit and the lingering term.
const dmg = async (equipped) => {
  await page.goto(link(equipped, { active_buffs: { SC_SUB_WEAPONPROPERTY: 1 } }), { waitUntil: "domcontentloaded" });
  await settle();
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && /lingering (fire|holy)/i.test(e.textContent || ""));
    return el ? el.textContent.trim() : null;
  });
};
const lingerWithout = await dmg({ right_hand: SWORD });
const lingerWith = await dmg({ right_hand: SWORD, head_top: ARDENT });
console.log(`    lingering term without the helm: ${lingerWithout}`);
console.log(`    lingering term with the helm   : ${lingerWith}`);
check(/fire/i.test(lingerWithout || ""), "without the helm the lingering enchant is Fire");
check(/holy/i.test(lingerWith || ""), "with the helm the lingering weapon buff is Holy too, not just the skill");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "ardent-helm.png" });
console.log(ok ? "\nPASS - Ardent Helm matches the in-game tooltip." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
