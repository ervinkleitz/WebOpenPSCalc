// An import that worked must not report itself as a no-op.
//
// QA, 2026-10-11: a Ninja pasted a planner link holding Shadow Slash Lv5 and the
// modal said "None of the skills in that link affect damage here, so nothing
// changed", listed Shadow Slash under "not used by any damage formula here", and
// invited them to report a naming bug. Then the skill picker opened Shadow Slash at
// Lv.5 — the import had worked perfectly. `applied` only ever counted PASSIVE-panel
// skills, and the modal's did-anything-land test read that one list, so every class
// whose tree is mostly active skills was told its import failed.
//
// This drives the modal the way a player does and holds it to what the editor then
// actually does.
import { chromium } from "playwright-core";
import zlib from "node:zlib";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const plannerLink = (job, levels) => "https://tools.payonstories.com/skill?state=" +
  encodeURIComponent(zlib.deflateSync(Buffer.from(JSON.stringify({ job, levels }), "utf8")).toString("base64"));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1600 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const importTree = async (job, levels) => {
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: /^Import$/i }).first().click();
  await page.waitForTimeout(1000);
  await page.locator(".modal-card textarea").first().fill(plannerLink(job, levels));
  await page.locator(".modal-card").getByRole("button", { name: /^import$/i }).click();
  await page.waitForTimeout(2800);
  const text = (await page.locator(".modal-card").innerText()).replace(/\s+/g, " ").trim();
  const done = page.locator(".modal-card").getByRole("button", { name: /^done$/i });
  if (await done.count()) await done.first().click();
  await page.waitForTimeout(1200);
  return text;
};
const pickSkill = async (name) => {
  await page.locator('input[placeholder*="Search skills" i]').first().fill(name);
  await page.waitForTimeout(1700);
  const row = page.locator(".search-result-item").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(1400); }
  const panel = page.locator(".panel", { has: page.locator(".panel-title", { hasText: /^Skill$/ }) });
  return {
    pill: (await panel.locator(".selected-pill span").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
    rank: await panel.locator('input[type="number"]').first().inputValue().catch(() => ""),
  };
};

// === the reported case: a tree with no passives at all =====================
const ninja = await importTree("Ninja", { NJ_KIRIKAGE: 5 });
console.log(`    modal said: ${ninja.slice(0, 300)}`);
check(!/nothing changed/i.test(ninja),
  "an import that kept a rank must not say \"nothing changed\"");
check(!/not used by any damage formula/i.test(ninja),
  "...nor that the skill it kept is unused here");
check(/Shadow Slash/.test(ninja) && /Lv5/.test(ninja),
  "it should name Shadow Slash and the rank it kept");

const picked = await pickSkill("Shadow Slash");
console.log(`    picker then opened: ${JSON.stringify(picked)}`);
check(picked.rank === "5",
  `and the editor must agree with the modal — picker opens at ${picked.rank}, modal said Lv5`);

// === Shadow's Within: modelled through a switch, not a rank ================
const sw = await importTree("Ninja", { NJ_SHADOW_WITHIN: 1, NJ_KIRIKAGE: 5 });
console.log(`    with Shadow's Within: ${sw.slice(0, 320)}`);
check(/Shadow's Within/.test(sw), "Shadow's Within should be named");
check(!/not used by any damage formula/i.test(sw) && !/nothing here reads[^.]*Shadow's Within/i.test(sw),
  "it is the one thing that lets Shadow Slash crit — it must not be written off");
check(/Buffs/i.test(sw), "and the player should be told where to switch it on");

// === a passive-heavy tree still reports its passives the old way ===========
const knight = await importTree("Knight", { SM_BASH: 10, KN_SPEARMASTERY: 10, KN_PIERCE: 5 });
console.log(`    Knight: ${knight.slice(0, 300)}`);
check(/Bash/.test(knight) && /Spear Mastery/.test(knight), "the passives are still listed");
check(/Pierce/.test(knight), "and the active skill's kept rank is listed too");
check(!/nothing changed/i.test(knight), "no false negative here either");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - the import reports what it kept." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
