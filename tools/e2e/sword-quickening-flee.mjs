// "knights sword quickening doesn't seem to increase flee in the calc" — Mihtsuki
// via Frennetix, 2026-10-11.
//
// PS's Sword Quickening (KN_TWOHANDQUICKEN) reads "+N FLEE, +N% CRIT" at every level
// in the skill planner; the calculator applied the CRIT and dropped the FLEE. The
// same tooltip also says "This skill only works with Sword class weapons and the
// effect cancels when switching to any other type of weapon", which the ASPD half
// honoured and the stat half did not — so a Knight holding a spear could tick the
// box and keep the crit.
//
// This reads the character stat cards the way a player does.
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
for (const l of blk.split("\n").slice(1)) {
  if (l.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of l.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

const CLAYMORE = 1163; // 2H sword
const PIKE = 1408;     // spear — the buff must cancel on it
const link = (weapon, buffs, job = 7) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: job, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 60, vit: 40, int: 20, dex: 50, luk: 20 },
    equipped: { right_hand: weapon }, active_buffs: buffs || {}, target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };
const num = (s) => Number(String(s ?? "").replace(/[^\d.]/g, ""));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The character stat cards, as labelled on screen.
const stats = async (weapon, buffs, job) => {
  await page.goto(link(weapon, buffs, job), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return page.evaluate(() => {
    // The editor has two .sec-stat-grid blocks — yours and the monster's — and both
    // carry a "Flee" card. Reading them together let the monster's 2 overwrite the
    // character's 161, which made this test fail against a working page.
    const grid = [...document.querySelectorAll(".sec-stat-grid")]
      .find((g) => /Max HP/.test(g.textContent || ""));
    const out = {};
    for (const c of (grid ? grid.querySelectorAll(".sec-stat-card") : [])) {
      const k = c.querySelector(".sec-stat-label")?.textContent?.trim();
      const v = c.querySelector(".sec-stat-value")?.textContent?.trim();
      if (k) out[k] = v;
    }
    return out;
  });
};

// === with a sword: FLEE and CRIT both move ================================
const swordOff = await stats(CLAYMORE, {});
const swordOn = await stats(CLAYMORE, { SC_TWOHANDQUICKEN: 10 });
console.log(`    2H sword  off: Flee ${swordOff.Flee}, Critical ${swordOff.Critical}`);
console.log(`    2H sword  on : Flee ${swordOn.Flee}, Critical ${swordOn.Critical}`);
check(num(swordOff.Flee) > 0, `fixture check: the readout shows a Flee (${swordOff.Flee})`);
check(num(swordOn.Flee) - num(swordOff.Flee) === 10,
  `Sword Quickening Lv10 adds 10 FLEE (${swordOff.Flee} \u2192 ${swordOn.Flee})`);
check(Math.abs((num(swordOn.Critical) - num(swordOff.Critical)) - 10) < 0.05,
  `and still adds its 10% CRIT (${swordOff.Critical} \u2192 ${swordOn.Critical})`);

// === with a spear: the buff does not exist ================================
const spearOff = await stats(PIKE, {});
const spearOn = await stats(PIKE, { SC_TWOHANDQUICKEN: 10 });
console.log(`    spear     off: Flee ${spearOff.Flee}, Critical ${spearOff.Critical}`);
console.log(`    spear     on : Flee ${spearOn.Flee}, Critical ${spearOn.Critical}`);
check(spearOn.Flee === spearOff.Flee,
  `a spear cancels it \u2014 no FLEE (${spearOff.Flee} both)`);
check(spearOn.Critical === spearOff.Critical,
  `and no CRIT either (${spearOff.Critical} both)`);

// === Spear Quicken is the other one, and keeps its own numbers ============
// On PS it is a CRUSADER skill (CR_SPEARQUICKEN), not a Knight one, so it has to be
// read on a Crusader — the editor rightly ignores it on a Knight.
const CRUSADER = 14;
const crOff = await stats(PIKE, {}, CRUSADER);
const crOn = await stats(PIKE, { SC_SPEARQUICKEN: 10 }, CRUSADER);
console.log(`    Crusader, Spear Quicken off: Flee ${crOff.Flee}, HIT ${crOff.HIT}, Critical ${crOff.Critical}`);
console.log(`    Crusader, Spear Quicken on : Flee ${crOn.Flee}, HIT ${crOn.HIT}, Critical ${crOn.Critical}`);
check(num(crOn.Flee) - num(crOff.Flee) === 10, `Spear Quicken Lv10 gives its own 10 FLEE (${crOff.Flee} → ${crOn.Flee})`);
check(num(crOn.HIT) - num(crOff.HIT) === 10, `and 10 HIT (${crOff.HIT} → ${crOn.HIT})`);
check(crOn.Critical === crOff.Critical, `and no CRIT, which PS took away (${crOff.Critical} both)`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - Sword Quickening gives FLEE, and only with a sword." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
