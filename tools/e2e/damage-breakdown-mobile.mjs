// The damage breakdown on a phone.
//
// WHY THIS EXISTS: the step table was rebuilt as a CSS grid -- step | change |
// result -- and the two numeric columns were given fixed widths. Fixed widths do
// not shrink. On a 360px phone they and their gaps took ~200px of a ~280px row,
// leaving the step NAME 48px, and an `text-overflow: ellipsis` on it turned every
// row into "Weapon dam...". The desktop checks all passed: at 1600px the name
// column is ~600px wide and nothing clips, so the layout looked finished while
// being unusable on the screen size that most needs the breakdown to be legible.
//
// The step name is the row's subject. It is the one thing that must survive a
// narrow screen -- a wrapped name over two lines costs less than a name you cannot
// read -- so it wraps, and the numeric columns give back what they can spare.
//
// Checked against Grand Cross as well as Double Strafe: the Crusader breakdown
// carries the longest labels the engine emits ("Element vs target (again, on the
// sum)"), so it is the worst case for width.
//
// Run: node tools/e2e/damage-breakdown-mobile.mjs [baseUrl]
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

const BUILDS = {
  "Double Strafe": {
    build: {
      job_id: 11, base_level: 99, job_level: 50,
      base_stats: { str: 1, agi: 99, vit: 1, int: 1, dex: 99, luk: 1 },
      equipped: { right_hand: 1704 }, target_mob_id: 1163,
    },
    skill: { id: 46, level: 10, label: "Double Strafing" }, targetMode: "monster",
  },
  // Longest labels in the engine, and the only breakdown with two sub-tracks.
  "Grand Cross": {
    build: {
      job_id: 14, base_level: 99, job_level: 50,
      base_stats: { str: 33, agi: 1, vit: 44, int: 99, dex: 75, luk: 1 },
      equipped: { right_hand: 1127 }, target_mob_id: 1219,
    },
    skill: { id: 254, level: 10, label: "Grand Cross" }, targetMode: "monster",
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

for (const [width, device] of [[360, "small phone"], [390, "iPhone"], [430, "large phone"]]) {
  for (const [name, state] of Object.entries(BUILDS)) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(link(state), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await page.getByRole("button", { name: /calculate damage/i }).first().click();
    await page.waitForTimeout(8000);
    const where = `${device} ${width}px, ${name}`;

    const rows = await page.locator(".results-panel .pl-name").count();
    check(rows > 2, `${where}: the step table rendered`, rows);

    // THE REGRESSION. scrollWidth past clientWidth is text the element is hiding --
    // which is what an ellipsis does, and what wrapping does not.
    const clipped = await page.$$eval(".results-panel .pl-name", (els) => els
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => ({ text: e.textContent.trim(), needs: e.scrollWidth, has: e.clientWidth })));
    check(clipped.length === 0, `${where}: no step name is cut off`, clipped.slice(0, 4));

    // A name squeezed to a sliver is unreadable even when it technically wraps.
    const narrowest = await page.$$eval(".results-panel .pl-name",
      (els) => Math.min(...els.map((e) => Math.round(e.getBoundingClientRect().width))));
    check(narrowest >= 110, `${where}: the name column keeps a readable width`, narrowest);

    // The three columns must survive: stacking them would leave the change and the
    // result on a line with no header to say which is which.
    const cols = await page.$$eval(".results-panel .pl-step .pl-row", (els) => {
      const tops = (sel) => els.map((e) => Math.round(e.querySelector(sel).getBoundingClientRect().top));
      const nameTops = tops(".pl-name"), valTops = tops(".pl-val");
      return nameTops.filter((t, i) => Math.abs(t - valTops[i]) > 6).length;
    });
    check(cols === 0, `${where}: name, change and result stay on one line each`, cols);

    const over = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    check(over.scrollW <= over.clientW + 1, `${where}: no horizontal overflow`, over);

    const hero = await page.locator(".ds-hero-total").first().evaluate((e) => ({
      text: e.textContent, width: Math.round(e.getBoundingClientRect().width), needs: e.scrollWidth,
    })).catch(() => null);
    check(!!hero && hero.needs <= hero.width + 1, `${where}: the headline total fits`, hero);

    check(errors.length === 0, `${where}: no page errors`, errors);
    await ctx.close();
  }
}

await browser.close();
console.log(ok ? "PASS" : "see failures");
process.exit(ok ? 0 : 1);
