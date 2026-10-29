// A target debuff is a tick and a magnitude, the same as a party buff.
//
// The Target panel had two shapes for one question. A debuff with no ranks (Strip
// Shield, Hypothermia, Asleep) was a checkbox; a debuff WITH ranks was a label above
// a dropdown whose first option was "Off" — so whether you ticked something or chose
// something depended only on whether the skill happened to have levels. Five of them
// were like that: Quagmire, Decrease AGI, Provoke, Fling and Burning.
//
// They now use the buff row: a tick for "this is on the target", and the magnitude
// only once it is. The unit is not always a level, which is the wrinkle — Fling
// counts a Gunslinger's coins and Burning counts stacks — so the option text is
// per-field rather than assumed.
//
// THE ASSERTION THAT MATTERS is the engine one. A control can look perfect and feed
// nothing: Provoke at Lv10 and Lv1 must produce different damage, and against a
// target with enough DEF for the cut to show. Horong (1129) carries DEF 95, where
// Poring's 0 would have made "Lv10 == Lv1" look like a pass.
//
// Run: node tools/e2e/target-debuff-rows.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
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
  ? Object.fromEntries(Object.entries(v).map(([k, x])  => [z3Enc[k] ?? k, ren(x)])) : v;
const link = (state) => `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)));

// Horong: DEF 95, 2444 HP, not a boss (Provoke does nothing to bosses).
const BUILD = {
  job_id: 12, base_level: 99, job_level: 50,
  base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
  equipped: { right_hand: 1220 }, refine: { right_hand: 7 }, target_mob_id: 1129,
};
const START = link({ build: BUILD, skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster" });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const panel = () => page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Target$/ }) });
const row = (name) => panel().locator(".field-checkbox").filter({ hasText: name }).first();
const barRange = async () => {
  const t = (await page.locator(".damage-bar").innerText()).replace(/\s+/g, " ");
  const m = t.match(/([\d,]+)[–-]([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const waitForBar = async (was) => {
  for (let i = 0; i < 40; i++) {
    const v = await barRange();
    if (v !== was) return v;
    await page.waitForTimeout(400);
  }
  return await barRange();
};

await page.goto(START, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
// The debuffs are grouped into collapsible slots now, so every row below starts
// hidden. `hidden` takes an element out of the accessibility tree as well as off
// the screen, so this is a 30s timeout rather than a missing element.
{
  const expand = page.locator('[data-panel="target"]').getByRole("button", { name: /expand all/i }).first();
  if (await expand.count()) { await expand.click(); await page.waitForTimeout(500); }
}
await panel().scrollIntoViewIfNeeded();

// ---- 1. one shape for the whole panel -------------------------------------------
check(await page.locator(".debuff-field").count() === 0,
  "no leveled debuff is a label-over-a-dropdown any more");
const LEVELED = ["Quagmire", "Decrease AGI", "Provoke", "Fling", "Burning"];
for (const name of LEVELED) {
  check(await row(name).count() === 1, `${name} is a checkbox row`);
}
check(await panel().locator(".field-checkbox select").count() === 0,
  "and none of them offers a magnitude while it is switched off");

// ---- 2. ticking reveals the magnitude, at the top of its range -------------------
const EXPECTED = {
  Quagmire: { max: "Lv 5", n: 5 },
  Provoke: { max: "Lv 10", n: 10 },
  Fling: { max: "5 coins (−15%)", n: 5 },
  Burning: { max: "5 stacks", n: 5 },
  "Decrease AGI": { max: "Lv 5", n: 5 },
};
for (const [name, exp] of Object.entries(EXPECTED)) {
  const r = row(name);
  await r.locator('input[type="checkbox"]').check();
  await page.waitForTimeout(350);
  const sel = r.locator("select").first();
  check(await sel.count() === 1, `${name}: ticking it reveals the magnitude`);
  const opts = await sel.locator("option").allInnerTexts();
  check(opts.length === exp.n, `${name}: ${exp.n} steps offered`, opts.length);
  check(opts[0] === exp.max,
    `${name}: highest first and in its own unit ("${opts[0]}")`, opts.slice(0, 2));
  check(await sel.inputValue() === String(exp.n),
    `${name}: opens at the top of its range`, await sel.inputValue());
}
// Fling counts coins and Burning counts stacks — neither is a level, and saying
// "Lv 5" for five coins would be wrong in a way nobody would notice.
check((await row("Fling").locator("option").allInnerTexts()).every((t) => /coin/.test(t)),
  "Fling is measured in coins, not levels");
check((await row("Burning").locator("option").allInnerTexts()).every((t) => /stack/.test(t)),
  "Burning is measured in stacks, not levels");

// Burning's explanatory line has to sit under the row, not get squeezed into it.
const hint = await page.evaluate(() => {
  const r = [...document.querySelectorAll(".field-checkbox")].find((e) => /BURNING/i.test(e.innerText));
  const h = r?.querySelector(".hint-text");
  if (!h) return null;
  const lab = r.querySelector("label").getBoundingClientRect();
  return { below: h.getBoundingClientRect().top >= lab.bottom - 1, text: h.textContent.slice(0, 40) };
});
check(hint && hint.below, "Burning's note wraps onto its own line below the row", hint);

// ---- 3. the magnitude reaches the ENGINE ----------------------------------------
// Everything above would pass on a control wired to nothing.
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(7000);
const atMax = await barRange();
console.log(`    Provoke Lv10 vs Horong (DEF 95): ${atMax}`);
check(atMax != null && atMax > 50, `a geared Assassin does real damage to Horong (${atMax})`, atMax);

await panel().scrollIntoViewIfNeeded();
await row("Provoke").locator("select").selectOption("1");
const atOne = await waitForBar(atMax);
console.log(`    Provoke Lv1:  ${atOne}`);
check(atOne != null && atOne < atMax,
  `dropping Provoke from Lv10 to Lv1 costs damage (${atMax} → ${atOne})`, { atMax, atOne });

// And unticking is not the same as Lv1 — it has to remove the debuff entirely.
await row("Provoke").locator('input[type="checkbox"]').uncheck();
const off = await waitForBar(atOne);
console.log(`    Provoke off:  ${off}`);
check(off != null && off < atOne,
  `and switching it off costs more again (${atOne} → ${off})`, { atOne, off });
check(await row("Provoke").locator("select").count() === 0,
  "unticking takes the magnitude picker away");

// ---- 4. the boolean shape in old shared links still loads ------------------------
// Quagmire and Provoke were booleans before they had levels, and links from then
// are still in Discord. `true` has to come back as the top of the range, ticked.
{
  const legacy = await ctx.newPage();
  await legacy.goto(link({
    build: { ...BUILD },
    skill: { id: 0, level: 1, label: "Normal Attack" },
    targetMode: "monster",
    targetMods: { quagmire: true, provoke: true },
  }), { waitUntil: "domcontentloaded" });
  await legacy.waitForTimeout(9000);
  const lp = legacy.locator(".panel", { has: legacy.locator(".panel-title", { hasText: /^Target$/ }) });
  const q = lp.locator(".field-checkbox").filter({ hasText: "Quagmire" }).first();
  check(await q.locator('input[type="checkbox"]').isChecked(),
    "a pre-levels share link still arrives with Quagmire on");
  check(await q.locator("select").inputValue() === "5",
    "at the top of its range", await q.locator("select").inputValue().catch(() => null));
  await legacy.close();
}

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS - the target debuffs are buff rows now." : "\nsee failures above");
process.exit(ok ? 0 : 1);
