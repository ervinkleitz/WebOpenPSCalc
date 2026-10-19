// A panel never changes column because something else changed height.
//
// .editor-grid is a MULTI-COLUMN layout, which treats the panels as one stream and
// balances them across the columns — so the browser re-decided where every column
// broke whenever any panel resized. Reported 2026-10-19 as "sections jump around
// when I collapse some equipment". Measured at 1500px before the fix: collapsing the
// Character panel moved 6 panels and changed 2 of their columns, and "Expand all" in
// Equipment threw Pet from column 1 to column 2.
//
// Forced `break-before: column` on the first panel of each column pins the
// boundaries, so a panel cannot migrate. This checks the property that matters — the
// column a panel sits in does not move — at every breakpoint, under the three height
// changes most likely to trigger it.
//
// Run: node tools/e2e/panel-columns.mjs [baseUrl]
import { chromium } from "playwright-core";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

// Each width sits in a different column-count band: 2, 3 and 4.
for (const [width, expectCols] of [[1100, 2], [1500, 3], [1900, 4]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  // A panel's column is its left edge: multi-column gives every column a distinct x.
  const snap = () => page.evaluate(() => [...document.querySelectorAll(".editor-grid > .panel")]
    .map((e) => ({ id: e.dataset.panel, x: Math.round(e.getBoundingClientRect().left) })));

  const base = await snap();
  const columns = [...new Set(base.map((r) => r.x))].length;
  check(columns === expectCols, `${width}px lays out in ${expectCols} columns`, columns);
  check(base.every((r) => r.id),
    "every panel carries a data-panel id — the pinning cannot use nth-child, because "
    + "Pet is Payon-Stories-only and the manual-target panel is custom-target-only",
    base.filter((r) => !r.id));

  // Each column must hold a CONTIGUOUS run of panels: the eyebrow numbers (00…10)
  // have to keep ascending as you read column by column.
  const xs = [...new Set(base.map((r) => r.x))].sort((a, b) => a - b);
  const colIndex = base.map((r) => xs.indexOf(r.x));
  check(colIndex.every((c, i) => i === 0 || c === colIndex[i - 1] || c === colIndex[i - 1] + 1),
    "the columns read in order — each holds a contiguous run of panels", colIndex);

  const actions = [
    ["expanding every equipment slot", async () => {
      await page.locator(".equip-slot-actions button", { hasText: "Expand all" }).first().click();
    }],
    ["collapsing the Character panel", async () => {
      await page.locator(".panel-header", { hasText: "Character" }).first().click();
    }],
    ["collapsing the Buffs panel", async () => {
      await page.locator(".panel-header", { hasText: "Buffs" }).first().click();
    }],
  ];
  for (const [label, act] of actions) {
    await act();
    await page.waitForTimeout(800);
    const now = await snap();
    const moved = base.filter((r, i) => r.x !== now[i].x).map((r) => r.id);
    check(moved.length === 0, `${width}px: no panel changes column on ${label}`, moved);
  }

  check(errors.length === 0, `${width}px: no page errors`, errors);
  await ctx.close();
}

await browser.close();
console.log(ok ? "\nPASS — panels stay in their column." : "\nsee failures above");
process.exit(ok ? 0 : 1);
