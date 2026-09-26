// A player searched the headgear slot for "apple" and got four Apples of Archer, only
// one of which exists on Payon Stories (reported by Hsezka, 2026-09-26: "there is a
// bunch of unobtainable AoAs in calc, the correct one should be 2285").
//
// The duplicates are not harmless clutter: 2285 is Dex +3 with no DEF at level 30,
// while 5265 — sharing its name exactly — is Dex +4 with DEF 7 at level 1. Picking the
// wrong one quietly overstates damage and survivability at once. This asserts what the
// search box shows, because that is where the mistake gets made.
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

await page.goto(URL_BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const slot = (label) => page.locator(".field", { has: page.locator("label", { hasText: label }) }).first();

async function search(label, query) {
  const box = slot(label).locator("input").first();
  await box.fill("");
  await page.waitForTimeout(300);
  await box.fill(query);
  await page.waitForTimeout(1700);
  return page.evaluate(() => [...document.querySelectorAll(".search-result-item")]
    .map((r) => r.innerText.replace(/\s+/g, " ").trim()));
}

const rows = await search(/Headgear \(top\)/i, "apple");
console.log("headgear search for 'apple':", JSON.stringify(rows));

// The real one has to still be findable — hiding must not go too far.
check(rows.some((r) => /Apple of Archer/i.test(r) && /#?2285/.test(r)),
  `the real Apple of Archer (2285) must still be listed, got: ${JSON.stringify(rows)}`);

// ...and none of the three that Payon Stories does not have.
for (const gone of ["5265", "5649", "5731"]) {
  check(!rows.some((r) => r.includes(gone)),
    `item ${gone} is not on PS and must not be offered, got: ${JSON.stringify(rows)}`);
}
// No second row claiming to be an Apple of Archer.
const aoa = rows.filter((r) => /^Apple of Archer\b/i.test(r));
check(aoa.length === 1, `exactly one row should be named Apple of Archer, got ${aoa.length}: ${JSON.stringify(aoa)}`);

// Control: hiding is targeted, not a blanket cull of the slot.
const hats = await search(/Headgear \(top\)/i, "hat");
console.log(`control — 'hat' still returns ${hats.length} headgears`);
check(hats.length > 5, `the picker should still find plenty of hats, got ${hats.length}`);

// ---------------------------------------------------------------------------
// The follow-on report: "when i type app it picks happy wig". The picker used to
// auto-select whenever exactly one row was ENABLED — and on the default level-1
// build 57% of gear is below its level requirement, so a partial query greyed
// everything except one unrelated hat and silently equipped it. The Apple of
// Archer the player was reaching for is level 30: present, blocked, never seen.
// Auto-select now needs an unambiguous query, and a greyed row says why.
const partial = await search(/Headgear \(top\)/i, "app");
console.log("partial query 'app':", JSON.stringify(partial));
check(partial.length > 1, `"app" should list its matches, got ${JSON.stringify(partial)}`);
check(partial.some((r) => /Apple of Archer/i.test(r)),
  `the Apple of Archer must be visible even though it is level-gated, got ${JSON.stringify(partial)}`);
check(partial.some((r) => /Apple of Archer/i.test(r) && /LV\s*30/i.test(r)),
  `the greyed Apple of Archer should say why it is greyed, got ${JSON.stringify(partial)}`);

// Nothing may have been equipped by the act of typing.
const topSlot = slot(/Headgear \(top\)/i);
check((await topSlot.locator(".selected-pill").count()) === 0,
  "typing a partial query must not equip anything on its own");
check((await topSlot.locator("input").count()) > 0,
  "the search box must still be there — an auto-select would have replaced it with a pill");

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
