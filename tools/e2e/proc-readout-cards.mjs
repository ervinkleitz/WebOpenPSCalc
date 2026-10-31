// A proc readout replaces the step table, and its button carries its figure.
//
// WHY THIS EXISTS: these readouts — Triple Attack, Double Attack, Auto Spell,
// Auto Blitz, card autocast, and Grand Cross' recoil onto its own caster — have
// lived in three places. They were APPENDED under the breakdown, all of them at
// once, so a Monk with an autocast card scrolled past three full step tables he
// had not asked for. Then they went behind buttons below the panel. They now sit
// in the attack row and REPLACE the step table when picked, because they answer
// the same question the table does, and showing two at once left the reader
// working out which one the headline belonged to.
//
// Each move broke something a numbers test could not see. Flattening the main
// table into a column was written on the shared .breakdown-view class and took the
// border off all five proc panels. Moving them into a container dropped a
// `.ds-columns ~` SIBLING rule and they stretched to 1389px of a 1436px panel.
// Twelve suite scripts drive these exact builds and passed through both, because
// they assert damage figures and the figures were never wrong.
//
// So this checks the shape: the button exists and states its damage, picking it
// swaps the table rather than adding to it, one view is current at a time, and the
// readout is sized by the column it now occupies rather than by the panel.
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
  // Double Attack renders .dw-per-hit inside its own total, nested exactly as the
  // main Final damage row does — which is how a rule meant for that row once
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
  // Not a proc, but it shares the row and the mechanism.
  "Crusader · Grand Cross recoil": {
    build: {
      job_id: 14, base_level: 99, job_level: 50,
      base_stats: { str: 33, agi: 1, vit: 44, int: 99, dex: 75, luk: 1 },
      equipped: { right_hand: 1127 }, target_mob_id: 1219,
    },
    skill: { id: 254, level: 10, label: "Grand Cross" }, targetMode: "monster",
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

// Which button LOOKS current, measured rather than inferred from a class name.
// The class check below passed for a release in which the deselected "Normal
// attack" kept an accent fill, an accent border and 600 weight while the button
// that actually was selected had only a thin border -- the deselected one read as
// the louder of the two. A class is what the code believes; this is what is on
// screen.
const selectionLook = (page) => page.$$eval(".branch-toggle button", (els) => els.map((e) => {
  const cs = getComputedStyle(e);
  return {
    text: e.textContent.replace(/\s+/g, " ").trim().slice(0, 24),
    active: e.classList.contains("active"),
    paint: `${cs.backgroundColor}|${cs.borderColor}`,
  };
}));

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
    // Case-insensitive: the narrow layout uppercases these headings in CSS, and
    // innerText reports the transformed text.
    const mainText = () => page.locator(".ds-columns-main").first().innerText()
      .then((t) => t.replace(/\s+/g, " "));

    const buttons = page.locator(".branch-toggle .ds-extra-btn");
    const n = await buttons.count();
    check(n > 0, `${where}: the readout has a button in the attack row`, n);
    if (!n) { await ctx.close(); continue; }

    // The figure ON the button: the row cannot be compared without opening things
    // if the buttons are bare labels.
    const label = (await buttons.first().innerText()).replace(/\s+/g, " ").trim();
    check(/\d/.test(label), `${where}: the button states its damage`, label);

    check(/damage calculation/i.test(await mainText()),
      `${where}: the step table is what shows to begin with`);
    const current = await page.$$eval(".branch-toggle button.active",
      (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    check(current.length === 1, `${where}: exactly one view is current`, current);

    await buttons.first().click();
    await page.waitForTimeout(900);

    const after = await mainText();
    check(!/damage calculation/i.test(after),
      `${where}: picking it replaces the step table`, after.slice(0, 50));
    check(await page.locator(".ds-columns-aside").count() === 1,
      `${where}: survivability stays beside it`);
    const now = await page.$$eval(".branch-toggle button.active",
      (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    check(now.length === 1 && /\d/.test(now[0]),
      `${where}: and it is the only one current`, now);

    // ...and it is the only one that LOOKS current. No inactive button may share
    // the selected button's paint.
    const look = await selectionLook(page);
    const sel = look.find((b) => b.active);
    const impostors = look.filter((b) => !b.active && sel && b.paint === sel.paint);
    check(impostors.length === 0,
      `${where}: no deselected button still looks selected`,
      { selected: sel && sel.text, impostors: impostors.map((b) => b.text) });

    // Sized by its column, not the panel — the rule a sibling selector dropped once.
    const widths = await page.evaluate(() => {
      const col = document.querySelector(".ds-columns-main");
      const panel = document.querySelector(".results-panel");
      const body = col && col.firstElementChild;
      return {
        panel: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        readout: body ? Math.round(body.getBoundingClientRect().width) : 0,
      };
    });
    check(widths.readout > 0 && (widths.panel < 900 || widths.readout < widths.panel * 0.95),
      `${where}: the readout is sized by its column, not the panel`, widths);

    const perHit = await page.$$eval(".ds-columns-main .breakdown-total-val .dw-per-hit",
      (els) => els.map((e) => ({ text: e.textContent.trim().slice(0, 20), display: getComputedStyle(e).display })));
    for (const ph of perHit) {
      check(ph.display === "inline", `${where}: a proc total's per-hit figure stays inline`, ph);
    }

    await page.locator(".branch-toggle button").first().click();
    await page.waitForTimeout(900);
    check(/damage calculation/i.test(await mainText()),
      `${where}: an attack button brings the step table back`);

    const over = await page.evaluate(() => document.documentElement.scrollWidth
      > document.documentElement.clientWidth + 1);
    check(!over, `${where}: no horizontal overflow`);
    check(errors.length === 0, `${where}: no page errors`, errors);
    await ctx.close();
  }
}

await browser.close();
console.log(ok ? "PASS" : "see failures");
process.exit(ok ? 0 : 1);
