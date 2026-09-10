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
    font: getComputedStyle(document.documentElement).fontSize,
  }), comfortW);
  console.log(label.padEnd(8), JSON.stringify(m));
  if (m.compactWorse) { console.error(`FAIL: compact widened the page at ${w}px (${m.comfortW} -> ${m.scrollW})`); ok = false; }
  await page.close();
}

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
