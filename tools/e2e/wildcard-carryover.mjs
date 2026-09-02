// Which equipment slots are in "wildcard mix" mode is DERIVED from the build, read
// off it when the page opens. Every path that swaps the build has to re-derive it.
// Loading a pinned build and loading a saved build did not, so the previous build's
// wildcard slots kept applying and the loaded build was priced with cards it does
// not have equipped — 1,937.7 DPS where the build's own figure is 1,211.0.
//
// It reached players twice, as "Load doesn't work anymore" and "loading pinned
// builds is not working", because a silently wrong number is indistinguishable from
// a button that did nothing.
import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:5173/";
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle" });

  const calc = async () => {
    await page.getByRole("button", { name: "Calculate damage" }).click();
    await page.waitForTimeout(4000);
  };
  // The compare table is the only place DPS is exposed as one readable cell, and it
  // renders once something is pinned — so the flow pins before it measures.
  const dps = () => page.evaluate(() => {
    const th = [...document.querySelectorAll(".compare-table th")]
      .find((t) => t.textContent.includes("Current"));
    if (!th) return null;
    const i = [...th.parentElement.children].indexOf(th);
    const row = [...document.querySelectorAll(".compare-table tbody tr")]
      .find((r) => r.children[0]?.textContent?.includes("DPS"));
    return row?.children[i]?.textContent?.trim();
  });

  // A build with a slotted weapon and wildcard mix OFF.
  const tpl = page.locator("select")
    .filter({ has: page.locator("option", { hasText: "Choose a class build" }) }).first();
  const opts = (await tpl.locator("option").allTextContents())
    .filter((t) => !/Choose a class build/.test(t));
  await tpl.selectOption({ label: opts[0] });
  await page.waitForTimeout(1200);
  const weapon = page.getByPlaceholder("Search right hand (weapon)…");
  await weapon.click();
  await weapon.fill("Sword");
  await page.waitForTimeout(1500);
  await page.locator(".search-result-item").first().click();
  await page.waitForTimeout(1500);
  await calc();

  await page.getByRole("button", { name: /^Pin current$/ }).click();
  await page.waitForTimeout(800);
  const truth = await dps();
  if (!truth) fail("could not read a baseline DPS — the compare table did not render");
  console.log("baseline DPS (wildcard mix off):", truth);

  await page.getByRole("button", { name: "Save / Load" }).click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder("Build name").fill("e2e-wildcard");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.waitForTimeout(700);
  await page.locator(".modal-header button").last().click();
  await page.waitForTimeout(600);

  // Turn wildcard mix ON so the live build differs from both copies.
  await page.getByRole("button", { name: "Wildcard mix" }).click();
  await page.waitForTimeout(1000);
  await calc();
  const inflated = await dps();
  console.log("live DPS (wildcard mix on): ", inflated);
  if (inflated === truth) fail("wildcard mix changed nothing — the test proves nothing");

  // 1. Load the pin back.
  await page.locator("button.cmp-btn-mini", { hasText: "Load" }).first().click();
  await page.waitForTimeout(4500);
  const afterPin = await dps();
  console.log("after loading the PIN:          ", afterPin);
  if (afterPin !== truth) fail(`pin load priced with stale wildcard slots (${afterPin}, expected ${truth})`);

  // 2. Load the saved build back.
  await page.getByRole("button", { name: "Wildcard mix" }).click();
  await page.waitForTimeout(1000);
  await calc();
  await page.getByRole("button", { name: "Save / Load" }).click();
  await page.waitForTimeout(900);
  await page.locator(".saved-builds-item button", { hasText: "Load" }).first().click();
  await page.waitForTimeout(1500);
  await calc();
  const afterSaved = await dps();
  console.log("after loading the SAVED build:  ", afterSaved);
  if (afterSaved !== truth) fail(`saved load priced with stale wildcard slots (${afterSaved}, expected ${truth})`);

  if (errors.length) fail("page errors: " + errors.join(" | "));
  if (!process.exitCode) console.log("\nPASS — both load paths priced the loaded build at its own DPS.");
} finally {
  await browser.close();
}
