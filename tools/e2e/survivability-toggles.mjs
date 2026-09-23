// Four survivability reports from one player (2026-09-22), driven through the page:
//   - Energy Coat was missing entirely; it soaks 30% of physical damage at full SP.
//   - Alice Card's boss resistance worked on magic but not on a monster's melee.
//   - Quagmire's DEX cut never reached the monster's HIT, so your dodge never moved.
//   - Hypothermia had no control anywhere.
// Plus the maintainer's ruling that Amplify Magic Power is High Wizard only.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
const num = (s) => Number(String(s).replace(/,/g, ""));

const open = async (state) => {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
  await page.goto(shareLink(state), { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return page;
};
const calculate = async (page) => {
  const b = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(4000); }
};
// The survivability line for the monster's plain attack: "<N>-<M> / hit".
const basicHit = async (page) => {
  const line = (await page.locator(".surv-line").allInnerTexts())
    .map((t) => t.replace(/\s+/g, " ")).find((t) => /basic/i.test(t));
  const m = line && line.match(/([\d,]+)(?:–([\d,]+))?\s*\/ hit/);
  return m ? { lo: num(m[1]), hi: m[2] ? num(m[2]) : num(m[1]), line } : null;
};
const dodgePct = async (page) => {
  const t = (await page.locator(".surv-dodge").innerText().catch(() => "")).replace(/\s+/g, " ");
  const m = t.match(/(\d+)%/);
  return m ? Number(m[1]) : null;
};

const WIZARD = (extra = {}) => ({
  build: { job_id: 9, base_level: 99, job_level: 50, base_stats: { str: 1, agi: 1, vit: 60, int: 80, dex: 40, luk: 1 },
    equipped: { right_hand: 1601, armor: 2314 }, target_mob_id: 1208, ...extra },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
});

// ── 1. Energy Coat ───────────────────────────────────────────────────────────
{
  const page = await open(WIZARD());
  await calculate(page);
  const before = await basicHit(page);
  check(!!before, "no basic-attack line on the survivability panel");

  const field = page.locator(".field-checkbox", { has: page.locator("span", { hasText: /^Energy Coat$/ }) }).first();
  check(await field.count() === 1, "Energy Coat is not offered to a Wizard");
  if (await field.count()) {
    await field.locator("input[type=checkbox]").first().check();
    await page.waitForTimeout(600);
    const sel = field.locator("select").first();
    check(await sel.count() === 1, "no SP-bracket picker appears once Energy Coat is on");
    await calculate(page);
    const after = await basicHit(page);
    const ratio = after && before ? after.hi / before.hi : 0;
    console.log("Energy Coat off -> on:", before?.hi, "->", after?.hi, `(${(ratio * 100).toFixed(0)}% of the hit)`);
    check(Math.abs(ratio - 0.7) < 0.02, `at full SP it should soak 30%, got ${((1 - ratio) * 100).toFixed(1)}%`);

    // And it weakens as SP drains: the 1-20% bracket is only 6%.
    await sel.selectOption("20");
    await page.waitForTimeout(600);
    await calculate(page);
    const low = await basicHit(page);
    const lowRatio = low && before ? low.hi / before.hi : 0;
    console.log("at 1-20% SP:", low?.hi, `(${(lowRatio * 100).toFixed(0)}%)`);
    check(Math.abs(lowRatio - 0.94) < 0.02, `at 1-20% SP it should soak 6%, got ${((1 - lowRatio) * 100).toFixed(1)}%`);
  }
  await page.locator(".surv-view").screenshot({ path: join(tmpdir(), "energy-coat.png") }).catch(() => {});
  await page.close();
}

// ── 2. Amplify Magic Power is High Wizard only ───────────────────────────────
{
  const wiz = await open(WIZARD());
  const wizHas = await wiz.locator("span", { hasText: /^Amplify Magic Power$/ }).count();
  await wiz.close();
  const hw = await open({ ...WIZARD(), build: { ...WIZARD().build, job_id: 4010 } });
  const hwHas = await hw.locator("span", { hasText: /^Amplify Magic Power$/ }).count();
  await hw.close();
  console.log("Amplify offered — Wizard:", wizHas, "| High Wizard:", hwHas);
  check(wizHas === 0, "Amplify Magic Power is a transcendent skill; a plain Wizard should not be offered it");
  check(hwHas === 1, "a High Wizard must still be offered Amplify Magic Power");
}

// ── 3 + 4. Quagmire / Hypothermia lower the monster's HIT, and Alice Card ─────
{
  const KNIGHT = (card) => ({
    build: { job_id: 7, base_level: 99, job_level: 50, base_stats: { str: 90, agi: 60, vit: 80, int: 30, dex: 50, luk: 1 },
      equipped: { right_hand: 1101, armor: 2314, left_hand: 2105, ...(card ? { left_hand_card1: card } : {}) },
      target_mob_id: 1208 },
    skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
  });
  const page = await open(KNIGHT());
  await calculate(page);
  const dodge0 = await dodgePct(page);

  const tick = async (label) => {
    const f = page.locator(".field-checkbox", { has: page.locator("span", { hasText: label }) }).first();
    check(await f.count() === 1, `no "${label}" control under Target debuffs`);
    if (await f.count()) await f.locator("input[type=checkbox]").first().check();
    await page.waitForTimeout(500);
  };
  await tick(/^Hypothermia/);
  await calculate(page);
  const dodgeHypo = await dodgePct(page);
  console.log("dodge — plain:", dodge0 + "%", "| Hypothermia:", dodgeHypo + "%");
  check(dodgeHypo != null && dodge0 != null && dodgeHypo > dodge0,
    `Hypothermia takes 10 DEX off the monster, so you should dodge more (${dodge0}% -> ${dodgeHypo}%)`);

  const quag = page.locator(".debuff-field", { has: page.locator("label", { hasText: /^Quagmire/ }) }).first();
  if (await quag.count()) await quag.locator("select").first().selectOption("5");
  await page.waitForTimeout(500);
  await calculate(page);
  const dodgeBoth = await dodgePct(page);
  console.log("| + Quagmire Lv5:", dodgeBoth + "%");
  check(dodgeBoth != null && dodgeBoth > dodgeHypo,
    `Quagmire Lv5 halves the monster's DEX, so dodge should rise again (${dodgeHypo}% -> ${dodgeBoth}%)`);
  await page.close();

  // Alice Card against a boss's MELEE — it used to work on magic only.
  const bossState = (card) => { const s = KNIGHT(card); s.build.target_mob_id = 1251; return s; };
  const plain = await open(bossState(0));
  await calculate(plain);
  const plainHit = await basicHit(plain);
  await plain.close();
  const alice = await open(bossState(4253));
  await calculate(alice);
  const aliceHit = await basicHit(alice);
  const ratio = plainHit && aliceHit ? aliceHit.hi / plainHit.hi : 0;
  console.log("Stormy Knight's melee — no card:", plainHit?.hi, "-> Alice Card:", aliceHit?.hi, `(${(ratio * 100).toFixed(0)}%)`);
  check(Math.abs(ratio - 0.6) < 0.02, `Alice Card should take 40% off a boss's physical hit, got ${((1 - ratio) * 100).toFixed(1)}%`);
  await alice.close();
}

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
