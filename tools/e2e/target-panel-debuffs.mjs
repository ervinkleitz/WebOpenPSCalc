// The Target panel shows four numbers that come in pairs, one per direction:
//   AGI  -> Flee      : the monster's own flee, what YOUR hit chance is measured against
//   DEX  -> Flee 95%  : the monster's HIT, i.e. the FLEE you need to dodge it
// Only the AGI half ever reflected your debuffs, so Quagmire looked like it was being
// deducted twice from one stat and not at all from the other, and the panel's "Flee 95%"
// disagreed with the dodge figure the survivability panel computes from the engine
// (reported 2026-09-22: "it seems to be applying to some weird duplicate flee value").
//
// Teddy Bear (1622): level 71, AGI 155, DEX 121, not a boss.
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
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

const page = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
await page.goto(shareLink({
  build: { job_id: 7, base_level: 99, job_level: 50, base_stats: { str: 90, agi: 60, vit: 80, int: 1, dex: 50, luk: 1 },
    equipped: { right_hand: 1101, armor: 2314 }, target_mob_id: 1622 },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const cards = () => page.evaluate(() => {
  const out = {};
  for (const c of document.querySelectorAll(".sec-stat-card")) {
    const l = c.querySelector(".sec-stat-label")?.textContent?.trim();
    const v = c.querySelector(".sec-stat-value")?.textContent?.replace(/\s+/g, " ").trim();
    if (l) out[l] = v;
  }
  return out;
});

const plain = await cards();
console.log("plain:      ", ["AGI", "DEX", "Flee", "Flee 95%", "HIT 100%"].map((k) => `${k}=${plain[k]}`).join("  "));
check(plain["Flee"] === "226" && plain["Flee 95%"] === "267", `undebuffed baseline moved: ${JSON.stringify(plain)}`);

await page.locator(".debuff-field", { has: page.locator("label", { hasText: /^Quagmire/ }) }).first()
  .locator("select").first().selectOption("5");
await page.waitForTimeout(700);
await page.locator(".field-checkbox", { has: page.locator("span", { hasText: /^Hypothermia/ }) }).first()
  .locator("input[type=checkbox]").first().check();
await page.waitForTimeout(700);

const after = await cards();
console.log("debuffed:   ", ["AGI", "DEX", "Flee", "Flee 95%", "HIT 100%"].map((k) => `${k}=${after[k]}`).join("  "));
// Quagmire Lv5 takes 10% per level: 155 - 77 = 78 AGI, 121 - 60 = 61 DEX; Hypothermia
// then takes a flat 10 DEX -> 51. Flee = 71 + AGI, Flee 95% = 71 + DEX + 75.
for (const [label, expected] of [
  ["AGI", "155 → 78"], ["DEX", "121 → 51"],
  ["Flee", "226 → 149"], ["Flee 95%", "267 → 197"], ["HIT 100%", "246 → 169"],
]) {
  check(after[label] === expected, `${label} should read "${expected}", got "${after[label]}"`);
}

// The point of the report: this panel and the survivability panel must agree, because
// both are the same monster's DEX. The dodge figure comes from the engine.
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(4500);
const dodge = (await page.locator(".surv-dodge").innerText().catch(() => "")).replace(/\s+/g, " ");
const need = dodge.match(/need (\d+) for 95%/);
console.log("survivability:", dodge);
check(!!need, `the survivability panel does not state the FLEE needed: "${dodge}"`);
if (need) {
  const shown = (after["Flee 95%"] || "").split("→").pop().trim();
  check(shown === need[1], `Target panel says ${shown}, survivability panel says ${need[1]} — same monster, same DEX`);
}

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
