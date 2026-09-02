// "Loading the pinned build is not working" — reported twice, and state assertions
// could not see it, because the state loaded correctly every time. The problem was
// entirely visual: nothing on screen moved.
//
// Clicking Load on a pin triggers a recompute, and onCalculate ended by pulling the
// results panel into view. So the app scrolled the user straight back to the compare
// table they had just clicked Load from. The editor did update — below the results
// panel, off screen — and the only visible change was the Current column quietly
// becoming identical to the column clicked. Indistinguishable from a dead button.
//
// This asserts the OUTCOME A USER CAN SEE: the editor is on screen afterwards, and it
// shows the build that was pinned.
import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:5173/";
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle" });

  const calc = async () => {
    await page.getByRole("button", { name: "Calculate damage" }).click();
    await page.waitForTimeout(4000);
  };
  const tpl = page.locator("select")
    .filter({ has: page.locator("option", { hasText: "Choose a class build" }) }).first();
  const opts = (await tpl.locator("option").allTextContents())
    .filter((t) => !/Choose a class build/.test(t));

  // Pin build A, then switch to build B so a successful load is visible.
  await tpl.selectOption({ label: opts[0] });
  await page.waitForTimeout(1300);
  await calc();
  await page.getByRole("button", { name: /^Pin current$/ }).click();
  await page.waitForTimeout(700);
  await tpl.selectOption({ label: opts[1] });
  await page.waitForTimeout(1300);
  await calc();

  const loadBtn = page.locator("button.cmp-btn-mini", { hasText: "Load" }).first();
  await loadBtn.click();

  // 1. The click is acknowledged immediately, before anything else can happen.
  await page.waitForTimeout(400);
  const label = (await loadBtn.textContent())?.trim();
  if (!/Loaded/.test(label ?? "")) fail(`Load button gave no acknowledgement (still reads "${label}")`);

  // 2. The editor is brought on screen, rather than the results panel reclaiming it.
  await page.waitForTimeout(2500);
  const view = await page.evaluate(() => {
    const grid = document.querySelector(".editor-grid");
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    return { top: Math.round(r.top), onScreen: r.top < window.innerHeight * 0.5 && r.bottom > 0 };
  });
  if (!view) fail("no .editor-grid on the page");
  else if (!view.onScreen) fail(`the editor is off screen after loading a pin (top=${view.top}px) — the click looks like it did nothing`);
  else console.log("editor brought into view, top =", view.top);

  // 3. And it shows the build that was pinned.
  const name = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("opscalc.draft")).state.build.name; } catch { return null; }
  });
  if (name !== opts[0]) fail(`editor shows "${name}", expected "${opts[0]}"`);
  else console.log("editor shows the pinned build:", name);

  if (errors.length) fail("page errors: " + errors.join(" | "));
  if (!process.exitCode) console.log("\nPASS — loading a pin visibly takes you to the loaded build.");
} finally {
  await browser.close();
}
