// Holy Strike is a Priest PASSIVE (wiki: "Type: Passive Skill", 1 level, quest skill).
// It used to be reachable only as an ACTIVE pick, which priced a cast that doesn't exist,
// while the passive level that actually drives the proc could not be set from the page at
// all - so a Priest's own Holy Strike proc was unreachable. Player request, 2026-09-19.
// Driven entirely through the UI, the way a player sets it.
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

const b = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

// A Priest with a mace and NO Mummy cards, vs a Ghoul (Undead): the only way to a
// Holy Strike proc here is the passive itself.
const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
await page.goto(shareLink({
  build: { job_id: 8, base_level: 99, job_level: 50, base_stats: { str: 80, agi: 40, vit: 40, int: 30, dex: 40, luk: 30 },
    equipped: { right_hand: 1501 }, target_mob_id: 1036 },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// 1. It is in the Passive skills panel, capped at level 1.
const passivePanel = page.locator(".panel", { has: page.locator("h2", { hasText: /Passive skills/i }) }).first();
const hsField = passivePanel.locator(".field", { has: page.locator("label", { hasText: /^Holy Strike$/i }) }).first();
check(await hsField.count() === 1, "Holy Strike is not in the Priest's Passive skills panel");
const hsInput = hsField.locator("input").first();
const fieldText = (await hsField.innerText()).replace(/\s+/g, " ");
check(/\/\s*1\b/.test(fieldText), `Holy Strike should be capped at level 1, field reads: ${fieldText}`);

// 2. Setting it to 1 turns on the proc on auto-attacks.
const panelHead = async () => {
  const calc = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await calc.count()) { await calc.click(); await page.waitForTimeout(3000); }
  return page.evaluate(() => [...document.querySelectorAll(".breakdown-head")]
    .map((h) => h.innerText.replace(/\s+/g, " ")).find((t) => /Holy Strike/.test(t)) || null);
};
check(await panelHead() === null, "no Holy Strike proc should show before the passive is learned");
await hsInput.fill("1");
await page.waitForTimeout(800);
const head = await panelHead();
console.log("Holy Strike panel after learning it:", head);
check(head && /2\d% per melee attack/.test(head), `learning Holy Strike should show its 20% + LUK/10 proc, got: ${head}`);

// 3. It is no longer offered as an active skill to cast.
const sk = page.getByPlaceholder("Search skills…");
await sk.scrollIntoViewIfNeeded();
await sk.fill("holy strike");
await page.waitForTimeout(1500);
const offered = await page.locator(".search-result-item", { hasText: /Holy Strike/i }).count();
check(offered === 0, `Holy Strike should not be offered in the active skill search (found ${offered})`);

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
