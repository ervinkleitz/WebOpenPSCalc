// The features panel can be dismissed outright, and the only way back is the
// star button in the header — which must exist ONLY while it is dismissed,
// and the dismissal must survive a reload (it is a per-user preference).
import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const b = await chromium.launch({ channel: "chrome", headless: true });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

const banner = page.locator(".reworks-banner");
const restore = page.locator("button[aria-label='Show the features panel']");
const dismiss = page.locator("button[aria-label='Hide the features panel']");
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

check(await banner.count() === 1, "features panel not present on load");
check(await restore.count() === 0, "restore button showing while the panel is still visible");
check(await dismiss.count() === 1, "no dismiss control on the features panel");

await dismiss.click();
await page.waitForTimeout(400);
check(await banner.count() === 0, "panel still visible after dismiss");
check(await restore.count() === 1, "no restore button after dismiss — the panel would be unrecoverable");

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
check(await banner.count() === 0, "dismissal did not persist across reload");
check(await restore.count() === 1, "restore button gone after reload — panel unrecoverable");

await restore.click();
await page.waitForTimeout(400);
check(await banner.count() === 1, "panel did not come back when restored");
check(await restore.count() === 0, "restore button still showing once the panel is back");
// Content, not just the shell: restoring must give back the actual list.
check((await page.locator(".reworks-banner li").count()) > 5, "restored panel has no feature list");

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
check(await banner.count() === 1, "restore did not persist across reload");

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
