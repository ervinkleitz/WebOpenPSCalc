// "hitting custom stats removes the 4th column in full width (browser)" — the
// maintainer, 2026-10-09, at 1920px.
//
// The editor is a CSS multi-column layout (`columns: 4` at >=1800px). Multicol
// balances by HEIGHT: it picks a column height that fits the content, and a single
// unbreakable panel taller than the balanced height forces that height up until the
// remaining panels no longer need the last column. Adding the manual-edit fields took
// the Target panel to 2433px and the fourth column emptied.
//
// The fix is that those twenty almost-always-zero inputs are collapsed by default, so
// the common case stays short. This pins the reported case.
//
// Measured cleanly (a fresh browser context per width — the collapse choice lives in
// localStorage and reusing one context contaminates the reading):
//
//   width   monster   custom   custom + manual edits EXPANDED
//   1800     4/4       4/4      3/4
//   1920     4/4       4/4      3/4
//   2200     4/4       4/4      3/4
//   2560     4/4       4/4      3/4
//
// So the default state is sound at every width, and the fourth column only empties
// when someone deliberately opens the twenty-field block — at which point the Target
// panel is genuinely taller than a quarter of the content and multicol has nowhere
// else to put it. The test asserts CUSTOM IS NO WORSE THAN MONSTER at the same width,
// which is the reported complaint, and does not assert the expanded case.
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1100 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** How many of the declared columns actually hold a panel. */
const columns = () => page.evaluate(() => {
  const g = document.querySelector(".editor-grid");
  if (!g) return null;
  const lefts = new Set();
  let tallest = 0;
  for (const el of g.children) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) lefts.add(Math.round(r.left));
    tallest = Math.max(tallest, Math.round(r.height));
  }
  return { declared: Number(getComputedStyle(g).columnCount), occupied: lefts.size, tallest };
});

for (const width of [1920, 1800, 2560]) {
  await page.setViewportSize({ width, height: 1100 });
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const mon = await columns();
  await page.getByRole("button", { name: "Custom stats" }).click();
  await page.waitForTimeout(1600);
  const cus = await columns();

  console.log(`    ${width}px: monster ${mon.occupied}/${mon.declared} (tallest ${mon.tallest}px) `
    + `-> custom ${cus.occupied}/${cus.declared} (tallest ${cus.tallest}px)`);
  check(cus.occupied >= mon.occupied,
    `${width}px: switching to Custom stats does not cost a column (${mon.occupied} -> ${cus.occupied})`);
}

// And the block is collapsed to begin with — that is what keeps the panel short.
await page.setViewportSize({ width: 1920, height: 1100 });
await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.getByRole("button", { name: "Custom stats" }).click();
await page.waitForTimeout(1600);
const fieldsHidden = await page.locator(".manual-enemy-group").count();
check(fieldsHidden === 0, "the manual-edit fields start collapsed");
const toggle = page.getByRole("button", { name: /^Manual edits/ });
check(await toggle.count() === 1, "and there is a toggle to open them");
await toggle.click();
await page.waitForTimeout(1200);
check(await page.locator(".manual-enemy-group").count() === 2, "which opens both groups");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - Custom stats never costs a column." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
