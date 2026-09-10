// Swapping a carded SLOTTED item for an UNSLOTTED one must drop the card — it used
// to stay applied while the editor showed no card row (reported by Laila).
import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const state = {
  build: { name: "e2e", job_id: 7, job_name: "Knight", base_level: 99, job_level: 50,
    base_stats: { str: 60, agi: 40, vit: 60, int: 1, dex: 40, luk: 1 },
    bonus_stats: {}, equipped: { right_hand: 1119, armor: 2302, armor_card1: 4003 }, // Cotton Shirt[1] + Pupa (+700 HP)
    refine: {}, forge: {}, mastery_levels: {}, target_mob_id: 1002, server: "payon_stories",
    consumable_buffs: {}, active_buffs: {}, song_state: {}, wildcard_slots: {} },
  skill: { id: 0, level: 1, label: "Normal Attack", max_level: 10 },
  targetMode: "monster", customTarget: {}, targetMods: {},
};
const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1400, height: 1200 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate((s) => sessionStorage.setItem("opscalc.draft", JSON.stringify({ state: s, sourceParam: null })), state);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2200);

const armorField = () => page.locator(".field", { has: page.locator("label", { hasText: /^Armor$/ }) }).first();
const hpText = async () => {
  // The character-stats readout renders a "Max HP" label with its value next to it.
  const body = await page.locator("body").innerText();
  const m = body.match(/Max HP[^0-9]{0,12}([\d,]+)/i);
  return m ? m[1].replace(/,/g, "") : null;
};
let ok = true;
const before = await hpText();
const hadCard = await armorField().locator(".selected-pill", { hasText: /Pupa/ }).count();
console.log("start: HP", before, "| Pupa card shown:", !!hadCard);
if (!hadCard) { console.error("FAIL setup: card not slotted"); ok = false; }

// Swap the armor for an UNSLOTTED one (Jacket, 0 slots).
await armorField().locator("button", { hasText: "Unequip" }).click();
await page.waitForTimeout(600);
await armorField().locator("input[placeholder^='Search ']").fill("Jacket");
await page.waitForTimeout(900);
const row = page.locator(".search-results .search-result-item:not(.disabled)").first();
await row.click();
await page.waitForTimeout(2500);

const after = await hpText();
const stillCard = await armorField().locator(".selected-pill", { hasText: /Pupa/ }).count();
console.log("after swap to unslotted Jacket: HP", after, "| Pupa still applied:", !!stillCard);
if (stillCard) { console.error("FAIL: the card survived onto an unslotted item"); ok = false; }
if (before && after && Number(after) >= Number(before)) {
  console.error(`FAIL: HP did not drop (${before} -> ${after}) — the +700 card is still counted`); ok = false;
}
console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
