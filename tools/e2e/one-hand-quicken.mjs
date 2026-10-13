// On Payon Stories, One-Hand Quicken is a dead skill and Sword Quickening covers
// both kinds of sword.
//
// Friekshow (CC), relayed 2026-10-12: "1 hand sword quickening does nothing, and wont
// exist in the future either. We made Sword Quickening to flat out work for both types
// of Swords. Just haven't deleted the old extra spirit link buff."
//
// So the calculator must not offer it on PS — it was a checkbox that handed out +30%
// ASPD a player can never have — and Sword Quickening must give the full 30% on a
// one-handed sword, where it used to give 10% (their planner tooltip still says "Works
// with One-Hand Sword for 30% the effect mentioned"; the ruling outranks it).
//
// Read off the character's own ASPD card, the way a player checks it.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const FE = new URL("file:///C:/Users/ervin/WebOpenPSCalc/open-ps-calc-frontend/frontend/");
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

// Knight, so both buffs would be offered. 1101 Sword (1H), 1163 Claymore (2H sword),
// 1408 Pike (spear).
const link = (weapon, buffs, server = "payon_stories") => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50, server,
    base_stats: { str: 90, agi: 60, vit: 40, int: 20, dex: 50, luk: 20 },
    equipped: { right_hand: weapon }, active_buffs: buffs || {}, target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The character's Combat stats grid — the monster has its own cards, so scope to the
// one carrying Max HP.
const load = async (weapon, buffs, server) => {
  await page.goto(link(weapon, buffs, server), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
};
const aspdNow = () => page.evaluate(() => {
  const grid = [...document.querySelectorAll(".sec-stat-grid")].find((g) => /Max HP/.test(g.textContent || ""));
  for (const c of (grid ? grid.querySelectorAll(".sec-stat-card") : [])) {
    if (c.querySelector(".sec-stat-label")?.textContent?.trim() === "ASPD") {
      return Number(c.querySelector(".sec-stat-value")?.textContent?.trim());
    }
  }
  return null;
});
const aspd = async (weapon, buffs, server) => { await load(weapon, buffs, server); return aspdNow(); };
const motion = (a) => (200 - a) * 10;   // ASPD = 200 − amotion/10

const SWORD_1H = 1101, CLAYMORE = 1163, PIKE = 1408;
const OHQ = { SC_ONEHANDQUICKEN: 1 };

// === it is not offered at all on PS =======================================
await load(SWORD_1H, {});
const offered = await page.locator(".field-checkbox", { hasText: "One-Hand Quicken" }).count();
console.log(`    "One-Hand Quicken" checkboxes on screen (PS, Knight, 1H sword): ${offered}`);
check(offered === 0, "PS does not offer One-Hand Quicken — the skill does nothing there");
check(await page.locator(".field-checkbox", { hasText: "Sword Quickening" }).count() > 0,
  "but Sword Quickening, which replaced it, is offered");

// === and a build that still carries it is not given the bonus =============
// Old share links and saved builds keep the key; it has to be inert, not honoured.
const swordBase = await aspd(SWORD_1H, {});
check(Number.isFinite(swordBase) && swordBase > 100, `fixture check: the ASPD card reads (${swordBase})`);
for (const [name, weapon] of [["a one-handed sword", SWORD_1H], ["a two-handed sword", CLAYMORE], ["a spear", PIKE]]) {
  const off = await aspd(weapon, {});
  const on = await aspd(weapon, OHQ);
  console.log(`    ${name}: ASPD ${off} with the stale buff ${on}`);
  check(on === off, `a build still carrying One-Hand Quicken gets nothing with ${name}`);
}

// === Sword Quickening is the full 30% on either sword =====================
for (const [name, weapon] of [["a one-handed sword", SWORD_1H], ["a two-handed sword", CLAYMORE]]) {
  const off = await aspd(weapon, {});
  const on = await aspd(weapon, { SC_TWOHANDQUICKEN: 10 });
  console.log(`    Sword Quickening with ${name}: ASPD ${off} -> ${on} (motion ${motion(off)}ms -> ${motion(on)}ms)`);
  check(Math.abs(motion(on) - motion(off) * 0.7) < 1,
    `it takes 30% off the attack motion with ${name} — the one-handed case used to be 10%`);
}
const pikeOff = await aspd(PIKE, {}), pikeOn = await aspd(PIKE, { SC_TWOHANDQUICKEN: 10 });
check(pikeOn === pikeOff, `and still nothing with a spear (${pikeOff} both)`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - One-Hand Quicken is gone on PS; Sword Quickening covers both swords." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
