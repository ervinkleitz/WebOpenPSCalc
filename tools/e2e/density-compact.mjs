import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const measure = async (label) => {
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const page_ = document.querySelector(".page");
    const panels = [...document.querySelectorAll(".panel, .field")];
    const inView = panels.filter((el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    return {
      rootFont: getComputedStyle(doc).fontSize,
      density: doc.dataset.density || "(unset)",
      docHeight: Math.round(doc.scrollHeight),
      pageWidth: page_ ? Math.round(page_.getBoundingClientRect().width) : null,
      overflowX: doc.scrollWidth > window.innerWidth + 1,
      panelsInFirstScreen: inView.length,
      // The two things a human noticed were unchanged when only the root font
      // scaled: form controls and the base-stat cards. Component rules like
      // `.ro-stat-detail input` and `.perf-stat-card input[type=number]` tie or beat
      // a generic override on specificity, so these must be measured, not assumed.
      inputH: (() => { const el = document.querySelector(".field input"); return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
      statCardH: (() => { const el = document.querySelector(".ro-stat-card"); return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
      // Compact puts all six base stats on ONE row (the default grid is 3 wide).
      // Counting distinct card tops is the honest check — a CSS column count can be
      // set and still wrap if a card refuses to shrink.
      statRows: (() => {
        const cards = [...document.querySelectorAll(".ro-stat-grid .ro-stat-card")];
        return cards.length ? new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size : null;
      })(),
      statCardsOverflow: [...document.querySelectorAll(".ro-stat-grid .ro-stat-card")]
        .some((c) => c.scrollWidth > c.clientWidth + 1),
      smallestText: Math.min(...[...document.querySelectorAll("body *")]
        .map((el) => parseFloat(getComputedStyle(el).fontSize)).filter((n) => n > 0)),
    };
  });
  console.log(label.padEnd(13), JSON.stringify(m));
  return m;
};

const before = await measure("comfortable:");
const toggle = page.locator("button[aria-label*='compact' i]").first();
if (!(await toggle.count())) { console.error("FAIL: no density toggle found"); process.exit(1); }
await toggle.click();
await page.waitForTimeout(900);
const after = await measure("compact:");

let ok = true;
if (after.rootFont !== "14px") { console.error("FAIL: root font did not shrink"); ok = false; }
if (!(after.docHeight < before.docHeight)) { console.error("FAIL: page did not get shorter"); ok = false; }
if (after.pageWidth !== before.pageWidth) { console.error(`FAIL: container width changed (${before.pageWidth} -> ${after.pageWidth}) — breakpoints shifted`); ok = false; }
// NB overflowX is measured RELATIVELY: the page already reports scrollWidth past
// the viewport on narrow screens because of off-screen tooltip bubbles (hence
// body{overflow-x:hidden}). Compact must not make that worse — it must not be the
// thing that introduces overflow where there was none.
if (after.overflowX && !before.overflowX) { console.error("FAIL: compact introduced horizontal overflow"); ok = false; }
if (after.smallestText < 9.0) { console.error(`FAIL: text too small (${after.smallestText}px)`); ok = false; }
// Shrink meaningfully, not just technically: a few percent reads as "nothing
// happened" to a user (the first attempt moved an input 37px -> 32px and was
// reported as unchanged twice).
if (!(after.inputH <= before.inputH * 0.8)) { console.error(`FAIL: inputs barely shrank (${before.inputH} -> ${after.inputH}px)`); ok = false; }
if (!(after.statCardH <= before.statCardH * 0.8)) { console.error(`FAIL: base-stat cards barely shrank (${before.statCardH} -> ${after.statCardH}px)`); ok = false; }
if (after.statRows !== 1) { console.error(`FAIL: base stats should sit on one row, got ${after.statRows}`); ok = false; }
if (after.statCardsOverflow) { console.error("FAIL: a base-stat card overflows its own box"); ok = false; }
console.log(`input ${before.inputH} -> ${after.inputH}px, stat card ${before.statCardH} -> ${after.statCardH}px, stat rows ${before.statRows} -> ${after.statRows}`);
console.log(`\nheight ${before.docHeight} -> ${after.docHeight} (${Math.round((1 - after.docHeight / before.docHeight) * 100)}% shorter), ` +
            `panels visible on first screen ${before.panelsInFirstScreen} -> ${after.panelsInFirstScreen}`);

// persistence across reload
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const persisted = await page.evaluate(() => ({ d: document.documentElement.dataset.density, f: getComputedStyle(document.documentElement).fontSize }));
console.log("after reload:", JSON.stringify(persisted));
if (persisted.d !== "compact" || persisted.f !== "14px") { console.error("FAIL: density did not persist"); ok = false; }

// Narrow screens: the responsive breakpoints are px so they do not shift, but
// verify compact never widens the page at phone/tablet widths.
for (const [w, h, label] of [[390, 844, "iPhone"], [820, 1180, "tablet"]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.evaluate(() => { try { localStorage.setItem("density", "compact"); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  // Measure comfortable first, then compact, and compare: the page already
  // over-reports scrollWidth on narrow screens (off-screen tooltip bubbles, which
  // body{overflow-x:hidden} covers). What matters is that compact never widens it.
  await page.evaluate(() => { try { localStorage.setItem("density", "comfortable"); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const comfortW = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.evaluate(() => { try { localStorage.setItem("density", "compact"); } catch (e) {} });
  await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const m = await page.evaluate((cw) => ({
    scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
    comfortW: cw, compactWorse: document.documentElement.scrollWidth > cw,
    statRows: (() => { const c = [...document.querySelectorAll(".ro-stat-grid .ro-stat-card")];
      return c.length ? new Set(c.map((x) => Math.round(x.getBoundingClientRect().top))).size : null; })(),
    font: getComputedStyle(document.documentElement).fontSize,
  }), comfortW);
  console.log(label.padEnd(8), JSON.stringify(m));
  if (m.compactWorse) { console.error(`FAIL: compact widened the page at ${w}px (${m.comfortW} -> ${m.scrollW})`); ok = false; }
  if (m.statRows !== 1) { console.error(`FAIL: base stats wrapped to ${m.statRows} rows at ${w}px`); ok = false; }
  await page.close();
}

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
