// "Drill's Spiral Pierce seems to be hitting me for less... I just got hit for
// 765 x 5 (3825) when the calculated value says 4165 should be the minimum"
// — Laila Braveheart via Frennetix, 2026-10-10, with Metan's build link
// (openpscalc.com/?s=oY1cMgo), reproduced below.
//
// The Survivability panel was adding the PLAYER's base-ATK formula — str +
// (str/10)² — to every monster's hit. On a Drill (STR 90) that is +171 per hit,
// which is what put the quoted minimum above a hit the player had taken. Hercules
// gives a monster no base ATK at all (status_base_atk returns 0 outside
// battle_config.enable_baseatk, default BL_PC|BL_HOM); Spiral Pierce's own case
// separately adds (STR/10)² = 81, and that part is real.
//
// This test holds the panel to the player's own observation: the figure it prints
// has to be able to produce the hit they actually took.
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

// Laila's build, exactly as shared in the report. The in-game run differed only in
// base level (98), 3 AGI and a +4 Matyr footgear — none of which touch this number:
// Spiral Pierce ignores DEF, so only the %-resists on this gear matter, and those
// are the same ("everything else applies").
const BUILD = {
  name: "DD SIn", job_id: 12, base_level: 99, job_level: 50,
  base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59 },
  bonus_stats: { str: 0 },
  equipped: {
    head_top: 5141, head_mid: 5068, head_low: 8275, armor: 81008, garment: 2502, shoes: 2402,
    accessory_left: 2621, accessory_right: 2621, right_hand: 1220, left_hand: 1208,
    head_top_card1: 4206, armor_card1: 90002, garment_card1: 4375, shoes_card1: 8216,
    accessory_left_card1: 4079, accessory_right_card1: 4079,
    right_hand_card1: -3, right_hand_card2: -3, right_hand_card3: -3,
    left_hand_card1: -2, left_hand_card2: -2, left_hand_card3: -2, left_hand_card4: -2,
  },
  refine: { armor: 4, garment: 8, shoes: 8, right_hand: 7, left_hand: 7, head_top: 4 },
  target_mob_id: 25017, // DRILL
  consumable_buffs: { aspd_potion: 3 },
  mastery_levels: { AS_ENCHANTPOISON: 5, AS_LEFT: 5, AS_RIGHT: 5, TF_DOUBLE: 10, TF_MISS: 10, AS_SONICBLOW: 0 },
  support_buffs: { SC_INC_AGI: 10, SC_BLESSING: 10, weapon_endow_sc: "SC_PROPERTYWATER" },
  selected_pet: "yser", clan: "vile_wind_clan",
};
const link = `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({ build: BUILD, targetMode: "monster" })));

// What the player took, in game: five hits of 765.
const OBSERVED_PER_HIT = 765;
const OBSERVED_CAST = 3825;

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };
const ints = (s) => [...String(s ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2200 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(link, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await page.getByRole("button", { name: "Calculate damage" }).click();
await page.waitForTimeout(6000);

// The panel must be the one from the report.
const title = await page.locator(".surv-title").first().textContent().catch(() => null);
console.log(`    ${title}`);
check(/DRILL/i.test(title || ""), `the Survivability panel is vs DRILL (${title})`);

// Its basic melee, for context in the log — and to catch the whole panel vanishing.
const basic = await page.locator(".surv-line").first().locator(".surv-line-dmg").textContent().catch(() => null);
console.log(`    basic melee: ${basic}`);
check(ints(basic).length >= 1, `the basic attack line still prices (${basic})`);

// Tap the cast that was reported.
const chip = page.getByRole("button", { name: /Spiral_?Pierce/i }).first();
check(await chip.count() > 0, "Drill's Spiral Pierce is in the skill kit");
await chip.click();
await page.waitForTimeout(4000);

const detail = await page.locator(".surv-skill-detail").textContent();
const dmgText = await page.locator(".surv-skill-detail .surv-line-dmg").first().textContent();
console.log(`    Spiral Pierce: ${dmgText?.replace(/\s+/g, " ").trim()}`);
check(/5 hits/.test(detail || ""), "and it is priced as a 5-hit cast");

const [min, max] = ints(dmgText);
check(Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min,
  `it quotes a range (${min}\u2013${max})`);

// The point of the whole fix: the number the player actually took has to be inside
// the range the panel prints. Before it, the stated minimum was 4165 — above a hit
// they had already survived.
check(min <= OBSERVED_CAST,
  `the ${OBSERVED_CAST} cast the player took (${OBSERVED_PER_HIT}\u00d75) is not below the quoted minimum (${min})`);
check(max >= OBSERVED_CAST,
  `and not above the quoted maximum (${max})`);
// A range so wide it swallows anything would pass the line above on nothing: the
// observed hit must sit in the LOW part of it, which is where a 765 roll belongs.
check(OBSERVED_CAST - min < (max - min) / 2,
  `and sits low in the range, as a near-floor roll should (${min} \u2013 ${OBSERVED_CAST} \u2013 ${max})`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - a monster's hit is its own ATK, and the reported cast is inside the range." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
