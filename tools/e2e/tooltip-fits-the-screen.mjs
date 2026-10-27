// A tooltip must never push the page sideways, and must be readable when it opens.
//
// 2026-10-17, measured on production: every screen scrolled 133px horizontally on a
// 390px phone. Nothing visible was to blame — the offenders were five CLOSED
// `.info-tooltip-bubble` elements. They were hidden with `visibility: hidden`, which
// still takes part in layout, so five 320px boxes anchored at their triggers hung off
// the right edge (the worst started 210px in and ended at 524px) and dragged the
// scroll width with them. A player could never see them; they could only feel the page
// slide under their thumb.
//
// Two halves to the fix and this checks both, because either alone leaves a bug:
//   * closed bubbles use `display: none`, so they contribute no layout at all;
//   * below 600px an OPEN bubble is a sheet pinned to the bottom of the screen,
//     because 320px cannot sit beside its trigger on a 390px screen — the one on the
//     right-hand stat card flips to `right: 0` and ran off the LEFT edge instead.
//
// Run: node tools/e2e/tooltip-fits-the-screen.mjs [baseUrl]
import { chromium } from "playwright-core";

const BASE = process.argv[2] || "http://localhost:5173/";
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

const overflow = (page) => page.evaluate(() => {
  const d = document.documentElement;
  return { over: d.scrollWidth - d.clientWidth, vw: d.clientWidth };
});

const browser = await chromium.launch({ channel: "chrome", headless: true });

// ---- 1. a phone, nothing open: the page must not scroll sideways --------------
// Both densities: compact scales type and padding, so it moves every trigger and
// could reintroduce the overflow on its own.
for (const density of ["comfortable", "compact"]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
  await page.waitForTimeout(600);

  const { over } = await overflow(page);
  check(over === 0, `390px / ${density}: no horizontal scroll with every tooltip closed`, `${over}px`);

  // Closed bubbles must occupy nothing, which is the actual mechanism above. Asserting
  // the scroll width alone would pass again the day someone reaches for a different
  // hack that happens to hide the symptom.
  const boxed = await page.evaluate(() =>
    [...document.querySelectorAll(".info-tooltip-bubble")]
      .filter((el) => el.getClientRects().length > 0).length);
  check(boxed === 0, `390px / ${density}: a closed bubble generates no box at all`, boxed);

  // ---- 2. open one: still no sideways scroll, and all of it on screen ---------
  // `.first()` is the header's "about" icon, which this breakpoint hides — hovering
  // it times out rather than failing, so ask for a visible one.
  const trigger = page.locator(".info-tooltip:visible").first();
  check(await trigger.count() > 0, `390px / ${density}: there is a tooltip to open`);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.hover();
  await page.waitForTimeout(500);

  const open = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".info-tooltip-bubble")]
      .find((e) => e.getClientRects().length > 0);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: Math.round(b.left), right: Math.round(b.right),
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      position: cs.position, text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 40),
    };
  });
  check(open !== null, `390px / ${density}: hovering opens the bubble`, open);
  if (open) {
    const vw = 390, vh = 844;
    check(open.left >= 0 && open.right <= vw,
      `390px / ${density}: the open bubble is wholly within the screen`, open);
    check(open.top >= 0 && open.bottom <= vh,
      `390px / ${density}: and wholly above the fold, not half off the bottom`, open);
    check(open.position === "fixed",
      `390px / ${density}: it is the pinned sheet, not the desktop bubble`, open.position);
    check(open.text.length > 10, `390px / ${density}: with its text in it`, open.text);
    const after = await overflow(page);
    check(after.over === 0,
      `390px / ${density}: and opening it still does not scroll the page sideways`, `${after.over}px`);
  }
  await ctx.close();
}

// ---- 3. desktop is untouched: still a bubble anchored under its trigger -------
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  const trigger = page.locator(".info-tooltip").first();
  const tb = await trigger.boundingBox();
  await trigger.hover();
  await page.waitForTimeout(500);

  const open = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".info-tooltip-bubble")]
      .find((e) => e.getClientRects().length > 0);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
      w: Math.round(b.width), position: getComputedStyle(el).position };
  });
  check(open !== null, "1500px: hovering opens the bubble");
  if (open && tb) {
    check(open.position === "absolute", "1500px: still absolutely positioned", open.position);
    check(open.top > tb.y, "1500px: still hangs below its trigger", { bubbleTop: open.top, trigger: Math.round(tb.y) });
    check(Math.abs(open.left - tb.x) < 40, "1500px: still anchored to it horizontally", { bubbleLeft: open.left, trigger: Math.round(tb.x) });
    check(open.w > 250, "1500px: still the full-width bubble", open.w);
  }
  // Moving away closes it, so the sheet cannot be left stuck over a phone screen.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  const closed = await page.evaluate(() =>
    [...document.querySelectorAll(".info-tooltip-bubble")].filter((e) => e.getClientRects().length > 0).length);
  check(closed === 0, "it closes again when the pointer leaves", closed);

  // ---- the stat cards that ARE their own tooltip ------------------------------
  // HoverNote attaches the same bubble to a card instead of to an "i" icon, and this
  // test was only ever exercising `.info-tooltip` triggers — so it passed while the
  // Critical card's bubble sat 132px off the LEFT of the screen (2026-10-27).
  //
  // These anchor to the card's right edge by default, which the last column needs
  // and the first column cannot survive. Which side a given card wants is a judgement
  // its own definition makes; what must hold for all of them is this.
  for (const label of ["ASPD", "Critical"]) {
    const card = page.locator(".sec-stat-card", {
      has: page.locator(".sec-stat-label", { hasText: new RegExp(`^${label}$`) }),
    }).first();
    if (await card.count() === 0) continue;
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForTimeout(350);
    const off = await page.evaluate(() => {
      const host = [...document.querySelectorAll(".hover-note")].filter((h) => h.matches(":hover"))[0];
      if (!host) return null;
      const pop = [...host.children].find((c) => getComputedStyle(c).position !== "static");
      if (!pop) return null;
      const b = pop.getBoundingClientRect();
      return { left: Math.round(Math.max(0, -b.left)), right: Math.round(Math.max(0, b.right - innerWidth)) };
    });
    check(off != null, `${label}: its hover note opens`, off);
    check(off != null && off.left === 0 && off.right === 0,
      `${label}: and opens entirely on screen`, off);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);

  check(errors.length === 0, "no page errors", errors);
  await ctx.close();
}

await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
