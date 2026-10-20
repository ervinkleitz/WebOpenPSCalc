// Shield wildcard mix (ROADMAP #3, maintainer request 2026-09-06).
//
// The "Wildcard mix" answers "what would the right card be worth here?" without
// making you find the card. It was weapon-only, and so offensive-only — yet a
// shield's one slot is where the biggest DEFENSIVE decision on a build lives.
// This drives the shield mix through the page: the toggle has to appear on a
// slotted shield, offer resist categories rather than damage ones, and the
// resist has to come out the other end as a smaller hit on the survivability
// panel. The engine assertion (engine-units: "shield wildcard mix") proves the
// number reaches incoming damage; this proves a player can get at it.
//
// Why both: bSubSize was aggregated into a dict nothing read until 2026-08-17.
// A dict being populated is not evidence of anything arriving.
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
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};
const num = (s) => Number(String(s).replace(/,/g, ""));

// 2104 Buckler [1] in the off-hand; 1208 (Brute, Wind, Medium, lv74) hits hard
// enough to measure. A Knight so the off-hand is unambiguously a shield, and a
// Falchion [3] in the main hand so step 6 has a weapon mix to compare against -
// the toggle is offered only on a host that has slots, and most named swords
// (Flamberge, Nagan) have none.
const BUILD = {
  build: {
    job_id: 7, base_level: 90, job_level: 50,
    base_stats: { str: 70, agi: 40, vit: 60, int: 20, dex: 50, luk: 10 },
    equipped: { right_hand: 1104, armor: 2314, left_hand: 2104 },
    target_mob_id: 1208,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
};

const page = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
await page.goto(shareLink(BUILD), { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const calculate = async () => {
  const b = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(4000); }
};
const basicHit = async () => {
  const line = (await page.locator(".surv-line").allInnerTexts())
    .map((t) => t.replace(/\s+/g, " ")).find((t) => /basic/i.test(t));
  const m = line && line.match(/([\d,]+)(?:–([\d,]+))?\s*\/ hit/);
  return m ? { lo: num(m[1]), hi: m[2] ? num(m[2]) : num(m[1]) } : null;
};

const slotOf = (label) => page.locator(".equip-slot").filter({ hasText: label });
const shield = slotOf("Left hand");
await shield.locator(".equip-slot-head").click();
await page.waitForTimeout(600);

// ---- 1. the toggle is offered on a shield at all --------------------------
const toggle = shield.locator(".card-mode-toggle");
check(await toggle.count() === 1, "a slotted shield offers the Cards / Wildcard mix toggle");

await calculate();
const before = await basicHit();
check(!!before, "the survivability panel gives a basic-attack line to measure", before);

// ---- 2. its categories are resists, not damage ----------------------------
await toggle.getByRole("button", { name: /wildcard mix/i }).click();
await page.waitForTimeout(600);
const cats = await shield.locator(".wildcard-slot-row select").first()
  .locator("option").allInnerTexts();
check(JSON.stringify(cats) === JSON.stringify(["Race resist", "Element resist", "Size resist"]),
  "a shield mixes resists, not damage", cats);
const amounts = await shield.locator(".wildcard-slot-row select").nth(1).locator("option").allInnerTexts();
check(amounts.every((a) => a.startsWith("-")), "the amounts read as resists", amounts);

// ---- 3. one slot, because a Buckler has one -------------------------------
check(await shield.locator(".wildcard-slot-row").count() === 1,
  "a Buckler [1] gets exactly one wildcard row",
  await shield.locator(".wildcard-slot-row").count());

// ---- 4. the default is PS's own race-resist number, and it BITES ----------
const picked = await shield.locator(".wildcard-slot-row select").nth(1).inputValue();
check(picked === "30", "race resist defaults to 30 — Thara Frog and nine more agree", picked);
await calculate();
const after = await basicHit();
const ratio = after && before ? after.hi / before.hi : 0;
check(Math.abs(ratio - 0.70) < 0.02,
  `30% race resist must take 30% off the hit (${before?.hi} -> ${after?.hi})`,
  `${(ratio * 100).toFixed(1)}%`);

// ---- 5. element resist is its own axis ------------------------------------
await shield.locator(".wildcard-slot-row select").first().selectOption("sub_ele");
await page.waitForTimeout(400);
const elePct = await shield.locator(".wildcard-slot-row select").nth(1).inputValue();
check(elePct === "20", "element resist defaults to 20 — the Tatacho line", elePct);
await calculate();
const eleHit = await basicHit();
const eleRatio = eleHit && before ? eleHit.hi / before.hi : 0;
check(Math.abs(eleRatio - 0.80) < 0.02,
  `20% element resist must take 20% off (${before?.hi} -> ${eleHit?.hi})`,
  `${(eleRatio * 100).toFixed(1)}%`);

// ---- 6. the weapon mix is untouched and still offensive -------------------
const weapon = slotOf("Right hand");
await weapon.locator(".equip-slot-head").click();
await page.waitForTimeout(500);
await weapon.locator(".card-mode-toggle").getByRole("button", { name: /wildcard mix/i }).click();
await page.waitForTimeout(500);
const wCats = await weapon.locator(".wildcard-slot-row select").first().locator("option").allInnerTexts();
check(JSON.stringify(wCats) === JSON.stringify(["Race", "Size", "Element", "Type"]),
  "a weapon still mixes damage, not resists", wCats);

const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.waitForTimeout(300);
check(errs.length === 0, "no page errors", errs);

await page.close();
await browser.close();
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
