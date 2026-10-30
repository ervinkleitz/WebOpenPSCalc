// The proc and autocast readouts are still cards.
//
// WHY THIS EXISTS: six components render .breakdown-view -- the main step table
// plus Auto Spell, Auto Blitz, Triple Attack, Double Attack and card autocast. The
// breakdown redesign flattened the main one into a column and wrote that rule on
// the bare class, which stripped the border, fill and padding off the other five.
// A Monk's Triple Attack readout and a Thief's Double Attack readout became
// unseparated blocks running into the page.
//
// It was worse than a missing border. Those sections are full width, so their step
// table stretched the gap between STEP and CHANGE across the whole panel -- the old
// dot leader bridged that distance and the grid does not -- which put the numbers
// roughly 900px from the labels they belong to.
//
// Twelve suite scripts drive these exact builds and every one of them passed
// throughout, because they all assert numbers and none of them asserts that a
// readout still looks like a readout. Hence this file: it checks the CHROME, which
// is the thing a shared class can take away from five components at once.
//
// Run: node tools/e2e/proc-readout-cards.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
  "garment", "shoes", "accessory_left", "accessory_right"];
const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of block.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of SLOTS) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
const link = (state) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)));

// One build per proc component that is reachable from a share link alone.
const BUILDS = {
  "Monk · Triple Attack": {
    build: {
      job_id: 15, base_level: 99, job_level: 50,
      base_stats: { str: 90, agi: 70, vit: 40, int: 1, dex: 60, luk: 1 },
      equipped: { right_hand: 1801 }, mastery_levels: { MO_TRIPLEATTACK: 10 },
      target_mob_id: 1002,
    },
    skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
  },
  // Double Attack also renders .dw-per-hit inside its own total, nested exactly as
  // the main Final damage row does -- which is how a rule meant for the main row
  // pushed this one's inline "(2 x 198)" onto a line of its own.
  "Thief · Double Attack": {
    build: {
      job_id: 6, base_level: 99, job_level: 50,
      base_stats: { str: 80, agi: 90, vit: 20, int: 1, dex: 60, luk: 20 },
      equipped: { right_hand: 1201 }, mastery_levels: { TF_DOUBLE: 10 },
      target_mob_id: 1002,
    },
    skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const [name, state] of Object.entries(BUILDS)) {
  for (const [width, device] of [[1500, "desktop"], [390, "phone"]]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 1300 }, isMobile: width < 700, hasTouch: width < 700,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(link(state), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: /calculate damage/i }).first().click();
    await page.waitForTimeout(9000);
    const where = `${name} @ ${device}`;

    // These readouts live behind their own buttons now, closed by default, so a
    // check of their chrome has to open one first. Before that they were all
    // appended under the breakdown at once.
    const buttons = await page.locator(".ds-extra-btn").count();
    check(buttons > 0, `${where}: the readout has a button`, buttons);
    if (buttons) { await page.locator(".ds-extra-btn").first().click(); await page.waitForTimeout(800); }

    const views = await page.$$eval(".results-panel .breakdown-view", (els) => els.map((e) => {
      const cs = getComputedStyle(e);
      const transparent = (c) => !c || c === "transparent" || /rgba\(0, 0, 0, 0\)/.test(c);
      return {
        title: (e.querySelector(".breakdown-title")?.textContent || "(untitled)").trim().slice(0, 28),
        isMainColumn: !!e.closest(".ds-columns-main"),
        borderPx: parseFloat(cs.borderLeftWidth) || 0,
        padPx: parseFloat(cs.paddingLeft) || 0,
        filled: !transparent(cs.backgroundColor),
        width: Math.round(e.getBoundingClientRect().width),
      };
    }));

    const procs = views.filter((v) => !v.isMainColumn);
    check(procs.length > 0, `${where}: the proc readout rendered at all`, views.map((v) => v.title));
    // THE REGRESSION: chrome, on everything that is not the main column.
    const stripped = procs.filter((v) => v.borderPx < 1 || v.padPx < 1 || !v.filled);
    check(stripped.length === 0,
      `${where}: every proc readout still has its border, fill and padding`, stripped);

    // And it must not stretch: a full-width step table strands CHANGE and RESULT
    // far from the labels they belong to.
    const panelW = await page.locator(".results-panel").first()
      .evaluate((e) => Math.round(e.getBoundingClientRect().width));
    const tooWide = procs.filter((v) => v.width > panelW * 0.95 && panelW > 900);
    check(tooWide.length === 0,
      `${where}: the proc readout is not stretched across the whole panel`,
      { panelW, procWidths: procs.map((v) => v.width) });

    // The main column keeps the opposite treatment on a wide screen: it IS the
    // column, so it carries no card of its own.
    const main = views.find((v) => v.isMainColumn);
    if (main && device === "desktop") {
      check(main.borderPx < 1 && main.padPx < 1,
        `${where}: the main step table stays flat, as its own column`, main);
    }

    // The per-hit figure inside a proc total stays where it was written: inline.
    const perHit = await page.$$eval(
      ".results-panel .breakdown-view:not(.ds-columns-main *) .breakdown-total-val .dw-per-hit",
      (els) => els.map((e) => ({ text: e.textContent.trim().slice(0, 20), display: getComputedStyle(e).display })));
    for (const ph of perHit) {
      check(ph.display === "inline", `${where}: a proc total's per-hit figure stays inline`, ph);
    }

    check(errors.length === 0, `${where}: no page errors`, errors);
    await ctx.close();
  }
}

await browser.close();
console.log(ok ? "PASS" : "see failures");
process.exit(ok ? 0 : 1);
