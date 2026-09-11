import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
// Manual stat bonuses is a collapsed section by default; open it so its grid is
// actually laid out and can be measured.
await page.evaluate(() => { try { localStorage.setItem("manualStatsOpen", "1"); } catch (e) {} });
await page.reload({ waitUntil: "networkidle" });
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
      // Manual stat bonuses: same one-row treatment as the base stats. Count
      // distinct field tops rather than trusting the column count.
      manualRows: (() => {
        const f = [...document.querySelectorAll(".manual-stat-grid .field")];
        return f.length ? new Set(f.map((x) => Math.round(x.getBoundingClientRect().top))).size : null;
      })(),
      manualFields: document.querySelectorAll(".manual-stat-grid .field").length,
      // Panel chrome: ~20 panels on the page, so this is where most of the
      // reclaimed height comes from. Measured, because the inner h2/content
      // margins have to come down with the box or the box only looks smaller.
      panelPadY: (() => { const el = document.querySelector(".panel");
        return el ? parseFloat(getComputedStyle(el).paddingTop) : null; })(),
      panelH: (() => { const el = document.querySelector(".panel");
        return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
      // Buffs: ~60 checkbox rows, the densest list on the page. Row pitch is
      // measured from actual row tops, not from the CSS gap, because the label
      // wrapping to two lines changes the real spacing.
      buffRowPitch: (() => {
        const tops = [...new Set([...document.querySelectorAll(".field-checkbox")]
          .map((e) => Math.round(e.getBoundingClientRect().top)))].sort((a, b) => a - b);
        const d = tops.slice(1).map((t, i) => t - tops[i]).filter((x) => x > 0 && x < 80).sort((a, b) => a - b);
        return d.length ? d[Math.floor(d.length / 2)] : null;
      })(),
      // The checkbox is a fixed 16px, so it does NOT follow the root font and
      // has to be shrunk by hand or it stays put while its label shrinks.
      checkboxPx: (() => { const el = document.querySelector('.field-checkbox input[type="checkbox"]');
        return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
      // Buff names live at 0.85rem while every other small label is 0.72rem.
      // Compact brings them into line — compared, not hardcoded.
      buffLabelFs: (() => { const el = document.querySelector(".field-checkbox label");
        return el ? getComputedStyle(el).fontSize : null; })(),
      fieldLabelFs: (() => { const el = document.querySelector(".field label");
        return el ? getComputedStyle(el).fontSize : null; })(),
      // Tallest control on the page before this: its padding is its own, not the
      // shared input padding, so the generic control override missed it.
      pillH: (() => { const el = document.querySelector(".selected-pill");
        return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
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
if (after.manualFields !== 6) { console.error(`FAIL: manual stat bonuses not rendered (${after.manualFields} fields) — section collapsed?`); ok = false; }
if (after.manualRows !== 1) { console.error(`FAIL: manual stat bonuses should sit on one row, got ${after.manualRows}`); ok = false; }
if (!(after.panelPadY <= before.panelPadY * 0.45)) { console.error(`FAIL: panel padding barely shrank (${before.panelPadY} -> ${after.panelPadY}px)`); ok = false; }
if (!(after.panelH < before.panelH * 0.8)) { console.error(`FAIL: panels barely got shorter (${before.panelH} -> ${after.panelH}px)`); ok = false; }
if (!(after.buffRowPitch <= before.buffRowPitch * 0.8)) { console.error(`FAIL: buff rows barely tightened (${before.buffRowPitch} -> ${after.buffRowPitch}px pitch)`); ok = false; }
if (!(after.checkboxPx < before.checkboxPx)) { console.error(`FAIL: checkbox is fixed-px and did not shrink (${before.checkboxPx} -> ${after.checkboxPx}px)`); ok = false; }
if (after.buffLabelFs !== after.fieldLabelFs) { console.error(`FAIL: buff names (${after.buffLabelFs}) do not match the other small labels (${after.fieldLabelFs})`); ok = false; }
if (!(after.pillH <= before.pillH * 0.8)) { console.error(`FAIL: the selected-skill box barely shrank (${before.pillH} -> ${after.pillH}px)`); ok = false; }
console.log(`input ${before.inputH} -> ${after.inputH}px, stat card ${before.statCardH} -> ${after.statCardH}px, ` +
            `stat rows ${before.statRows} -> ${after.statRows}, manual-bonus rows ${before.manualRows} -> ${after.manualRows}`);
console.log(`panel padding ${before.panelPadY} -> ${after.panelPadY}px, first panel ${before.panelH} -> ${after.panelH}px`);
console.log(`buff row pitch ${before.buffRowPitch} -> ${after.buffRowPitch}px, checkbox ${before.checkboxPx} -> ${after.checkboxPx}px, ` +
            `buff label ${before.buffLabelFs} -> ${after.buffLabelFs} (other labels ${after.fieldLabelFs}), skill box ${before.pillH} -> ${after.pillH}px`);
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
  // Each newPage gets its own context, so the collapsed sections have to be
  // opened again here.
  await page.evaluate(() => { try { localStorage.setItem("manualStatsOpen", "1"); localStorage.setItem("density", "compact"); } catch (e) {} });
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
    manualRows: (() => { const f = [...document.querySelectorAll(".manual-stat-grid .field")];
      return f.length ? new Set(f.map((x) => Math.round(x.getBoundingClientRect().top))).size : null; })(),
    manualClipped: [...document.querySelectorAll(".manual-stat-grid .field")]
      .some((x) => x.scrollWidth > x.clientWidth + 1),
    font: getComputedStyle(document.documentElement).fontSize,
  }), comfortW);
  console.log(label.padEnd(8), JSON.stringify(m));
  if (m.compactWorse) { console.error(`FAIL: compact widened the page at ${w}px (${m.comfortW} -> ${m.scrollW})`); ok = false; }
  if (m.statRows !== 1) { console.error(`FAIL: base stats wrapped to ${m.statRows} rows at ${w}px`); ok = false; }
  if (m.manualRows !== 1) { console.error(`FAIL: manual stat bonuses wrapped to ${m.manualRows} rows at ${w}px`); ok = false; }
  if (m.manualClipped) { console.error(`FAIL: a manual-bonus field is clipped at ${w}px`); ok = false; }
  await page.close();
}

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
