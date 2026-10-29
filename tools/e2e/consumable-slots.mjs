// Consumables are equipment slots, the same way buffs became equipment slots.
//
// The panel was a flat run of controls -- a select, two number fields, three box
// checkboxes and four proof potions under the one section header -- and almost
// every build leaves most of it untouched. As slots, each kind is a row you open,
// and while it is closed the row says what you are carrying: "Berserk Potion",
// "ATK +20", "Gloom, Drowsiness", "Fireproof, Thunderproof". Exactly what a closed
// equipment slot does with the item worn in it.
//
// What this test is really guarding is the rewrite underneath. Every control in the
// panel was moved into a new container, and a control that looks right but no longer
// reaches the engine would be invisible in a screenshot -- so one check picks a
// potion and watches ASPD actually move.
//
// Run: node tools/e2e/consumable-slots.mjs [baseUrl]
import { chromium } from "playwright-core";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

// A fresh context every time: "collapsed until you open it" is only true for a
// browser that has never opened one, and localStorage would carry it over.
const fresh = async (seed) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if (seed) await page.addInitScript(seed);
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return { ctx, page };
};

const PANEL = '[data-panel="consumables"]';
const slots = (page) => page.$$eval(PANEL + " .equip-slot", (els) => els.map((e) => ({
  label: (e.querySelector(".equip-slot-label")?.textContent || "").trim(),
  // The value span is rendered ONLY while the slot is closed, so its presence is
  // also how this test knows whether a slot is open.
  value: (e.querySelector(".equip-slot-value")?.textContent || "").trim() || null,
  open: e.className.includes("equip-slot--open"),
  filled: e.className.includes("equip-slot--filled"),
})));

const LABELS = ["ASPD potion", "ATK / MATK items", "Boxes", "Proof potions"];

// ---- 1. four slots, collapsed, each saying it holds nothing ---------------------
{
  const { ctx, page } = await fresh();
  const rows = await slots(page);
  check(rows.length === 4, "the panel is four slots", rows.map((r) => r.label));
  check(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify(LABELS),
    "named by what they hold", rows.map((r) => r.label));
  check(rows.every((r) => !r.open), "a browser that has never opened one sees them closed");
  check(rows.length === 4 && rows.every((r) => r.value === "None"),
    "and each says None", rows.map((r) => r.value));

  // ---- 2. the pair that governs all of them ------------------------------------
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(600);
  const opened = await slots(page);
  check(opened.length === 4 && opened.every((r) => r.open),
    "Expand all opens every one", opened.map((r) => r.open));
  await panel.getByRole("button", { name: /collapse all/i }).first().click();
  await page.waitForTimeout(600);
  const shut = await slots(page);
  check(shut.length === 4 && shut.every((r) => !r.open), "and Collapse all shuts them again");
  await ctx.close();
}

// ---- 3. closed, a slot says what is in it ---------------------------------------
{
  const { ctx, page } = await fresh();
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);
  await panel.locator('select[aria-label="ASPD potion"]').selectOption("3");
  const atk = panel.locator('input[type="number"]').first();
  await atk.fill("20");
  await atk.blur();
  for (const n of [/Box of Gloom/i, /Box of Drowsiness/i, /Fireproof/i, /Thunderproof/i]) {
    await panel.locator(".field-checkbox label", { hasText: n }).first()
      .locator('input[type="checkbox"]').check();
  }
  await page.waitForTimeout(400);
  await panel.getByRole("button", { name: /collapse all/i }).first().click();
  await page.waitForTimeout(700);
  const rows = await slots(page);
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  // The potion by name, not "1 on": which of the three it is IS the question.
  check(byLabel["ASPD potion"] === "Berserk Potion",
    "the potion slot names the potion", byLabel["ASPD potion"]);
  // Only the field that has a value, so an unset MATK does not print "MATK +0".
  check(byLabel["ATK / MATK items"] === "ATK +20",
    "the stat slot shows the figure, and only the one that is set", byLabel["ATK / MATK items"]);
  // Short names: four full ones do not fit a half-width row on a phone.
  check(byLabel["Boxes"] === "Gloom, Drowsiness", "boxes by short name", byLabel["Boxes"]);
  check(byLabel["Proof potions"] === "Fireproof, Thunderproof",
    "proof potions by short name", byLabel["Proof potions"]);
  check(rows.length === 4 && rows.every((r) => r.filled),
    "and every one of them reads as filled", rows.map((r) => [r.label, r.filled]));

  // ---- 4. the panel's own one-line summary, for when the panel itself is shut ---
  await page.locator(PANEL + " h2.panel-header").first().click();
  await page.waitForTimeout(600);
  const summary = await page.locator(PANEL + " .panel-summary").first().textContent().catch(() => null);
  check(!!summary && /Berserk Potion/.test(summary) && /more/.test(summary),
    "the collapsed panel summarises the lot", summary);
  await ctx.close();
}

// ---- 5. the controls still reach the engine -------------------------------------
// A redesign that leaves a control on screen but disconnected looks perfect and is
// completely broken, so this reads ASPD before and after choosing a potion.
{
  const { ctx, page } = await fresh();
  const aspd = async () => {
    const t = await page.locator(".sec-stat-card", {
      has: page.locator(".sec-stat-label", { hasText: /^ASPD$/ }),
    }).first().innerText().catch(() => "");
    const m = t.match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };
  const before = await aspd();
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);
  await panel.locator('select[aria-label="ASPD potion"]').selectOption("3"); // Berserk +20%
  await page.waitForTimeout(4000);
  const after = await aspd();
  check(before != null && after != null, "ASPD is readable before and after", { before, after });
  // Guard the comparison itself: two nulls, or two equal numbers, must not pass.
  check(before != null && after != null && after > before,
    "Berserk Potion still raises ASPD, so the control is wired", { before, after });
  await ctx.close();
}

// ---- 6. a browser that had buff groups open keeps them open ---------------------
// The two panels share one open-state map now, under a new key. The old buffs-only
// key is read once on the way past; without that, every player's open groups would
// silently close the first time they loaded this build.
{
  const { ctx, page } = await fresh(() => {
    try {
      localStorage.setItem("opscalc.buffGroups", JSON.stringify({ priest: true, sage: true }));
      localStorage.removeItem("opscalc.panelGroups");
    } catch { /* ignore */ }
  });
  const openBuffGroups = await page.$$eval('[data-panel="buffs"] .equip-slot', (els) => els
    .filter((e) => e.className.includes("equip-slot--open"))
    .map((e) => (e.querySelector(".equip-slot-label")?.textContent || "").trim()));
  check(openBuffGroups.includes("Priest") && openBuffGroups.includes("Sage"),
    "the groups a player had open are still open after the key change", openBuffGroups);
  await ctx.close();
}

check(errors.length === 0, "no page errors", errors);
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
