// "hitting custom stats removes the 4th column in full width (browser)" — the
// maintainer, 2026-10-09, at 1920px. Then, one click later: "clicking on manual edits
// does the same thing."
//
// The editor is a CSS multi-column layout (`columns: 4` at >=1800px). Multicol
// balances by HEIGHT: it picks a column height that fits the content, and a single
// panel taller than that height drags it up until the remaining panels no longer need
// the last column. A panel cannot be split to relieve it either — panels have a border
// and a background, so a box cut across a column boundary looks broken.
//
// Two fixes were not enough. Collapsing the manual-edit fields by default fixed the
// default state but not opening them. Packing the fields tighter did not reach it
// either: the budget SHRINKS as the viewport grows, because every other panel gets
// shorter, and at 2560px no packing fit.
//
// So the manual edits are their own panel. Two panels of moderate height can sit in
// different columns; one tall panel cannot.
//
// Measure with a FRESH browser context per width. The collapse choice lives in
// localStorage, and reusing one context carried it between widths and gave me a
// reading I reported as a finding before noticing it was an artefact.
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

/** How many of the declared columns actually hold a panel. */
const columnsOf = (page) => page.evaluate(() => {
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

for (const width of [1800, 1920, 2200, 2560]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const mon = await columnsOf(page);
  await page.getByRole("button", { name: "Custom stats" }).click();
  await page.waitForTimeout(1600);
  const cus = await columnsOf(page);
  await page.getByRole("button", { name: /Show the fields/ }).click();
  await page.waitForTimeout(1600);
  const exp = await columnsOf(page);

  console.log(`    ${width}px: monster ${mon.occupied}/${mon.declared} -> custom ${cus.occupied}/${cus.declared}`
    + ` -> fields open ${exp.occupied}/${exp.declared}   (tallest panel ${mon.tallest} / ${cus.tallest} / ${exp.tallest}px)`);
  check(cus.occupied >= mon.occupied,
    `${width}px: switching to Custom stats costs no column (${mon.occupied} -> ${cus.occupied})`);
  // The one that regressed twice.
  check(exp.occupied >= mon.occupied,
    `${width}px: opening the manual-edit fields costs no column either (${mon.occupied} -> ${exp.occupied})`);
  await ctx.close();
}

// The fields still start collapsed — twenty almost-always-zero inputs should not be
// the first thing in the panel, and it keeps the panel short regardless.
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1100 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "Custom stats" }).click();
  await page.waitForTimeout(1600);
  check(await page.locator(".manual-enemy-group").count() === 0, "the fields start collapsed");
  await page.getByRole("button", { name: /Show the fields/ }).click();
  await page.waitForTimeout(1200);
  check(await page.locator(".manual-enemy-group").count() === 2, "and the toggle opens both groups");
  await ctx.close();
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - neither Custom stats nor opening the fields costs a column." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
