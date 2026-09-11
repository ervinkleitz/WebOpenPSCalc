// The compact-layout button gets the same one-time nudge as the theme toggle.
// It is queued BEHIND the theme hint: the two buttons are ~34px apart and both
// bubbles are much wider than that, so showing both at once overlaps them.
// Once dismissed it must never come back — a nudge that reappears is a nag.
import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const b = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const hints = page.locator(".theme-hint");
const densityBtn = page.locator("button[aria-label*='layout' i]").first();
const themeBtn = page.locator("button[aria-label*='mode' i]").first();
const densityHint = densityBtn.locator("xpath=following-sibling::div[@class='theme-hint']");

// First visit: exactly one hint, and it is the theme one.
check(await hints.count() === 1, `first visit should show exactly one hint, got ${await hints.count()} (two would overlap)`);
check(await densityHint.count() === 0, "density hint showing while the theme hint is still up");

await themeBtn.click();
await page.waitForTimeout(400);
check(await densityHint.count() === 1, "density hint did not appear after the theme hint was dismissed");
check(await hints.count() === 1, "both hints visible at once");
// It has to actually be readable and on-screen, not just present in the DOM.
const box = await densityHint.boundingBox();
check(!!box && box.width > 40 && box.height > 10, `density hint has no usable box: ${JSON.stringify(box)}`);
check(!!box && box.x >= 0 && box.x + box.width <= 1440, `density hint is off-screen: ${JSON.stringify(box)}`);
const text = (await densityHint.textContent() || "").trim();
check(/compact/i.test(text), `density hint should name the feature, got "${text}"`);

// Clicking the button both toggles density AND retires the hint.
await densityBtn.click();
await page.waitForTimeout(500);
check(await page.evaluate(() => document.documentElement.dataset.density) === "compact", "click did not switch to compact");
check(await densityHint.count() === 0, "density hint still showing after its button was clicked");

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check(await hints.count() === 0, "a dismissed hint came back after reload");

// A returning user who already dismissed the theme hint sees the density hint
// immediately — this is the path almost everyone is actually on.
const p2 = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p2.goto(URL, { waitUntil: "networkidle" });
await p2.evaluate(() => { try { localStorage.setItem("themeHintSeen", "1"); } catch (e) {} });
await p2.reload({ waitUntil: "networkidle" });
await p2.waitForTimeout(1500);
check(await p2.locator(".theme-hint").count() === 1, "returning user did not get the density hint on load");
check(/compact/i.test((await p2.locator(".theme-hint").first().textContent() || "")), "returning user's single hint is not the density one");

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
