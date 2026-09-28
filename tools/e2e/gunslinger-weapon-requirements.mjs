// Jenard, relayed by Frennetix on 2026-09-27: "wounding shot works with shotgun too".
//
// He was reporting a warning WE had just introduced. Holding a Black Rose (13155, a
// Shotgun), picking Wounding Shot, the editor said:
//
//   "Wounding Shot needs a Revolver or a Rifle — you are holding Black Rose.
//    The numbers below assume you could cast it."
//
// That came from the vanilla skill DB. Payon Stories' own client description for
// Wounding Shot names no weapon at all, and the Gunslinger tree states restrictions
// as a convention — 10 of its 22 descriptions carry an explicit weapon line — so the
// silence is the rule, not an omission. Disarm (all five gun types) and Dust
// (Shotgun or Grenade Launcher) were narrowed the same way.
//
// This test is in a browser because the engine was never the whole story: the warning
// a player actually sees is rendered by the editor off the /data route, so a green
// unit test proves nothing about the sentence on the screen.
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

// One gun of each class, so the report's case and its neighbours are all covered.
const GUNS = {
  "Six Shooter": 13100,   // Revolver
  Branch: 13150,          // Rifle
  "Black Rose": 13155,    // Shotgun — the weapon in the report
  Drifter: 13157,         // Gatling
  Destroyer: 13160,       // Grenade Launcher
};

const state = (weaponId) => ({
  build: {
    job_id: 24, base_level: 99, job_level: 50,
    base_stats: { str: 40, agi: 90, vit: 40, int: 40, dex: 90, luk: 40 },
    equipped: { right_hand: weaponId }, target_mob_id: 1023,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
});

// The Skill panel's pill — "Wounding Shot Lv.5" — i.e. the skill being priced.
const skillPill = page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Skill$/ }) })
  .locator(".selected-pill span").first();

// Both phrasings of the weapon warning, and nothing else that can appear in a
// .notice.warn (DamageSummary uses the same class for calculation notes).
const isWeaponWarning = (t) => /you are holding|while holding/i.test(t);

async function warningFor(weaponId, skillLabel) {
  await page.goto(shareLink(state(weaponId)), { waitUntil: "networkidle" });
  await page.waitForTimeout(2400);
  const box = page.locator(".search-combo input").last();
  await box.fill(skillLabel);
  await page.waitForTimeout(1800);
  // Typing is not selecting. The search box CLEARS on select and the choice moves to
  // the Skill panel's pill, so that pill is the only honest read of what is actually
  // being priced. Without this check every "must not warn" assertion below passes
  // when the skill was never selected — which is how the first draft of this file
  // asserted five things about Disarm, a skill the picker does not even offer.
  const selected = (await skillPill.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(selected.toLowerCase().includes(skillLabel.toLowerCase()),
    `the picker should have selected "${skillLabel}", the Skill panel shows "${selected}"`);
  const t = await page.locator(".notice.warn").first().innerText().catch(() => "");
  return t.replace(/\s+/g, " ").trim();
}

// ------------------------------------------------ the report, verbatim
const reported = await warningFor(GUNS["Black Rose"], "Wounding Shot");
console.log("Wounding Shot + Black Rose (Shotgun):", JSON.stringify(reported) || "(no warning)");
check(!isWeaponWarning(reported),
  `Wounding Shot with a Shotgun must not warn, got "${reported}"`);

// ------------------------------------------------ and every other gun
for (const [gunName, id] of Object.entries(GUNS)) {
  const w = await warningFor(id, "Wounding Shot");
  console.log(`  Wounding Shot + ${gunName}:`, JSON.stringify(w) || "(none)");
  check(!isWeaponWarning(w),
    `Wounding Shot with ${gunName} must not warn, got "${w}"`);
}

// ------------------------------------------------ the neighbour a player can reach
// Disarm was narrowed the same way (PS lists all five gun types, we allowed two) and
// is fixed with it, but it deals no damage so the skill picker never offers it and
// there is no warning for a player to see. Its coverage is the unit test; asserting
// it here would only look like coverage.
const dustGrenade = await warningFor(GUNS.Destroyer, "Dust");
console.log("  Dust + Destroyer (Grenade Launcher):", JSON.stringify(dustGrenade) || "(none)");
check(!isWeaponWarning(dustGrenade),
  `Dust takes a Grenade Launcher, got "${dustGrenade}"`);

// ------------------------------------------------ the warning still has teeth
// If loosening the rule silenced the real restrictions too, the feature would be
// worthless rather than merely wrong — so the negative cases are the point.
const NEGATIVE = [
  ["Desperado", GUNS["Black Rose"], /Revolver/i],   // Revolver only
  ["Full Buster", GUNS["Six Shooter"], /Shotgun/i], // Shotgun only
  ["Dust", GUNS["Six Shooter"], /Shotgun/i],        // Shotgun or Grenade Launcher
  ["Tracking", GUNS.Drifter, /Revolver|Rifle/i],    // Revolver or Rifle
];
for (const [skill, weapon, needle] of NEGATIVE) {
  const w = await warningFor(weapon, skill);
  console.log(`  ${skill} with the wrong gun:`, JSON.stringify(w) || "(none)");
  check(isWeaponWarning(w) && needle.test(w),
    `${skill} must still warn and name what it needs, got "${w}"`);
}

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
