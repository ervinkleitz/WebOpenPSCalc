// One-Hand Quicken is +30% ASPD, and only with a one-handed sword in hand.
//
// Asked 2026-10-11. The magnitude is Hercules' `case SC_ONEHANDQUICKEN: case
// SC_TWOHANDQUICKEN: val2 = 300;` — flat and unlevelled. The weapon half was
// missing here: the calculator applied it to whatever was equipped, so a Knight
// holding a Pike ticked the box and kept +30% ASPD. The skill DB has required
// "1HSwords" all along, and the PS planner says what follows from it —
// "Unequipping Sword will cancel this skill's effect."
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

// Knight, so the buff is offered at all. 1101 Sword (1H), 1163 Claymore (2H sword),
// 1408 Pike (spear).
const link = (weapon, buffs) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
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
const aspd = async (weapon, buffs) => {
  await page.goto(link(weapon, buffs), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return page.evaluate(() => {
    const grid = [...document.querySelectorAll(".sec-stat-grid")].find((g) => /Max HP/.test(g.textContent || ""));
    for (const c of (grid ? grid.querySelectorAll(".sec-stat-card") : [])) {
      if (c.querySelector(".sec-stat-label")?.textContent?.trim() === "ASPD") {
        return Number(c.querySelector(".sec-stat-value")?.textContent?.trim());
      }
    }
    return null;
  });
};
const motion = (a) => (200 - a) * 10;   // ASPD = 200 − amotion/10

const SWORD_1H = 1101, CLAYMORE = 1163, PIKE = 1408;
const OHQ = { SC_ONEHANDQUICKEN: 1 };

// === a one-handed sword: the buff is up, and it is 30% ====================
const swordOff = await aspd(SWORD_1H), swordOn = await aspd(SWORD_1H, OHQ);
console.log(`    1H sword: ASPD ${swordOff} -> ${swordOn} (attack motion ${motion(swordOff)}ms -> ${motion(swordOn)}ms)`);
check(Number.isFinite(swordOff) && swordOff > 100, `fixture check: the ASPD card reads (${swordOff})`);
check(swordOn > swordOff, "One-Hand Quicken speeds up a one-handed sword");
check(Math.abs(motion(swordOn) - motion(swordOff) * 0.7) < 1,
  `by 30% of the attack motion (${motion(swordOff)}ms \u2192 ${motion(swordOn)}ms)`);

// === anything else: the buff cannot be up =================================
for (const [name, weapon] of [["a two-handed sword", CLAYMORE], ["a spear", PIKE]]) {
  const off = await aspd(weapon), on = await aspd(weapon, OHQ);
  console.log(`    ${name}: ASPD ${off} -> ${on}`);
  check(on === off, `${name} gets nothing \u2014 the skill needs a one-handed sword (${off} vs ${on})`);
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - One-Hand Quicken is +30% ASPD, one-handed swords only." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
