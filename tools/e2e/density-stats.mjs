// Density usage tracking. Two distinct signals, and the distinction is the point:
//   density_active_*      once per session, the density the session RUNS in.
//                         A click counter cannot answer "do people use compact?" —
//                         someone who switched months ago clicks zero times forever.
//   density_switch_to_*   every toggle, i.e. churn/discovery.
// Asserted against the real network beacons, not the call sites.
import { chromium } from "playwright-core";
const URL = process.argv[2] || "http://localhost:5173/";
const b = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

const open = async () => {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const seen = [];
  page.on("request", (r) => {
    if (!r.url().includes("/calculate/track")) return;
    try {
      const b2 = JSON.parse(r.postData() || "{}");
      if (b2.ev === "feature" && String(b2.name).startsWith("density")) seen.push(b2.name);
    } catch {}
  });
  return { page, seen };
};

// Fresh visitor: defaults to comfortable, and that is what gets recorded.
let { page, seen } = await open();
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
check(seen.includes("density_active_comfortable"), `no active-density beacon on load, got [${seen}]`);
check(seen.filter(n => n.startsWith("density_active")).length === 1, `active density recorded ${seen.filter(n=>n.startsWith("density_active")).length} times, must be exactly once per session`);

const before = seen.length;
const toggle = page.locator("button[aria-label*='layout' i]").first();
await toggle.click();
await page.waitForTimeout(700);
check(seen.includes("density_switch_to_compact"), `toggling to compact sent no switch beacon, got [${seen.slice(before)}]`);
check(seen.filter(n => n === "density_switch_to_compact").length === 1, "one click must send exactly one switch beacon");
// Toggling must NOT re-record the session's active density — that would count one
// session under both and make the usage split meaningless.
check(seen.filter(n => n.startsWith("density_active")).length === 1,
  `toggling re-recorded the active density (${seen.filter(n=>n.startsWith("density_active"))}) — the split would double-count`);

await toggle.click();
await page.waitForTimeout(700);
check(seen.includes("density_switch_to_comfortable"), "toggling back sent no comfortable switch beacon");
await page.close();

// Returning compact user: records compact on load, without touching the button.
({ page, seen } = await open());
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => { try { localStorage.setItem("density", "compact"); } catch (e) {} });
seen.length = 0;
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
check(seen.includes("density_active_compact"), `a stored compact preference was not recorded on load, got [${seen}]`);
check(!seen.some(n => n.startsWith("density_switch")), "loading a stored preference must not count as a switch");
await page.close();

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
