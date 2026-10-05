// A PS planner import should set the rank a skill OPENS AT, not just the passives.
//
// Before known_skill_levels the picker always started a skill at its MAX, so a player
// who imported a tree with Pierce 5 and then picked Pierce was shown Lv10 damage and
// had to notice and correct it by hand. Measured across every job we model, that
// affected 92 skills the calculator already prices.
//
// Three things this test learned the hard way, each of which passes silently if you
// get it wrong:
//   * the skill box is NOT `.search-combo input` last — that is the monster search.
//   * "Pierce" also matches Spiral Pierce, so the picker does not auto-select; the
//     row has to be clicked, or every assertion runs against "Normal Attack".
//   * the picker returns NO rows once it has selected something, until the page is
//     reloaded. That is pre-existing — it reproduces on production, which has none of
//     this change — so each skill gets its own fresh load rather than a workaround.
import { chromium } from "playwright-core";
import zlib from "node:zlib";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const plannerLink = (job, levels) =>
  "https://tools.payonstories.com/skill?state=" + encodeURIComponent(
    zlib.deflateSync(Buffer.from(JSON.stringify({ job, levels }), "utf8")).toString("base64"));

const KNIGHT_TREE = { KN_PIERCE: 5, SM_BASH: 7, KN_TWOHANDQUICKEN: 10 };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } };

const skillBox = () => page.locator('.search-combo input[placeholder*="skill" i]').first();
const skillPanel = () => page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Skill$/ }) });
const readSkill = async () => ({
  pill: (await skillPanel().locator(".selected-pill span").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
  rank: await skillPanel().locator('input[type="number"]').first().inputValue().catch(() => ""),
});

/** Fresh load + import, so the picker is in its first-search state. */
async function loadImported() {
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /^Import$/i }).first().click();
  await page.waitForTimeout(1200);
  await page.locator(".modal-card textarea, .modal-card input[type=text]").first()
    .fill(plannerLink("Knight", KNIGHT_TREE));
  await page.waitForTimeout(400);
  await page.locator(".modal-card").getByRole("button", { name: /^import$/i }).click();
  await page.waitForTimeout(2500);
  // The modal stays open on a summary; its overlay eats later clicks if left up.
  const done = page.locator(".modal-card").getByRole("button", { name: /^done$/i });
  if (await done.count()) await done.first().click();
  await page.waitForTimeout(1200);
}

async function pickSkill(label) {
  await skillBox().fill(label);
  await page.waitForTimeout(1800);
  // A query matching exactly one skill AUTO-SELECTS and closes the dropdown, so
  // there is no row left to click. "Magnum" is one such query — looking only for
  // rows reported "not offered" for a skill that had in fact just been selected.
  if ((await readSkill()).pill.toLowerCase().startsWith(label.toLowerCase())) return true;
  const rows = page.locator(".search-result-item");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim();
    if (t.toLowerCase().startsWith(label.toLowerCase())) {
      await rows.nth(i).click();
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

const dmg = (s) => { const m = s.match(/([\d,]+)\s*MIN/i); return m ? Number(m[1].replace(/,/g, "")) : null; };
async function calcDamage() {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(6000);
  return dmg((await page.locator(".results-panel-body").first().innerText().catch(() => "")).replace(/\s+/g, " "));
}

// ---- 1. an imported skill opens at the rank the character has ---------------
await loadImported();
const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check(/Knight/i.test(body), "the import should switch the job to Knight");

check(await pickSkill("Pierce"), "the picker offered no Pierce row");
const pierce = await readSkill();
console.log(`Pierce -> pill ${JSON.stringify(pierce.pill)}  rank ${pierce.rank}`);
check(/pierce/i.test(pierce.pill), `expected Pierce, got "${pierce.pill}"`);
check(pierce.rank === "5", `Pierce should open at the imported rank 5, got ${pierce.rank}`);
check(/Lv\.?\s*5\b/.test(pierce.pill), `the pill should read Lv.5, got "${pierce.pill}"`);

// ---- 2. that rank is priced, not merely displayed ---------------------------
const five = await calcDamage();
await skillPanel().locator('input[type="number"]').first().fill("10");
await page.waitForTimeout(800);
const ten = await calcDamage();
console.log(`damage: rank 5 -> ${five}, rank 10 -> ${ten}`);
check(five != null && ten != null && ten > five,
  `rank 10 should out-damage the imported rank 5 (${five} -> ${ten})`);

// ---- 3. a skill the import did NOT mention still opens at its max -----------
// Otherwise this would be "always start low" rather than "start at what you know".
await loadImported();
let controlRan = false;
for (const candidate of ["Magnum Break", "Brandish Spear", "Spear Stab"]) {
  if (!(await pickSkill(candidate))) continue;
  const c = await readSkill();
  console.log(`${candidate} (not in the imported tree) -> rank ${c.rank}`);
  check(Number(c.rank) > 5, `an unimported skill should open at its max, got ${c.rank}`);
  controlRan = true;
  break;
}
check(controlRan, "no unimported skill was offered — the control never ran");

await page.screenshot({ path: "ps-import-skill-levels.png" });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
