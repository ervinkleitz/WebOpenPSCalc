// A closed panel still says what is in it, and stays closed next time.
//
// The editor is eleven panels tall. Closing the ones you do not use was possible
// before this, but cost twice: every visit reopened them, and a closed panel showed
// nothing but its title — so you could not tell whether you had a weapon on without
// opening Equipment again. Collapsing was therefore a way of hiding your own build
// from yourself, which is why nobody did it.
//
// Two changes, and the test holds both:
//   * each panel carries a summary in its header while closed, naming what is set;
//   * the open/closed state is remembered per panel, per browser.
//
// The summaries are checked against a build whose contents are KNOWN, because the
// failure that matters is a summary that is merely plausible. Two were caught that
// way while this was written: Character read "Novice" for an Assassin, because
// job_name is resolved from the jobs list and a share link does not carry it, and
// Equipment read "Gladius" for a +7 Gladius.
//
// Run: node tools/e2e/panel-summaries.mjs [baseUrl]
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

// Every value below is asserted on, so the build is the fixture.
const BUILD_URL = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
    equipped: {
      right_hand: 1220, right_hand_card1: 4092, right_hand_card2: 4035,
      armor: 2302, armor_card1: 4014, shoes: 2403,
    },
    refine: { right_hand: 7 }, target_mob_id: 1002, clan: "crossbow_clan",
  },
  skill: { id: 28, level: 10, label: "Sonic Blow" },
  targetMode: "monster",
  targetMods: { provoke: 10, quagmire: 5 },
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const headers = () => page.evaluate(() => [...document.querySelectorAll(".panel-header")].map((h) => ({
  title: h.querySelector(".panel-title")?.textContent ?? "",
  summary: h.querySelector(".panel-summary")?.textContent ?? null,
  open: h.getAttribute("aria-expanded") === "true",
})));
const collapseAll = () => page.evaluate(() => {
  document.querySelectorAll(".panel-header").forEach((h) => {
    if (h.getAttribute("aria-expanded") === "true") h.click();
  });
});

await page.goto(BUILD_URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// ---- 1. an OPEN panel shows no summary ------------------------------------------
// It would be the same facts twice, and the header is not where you read your build.
const openRows = await headers();
check(openRows.some((r) => r.open), "panels start open on a fresh browser");
check(openRows.filter((r) => r.open && r.summary !== null).length === 0,
  "an open panel carries no summary — the panel itself already says it",
  openRows.filter((r) => r.open && r.summary));

const tallExpanded = await page.evaluate(() => document.documentElement.scrollHeight);

// ---- 2. closed, each names what is actually set ---------------------------------
await collapseAll();
await page.waitForTimeout(700);
const rows = await headers();
const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.summary]));
for (const [title, s] of Object.entries(byTitle)) console.log(`    ${title.padEnd(22)} ${s ?? "(none)"}`);

const EXPECT = {
  // The job comes from the jobs list, not from the link — this read "Novice" once.
  Character: /^Assassin · Lv 99\/50$/,
  // The refine belongs to the name; the cards are counted, because the assembled
  // game name of a triple-carded weapon will not fit in a header.
  Equipment: /^\+7 Gladius · \+2 more · 3 cards$/,
  Clan: /^Crossbow Clan$/,
  Skill: /^Sonic Blow Lv 10$/,
  // Who you are hitting first, then what is on them -- in the order the debuff
  // ROWS now appear, so the summary reads the same way the panel does. That puts
  // Provoke (DEF & MDEF) above Quagmire (Flee & accuracy); it used to be whichever
  // order the old hand-written list happened to push them in.
  Target: /^Poring · Provoke 10 · Quagmire 5$/,
};
for (const [title, re] of Object.entries(EXPECT)) {
  check(re.test(byTitle[title] ?? ""), `${title}: ${re.source}`, byTitle[title]);
}
// Nothing set reads as deliberately empty, not as a panel that failed to load.
check(byTitle.Pet === "—", "a panel with nothing in it says so with an em dash", byTitle.Pet);

const tallCollapsed = await page.evaluate(() => document.documentElement.scrollHeight);
console.log(`    page height: ${tallExpanded} expanded → ${tallCollapsed} collapsed`);
check(tallCollapsed < tallExpanded * 0.75,
  `collapsing is worth doing (${tallExpanded} → ${tallCollapsed})`, { tallExpanded, tallCollapsed });

// ---- 3. and it is remembered ----------------------------------------------------
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const afterReload = await headers();
check(afterReload.length > 0 && afterReload.every((r) => !r.open),
  `every panel is still closed after a reload (${afterReload.filter((r) => !r.open).length}/${afterReload.length})`,
  afterReload.filter((r) => r.open).map((r) => r.title));

// Re-opening one and reloading must remember THAT too, or this is just "start closed".
await page.locator(".panel-header").filter({ hasText: "Equipment" }).first().click();
await page.waitForTimeout(600);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const mixed = await headers();
const equip = mixed.find((r) => /Equipment/.test(r.title));
check(equip && equip.open, "a panel re-opened by hand is still open next time", equip);
check(mixed.filter((r) => r.open).length === 1,
  "and only that one — the others kept their own state",
  mixed.filter((r) => r.open).map((r) => r.title));

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
