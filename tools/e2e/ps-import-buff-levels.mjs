// Ticking a self-buff should switch it on at the rank the character HAS, not the
// buff's max. A Knight who only took Two-Hand Quicken 3 was being handed the Lv10
// bonus the moment they ticked the box.
//
// The import records the rank (known_buff_levels, keyed by status change) but does
// NOT switch anything on — so this test ticks the box itself and reads the result.
import { chromium } from "playwright-core";
import zlib from "node:zlib";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const plannerLink = (job, levels) =>
  "https://tools.payonstories.com/skill?state=" + encodeURIComponent(
    zlib.deflateSync(Buffer.from(JSON.stringify({ job, levels }), "utf8")).toString("base64"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } };

async function loadImported(levels) {
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /^Import$/i }).first().click();
  await page.waitForTimeout(1200);
  await page.locator(".modal-card textarea, .modal-card input[type=text]").first()
    .fill(plannerLink("Knight", levels));
  await page.waitForTimeout(400);
  await page.locator(".modal-card").getByRole("button", { name: /^import$/i }).click();
  await page.waitForTimeout(2500);
  const done = page.locator(".modal-card").getByRole("button", { name: /^done$/i });
  if (await done.count()) await done.first().click();
  await page.waitForTimeout(1200);
}

/** The level the app currently has for a status change, straight from its state. */
const buffLevel = (sc) => page.evaluate((key) => {
  // The editor keeps the build in the URL, which is the only stable read-out here.
  const u = new URL(window.location.href);
  return u.searchParams.get("b") ? key : null;
}, sc);

// --- a Knight who took Two-Hand Quicken at 3 of its max ----------------------
await loadImported({ KN_TWOHANDQUICKEN: 3, KN_PIERCE: 5 });

// Tick the Two-Hand Quicken box.
const label = page.locator(".field-checkbox label", { hasText: /Two-Hand Quicken|Sword Quickening/i }).first();
check(await label.count() > 0, "the Two-Hand Quicken toggle should be offered to a Knight");
if (await label.count()) {
  await label.locator('input[type="checkbox"]').check();
  await page.waitForTimeout(1500);

  // Read the level the app stored, via the share link it keeps in the URL.
  const lvl = await page.evaluate(() => {
    const el = document.querySelector("a[href*='?b=']") || null;
    return el ? el.getAttribute("href") : window.location.search;
  });
  console.log("after ticking, url carries:", String(lvl).slice(0, 60));

  // The robust read: ask the calculate payload what level went in.
  const sent = await page.evaluate(async () => {
    const hooks = [];
    const orig = window.fetch;
    window.fetch = async (...a) => { hooks.push(a); return orig(...a); };
    document.querySelectorAll("button").forEach((b) => {
      if (/calculate damage/i.test(b.textContent || "")) b.click();
    });
    await new Promise((r) => setTimeout(r, 5000));
    window.fetch = orig;
    for (const [url, init] of hooks) {
      if (!String(url).includes("/api/calculate")) continue;
      try {
        const body = JSON.parse(init.body);
        const ab = body.build && body.build.active_buffs;
        if (ab) return ab;
      } catch { /* not this one */ }
    }
    return null;
  });
  console.log("active_buffs sent to the backend:", JSON.stringify(sent));
  check(sent != null, "could not capture the calculate payload");
  if (sent) {
    check(sent.SC_TWOHANDQUICKEN === 3,
      `Two-Hand Quicken should switch on at the imported rank 3, got ${sent.SC_TWOHANDQUICKEN}`);
  }
}

await page.screenshot({ path: "ps-import-buff-levels.png" });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
