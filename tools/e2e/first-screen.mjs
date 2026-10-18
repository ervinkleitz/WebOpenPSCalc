// What a player gets on arrival — and, more importantly, what still beats it.
//
// Three changes land here, all aimed at the first screen:
//   * the Features banner starts collapsed. Expanded it was 303px of a 1080px
//     desktop fold and 513px of an 844px phone screen — 61% of a first-time
//     visitor's first screen was a feature list sitting above an empty build.
//   * the starter templates are buttons, not a dropdown. A dropdown hid that they
//     existed and charged two clicks for a build that should cost one.
//   * the last build comes back on the next visit. The draft already survived a
//     refresh (sessionStorage, per tab); it now survives closing the browser.
//
// THE PART THAT MATTERS MOST IS THE PRECEDENCE. A restored build that overrides a
// link someone sent you, or the tab you were just editing, is far worse than no
// restore at all — so most of this file is about what the stored build must LOSE to.
//
// Run: node tools/e2e/first-screen.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const feSrc = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = feSrc.slice(feSrc.indexOf("const Z3_KEYS: string[] = ["), feSrc.indexOf("const Z3_ENC"));
const z3Keys = [];
for (const line of blk.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) {
    for (const sl of SLOTS) for (const i of [1, 2, 3, 4]) z3Keys.push(`${sl}_card${i}`);
    continue;
  }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) z3Keys.push(m[1]);
}
const z3Enc = {};
z3Keys.forEach((k, i) => { if (!(k in z3Enc)) z3Enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [z3Enc[k] ?? k, ren(x)])) : v;
// A Wizard, so it is unmistakable against the Assassin the stored build will hold.
const SHARED_WIZARD = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 9, base_level: 99, job_level: 50, name: "Shared Wizard",
    base_stats: { str: 1, agi: 1, vit: 1, int: 99, dex: 99, luk: 1 },
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

const ASSASSIN = "Assassin — Sonic Blow (PvE)";
const jobOf = (page) => page.evaluate(() => {
  const sel = document.querySelector(".character-identity select");
  return sel ? sel.selectedOptions[0]?.text ?? null : null;
});
const settle = (page) => page.waitForTimeout(8500);

const browser = await chromium.launch({ channel: "chrome", headless: true });

// ---- 1. a first visit: one line of banner, and the templates on show -------------
let visited;   // storage carried forward to play the "returning player" below
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await settle(page);

  const banner = await page.evaluate(() => {
    const el = document.querySelector(".reworks-banner");
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  check(banner !== null && banner < 70,
    `the Features banner starts collapsed (${banner}px, was 303)`, banner);
  // Collapsed, not deleted — it is still there to open.
  check(await page.locator(".reworks-banner-toggle").count() === 1,
    "and is still one click from opening");

  // The picker is a dropdown, deliberately. It was briefly a row of eighteen class
  // buttons — one click instead of two, and it advertised that the templates exist
  // — but in a 440px column that is five rows where the dropdown is one, which
  // costs more of the fold than it saves. Reverted 2026-10-17 at the maintainer's
  // call; this asserts it stays a dropdown so it does not drift back.
  const picker = page.locator(".panel select").first();
  const options = await picker.locator("option").count();
  check(options >= 17, `every starter build is in the picker (${options - 1})`, options);
  check(await page.locator(".template-chip").count() === 0,
    "and it is one control, not a grid of buttons");

  await picker.selectOption({ label: ASSASSIN });
  await page.waitForTimeout(2500);
  check(await jobOf(page) === "Assassin", "choosing one loads that build", await jobOf(page));

  check(errors.length === 0, "no page errors", errors);
  visited = await ctx.storageState();
  await ctx.close();
}

// ---- 2. coming back later: the build is there, and it says so --------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: visited });
  const page = await ctx.newPage();
  await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await settle(page);

  check(await jobOf(page) === "Assassin",
    "a new session reopens the build you left", await jobOf(page));
  const notice = await page.locator(".resume-notice").first();
  check(await notice.count() === 1,
    "and says so — a build you did not ask for, unannounced, is a bug with extra steps");

  // The template panel folds itself away once there is a build: eighteen class
  // buttons above a finished Assassin is a menu for a choice already made.
  check(await page.locator(".panel select option", { hasText: "Choose a class build" }).count() === 0,
    "the template panel collapses itself when the build is not empty");
  check(await page.locator(".panel-title", { hasText: "Start from a template" }).count() === 1,
    "but is still there to open");

  // Start fresh has to mean it — including for the NEXT visit.
  page.on("dialog", (d) => d.accept());
  await notice.getByRole("button", { name: /Start fresh/i }).click();
  await page.waitForTimeout(1500);
  check(await jobOf(page) === "Novice", "Start fresh empties the build", await jobOf(page));
  check(await page.locator(".resume-notice").count() === 0, "and takes the notice with it");

  const after = await ctx.storageState();
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: after });
  const page2 = await ctx2.newPage();
  await page2.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await settle(page2);
  check(await jobOf(page2) === "Novice",
    "and the discarded build does not come back on the next visit", await jobOf(page2));
  await ctx2.close();
}

// ---- 3. what the stored build must LOSE to ---------------------------------------
// This is the whole risk of the feature. Two cases, both worse than not restoring.
{
  // Rebuild a session that has an Assassin stored.
  const seed = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const sp = await seed.newPage();
  await sp.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
  await settle(sp);
  await sp.locator(".panel select").first().selectOption({ label: ASSASSIN });
  await sp.waitForTimeout(2500);
  const stored = await seed.storageState();
  await seed.close();

  // (a) someone sends you a link. Theirs, not yours.
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: stored });
  const page = await ctx.newPage();
  await page.goto(SHARED_WIZARD, { waitUntil: "domcontentloaded" });
  await settle(page);
  check(await jobOf(page) === "Wizard",
    "a shared link beats the stored build — you see what you were sent", await jobOf(page));
  check(await page.locator(".resume-notice").count() === 0,
    "and is not announced as your last build, because it is not");

  // (b) you are mid-edit in this tab and reload. The tab's own draft wins; the
  //     stored build is only ever the floor beneath it.
  await page.evaluate(() => {
    const sel = document.querySelector(".character-identity select");
    sel.value = [...sel.options].find((o) => o.text === "Priest").value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  check(await jobOf(page) === "Priest",
    "a reload keeps what THIS tab was editing, not the stored build", await jobOf(page));
  await ctx.close();
}

await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
