// A passive skill is a tick plus a rank, the same as a party buff.
//
// It used to be a 0..max number box per skill — an identical question ("do you have
// this, and at what rank") wearing a different control depending on which panel you
// were in, and one where "do I have Sword Mastery at all" could only be answered by
// reading a number. The buffs were moved to checkbox + level selector first; this
// brings the passives to the same row.
//
// What has to hold, and each of these is a way the move could go wrong quietly:
//   * no number boxes left in the panel, and one checkbox per passive;
//   * a level selector appears only once a passive is ticked, and only for passives
//     with more than one rank — Hilt Binding is a single rank and a one-entry
//     selector would imply a choice that does not exist;
//   * ticking sets the rank to the skill's max, and the rank reaches the ENGINE —
//     a control that looks right and prices nothing is the failure that matters;
//   * unticking removes it from the build entirely rather than storing a 0;
//   * Max all / Reset still work;
//   * an imported tree opens its passives already ticked, at the imported rank.
//
// Run: node tools/e2e/passive-skill-rows.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";
import zlib from "node:zlib";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

// A share link is the only reliable way to land on a given job: the job <select> is
// populated from the API, so selecting by label races the fetch.
const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const feSrc = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const CARD_SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = feSrc.slice(feSrc.indexOf("const Z3_KEYS: string[] = ["), feSrc.indexOf("const Z3_ENC"));
const z3Keys = [];
for (const line of blk.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) {
    for (const sl of CARD_SLOTS) for (const i of [1, 2, 3, 4]) z3Keys.push(`${sl}_card${i}`);
    continue;
  }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) z3Keys.push(m[1]);
}
const z3Enc = {};
z3Keys.forEach((k, i) => { if (!(k in z3Enc)) z3Enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [z3Enc[k] ?? k, ren(x)])) : v;

// A Knight with a Pike and a target, so Sword/Spear Mastery have something to act on
// and the damage comparison below is a real one rather than 0 vs 2.
const KNIGHT = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 50, vit: 40, int: 20, dex: 70, luk: 20 },
    equipped: { right_hand: 1408 },  // Pike, a spear — so Spear Mastery applies
    target_mob_id: 1200,
    mastery_levels: {},
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));
const plannerLink = (job, levels) => "https://tools.payonstories.com/skill?state=" +
  encodeURIComponent(zlib.deflateSync(Buffer.from(JSON.stringify({ job, levels }), "utf8")).toString("base64"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const panel = () => page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Passive skills$/ }) });
const rowByLabel = (name) => panel().locator(".field-checkbox").filter({ hasText: name }).first();
const dmg = (s) => { const m = s.match(/([\d,]+)\s*MIN/i); return m ? Number(m[1].replace(/,/g, "")) : null; };
async function calcDamage() {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(6000);
  return dmg((await page.locator(".results-panel-body").first().innerText().catch(() => "")).replace(/\s+/g, " "));
}

await page.goto(KNIGHT, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await panel().scrollIntoViewIfNeeded();

// ---- 1. the panel is rows of checkboxes, with nothing left of the number boxes ----
const rows = await panel().locator(".field-checkbox").count();
const numbers = await panel().locator('input[type="number"]').count();
check(rows >= 4, `a Knight's passives render as checkbox rows (${rows})`, rows);
check(numbers === 0, "and no number box survives in the panel", numbers);

// ---- 2. the rank selector appears only once something is ticked -------------------
check(await panel().locator(".field-checkbox select").count() === 0,
  "nothing is ticked, so no rank selector is offered");

const sword = rowByLabel("Blade Mastery");
check(await sword.count() > 0, "Blade Mastery is one of the rows");
await sword.locator('input[type="checkbox"]').check();
await page.waitForTimeout(500);

const sel = sword.locator("select");
check(await sel.count() === 1, "ticking it reveals its rank selector");
check(await sel.inputValue() === "10", "opened at the skill's max rank", await sel.inputValue());
const opts = await sel.locator("option").allInnerTexts();
check(opts.length === 10 && opts[0] === "Lv 10" && opts.at(-1) === "Lv 1",
  "offering Lv 10 down to Lv 1, highest first, like the buffs", opts);

// ---- 2b. a one-rank passive stays a plain checkbox -------------------------------
// A Knight has none, so this needs a Blacksmith: Hilt Binding is a single rank, and
// a one-entry selector would imply a choice that is not there. Same rule the
// one-rank buffs (Gloria, Adrenaline Rush) already follow.
{
  const bs = await ctx.newPage();
  await bs.goto(`${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
    build: { job_id: 10, base_level: 99, job_level: 50, mastery_levels: {} },
    skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
  }))), { waitUntil: "domcontentloaded" });
  await bs.waitForTimeout(8000);
  const bsPanel = bs.locator(".panel", { has: bs.locator(".panel-title", { hasText: /^Passive skills$/ }) });
  const hilt = bsPanel.locator(".field-checkbox").filter({ hasText: "Hilt Binding" }).first();
  check(await hilt.count() > 0, "a Blacksmith has Hilt Binding");
  await hilt.locator('input[type="checkbox"]').check();
  await bs.waitForTimeout(500);
  check(await hilt.locator("select").count() === 0,
    "a one-rank passive (Hilt Binding) stays a plain checkbox");
  const weapon = bsPanel.locator(".field-checkbox").filter({ hasText: "Smith Sword" }).first();
  if (await weapon.count() > 0) {
    await weapon.locator('input[type="checkbox"]').check();
    await bs.waitForTimeout(400);
    check(await weapon.locator("select").count() === 1,
      "while a multi-rank one beside it does get a selector");
  }
  await bs.close();
}

// ---- 3. the rank reaches the engine ----------------------------------------------
// The control could look perfect and price nothing. Spear Mastery on a Pike is
// +4 ATK per rank through Mastery Fix, so Lv10 and Lv3 must not produce the same
// number — and the gap must be the skill's own step, not merely "different".
const spear = rowByLabel("Spear Mastery");
check(await spear.count() > 0, "Spear Mastery is on the list for a Knight");
await spear.locator('input[type="checkbox"]').check();
await page.waitForTimeout(500);
const atTen = await calcDamage();
await panel().scrollIntoViewIfNeeded();
await spear.locator("select").selectOption("3");
await page.waitForTimeout(500);
const atThree = await calcDamage();
console.log(`    Spear Mastery Lv10 -> ${atTen}, Lv3 -> ${atThree}`);
check(atTen != null && atTen > 100,
  `a geared Knight should do real damage, got ${atTen} — a near-zero figure makes the comparison meaningless`);
check(atThree != null && atTen - atThree >= 20,
  `dropping 7 ranks of Spear Mastery should cost ~4 ATK a rank (${atTen} -> ${atThree})`);

// ---- 4. unticking removes it from the build, not stores a zero --------------------
await panel().scrollIntoViewIfNeeded();
await spear.locator('input[type="checkbox"]').uncheck();
await sword.locator('input[type="checkbox"]').uncheck();
await page.waitForTimeout(800);
check(await panel().locator(".field-checkbox select").count() === 0,
  "unticking takes the rank selector away again");
// The share link is the build, so this is the honest read of what was stored.
const linkAfter = await page.evaluate(() => location.search);
check(!/KN_SPEARMASTERY/.test(decodeURIComponent(linkAfter)),
  "and an untaken passive leaves nothing behind in the build");

// ---- 5. Max all / Reset still drive the new rows ----------------------------------
await panel().getByRole("button", { name: /^Max all$/ }).click();
await page.waitForTimeout(700);
const ticked = await panel().locator('.field-checkbox input[type="checkbox"]:checked').count();
check(ticked === rows, `Max all ticks every row (${ticked}/${rows})`, { ticked, rows });
const maxed = await sword.locator("select").inputValue();
check(maxed === "10", "at full rank", maxed);

await panel().getByRole("button", { name: /^Reset$/ }).click();
await page.waitForTimeout(700);
const stillTicked = await panel().locator('.field-checkbox input[type="checkbox"]:checked').count();
check(stillTicked === 0, `Reset clears every row (${stillTicked} left ticked)`, stillTicked);

// ---- 6. an imported tree arrives already ticked, at the rank it imported ----------
await page.goto(KNIGHT, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.getByRole("button", { name: /^Import$/i }).first().click();
await page.waitForTimeout(1000);
await page.locator(".modal-card textarea, .modal-card input[type=text]").first()
  .fill(plannerLink("Knight", { KN_SPEARMASTERY: 6 }));
await page.locator(".modal-card").getByRole("button", { name: /^import$/i }).click();
await page.waitForTimeout(2800);
const done = page.locator(".modal-card").getByRole("button", { name: /^done$/i });
if (await done.count()) await done.first().click();
await page.waitForTimeout(1200);
await panel().scrollIntoViewIfNeeded();

const impSpear = rowByLabel("Spear Mastery");
check(await impSpear.locator('input[type="checkbox"]').isChecked(),
  "an imported passive comes in already ticked");
const impRank = await impSpear.locator("select").inputValue();
check(impRank === "6", `at the rank the tree had, not the max (got ${impRank})`, impRank);

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS - passives are buff rows now." : "\nsee failures above");
process.exit(ok ? 0 : 1);
