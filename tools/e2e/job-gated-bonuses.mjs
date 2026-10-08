// "Poring dagger's aspd bonus is not limited to SN in the calc" — a player via
// Frennetix, 2026-10-07. Payon Stories' description: "If equipped by Novice or Super
// Novice, increases attack speed slightly."
//
// The item data carried the gate. What was missing was every name in it: BaseJob was
// declared on the script context but never populated, BaseClass was not declared at
// all, and no Job_* constant existed. Each made the condition throw "Unknown
// variable", which the evaluator turns into null, which the conditional stripper
// FAILS OPEN on — so the gate read as "always true" and 50 of the 51 job-gated items
// in the DB handed their bonus to every class.
//
// Checked the way a player sees it: the ASPD in the character stats panel, Poring
// Dagger against a plain Main Gauche (both Knife type, so base ASPD is identical and
// any difference is the item's +8%).
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const FE = new URL("file:///C:/Users/ervin/WebOpenPSCalc/open-ps-calc-frontend/frontend/");
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of blk.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

const PORING_DAGGER = 8165, MAIN_GAUCHE = 1209;
const link = (jobId, itemId) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: jobId, base_level: 99, job_level: 50,
    base_stats: { str: 1, agi: 90, vit: 1, int: 1, dex: 1, luk: 1 },
    equipped: { right_hand: itemId },
    target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1700 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const aspdFor = async (jobId, itemId) => {
  await page.goto(link(jobId, itemId), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    for (const c of document.querySelectorAll(".sec-stat-card"))
      if (c.querySelector(".sec-stat-label")?.textContent?.trim() === "ASPD") {
        const t = (c.querySelector(".sec-stat-value")?.textContent ?? "").trim();
        return t === "\u2014" ? null : Number(t);
      }
    return null;
  });
};

const JOBS = [
  ["Novice", 0, true],
  ["Super Novice", 23, true],
  ["Thief", 6, false],
  ["Knight", 7, false],
  ["Assassin", 12, false],
  ["Wizard", 9, false],
];

for (const [name, jobId, shouldGet] of JOBS) {
  const withDagger = await aspdFor(jobId, PORING_DAGGER);
  const withPlain = await aspdFor(jobId, MAIN_GAUCHE);
  if (withDagger == null || withPlain == null) { check(false, `${name}: could not read ASPD`); continue; }
  const delta = Number((withDagger - withPlain).toFixed(2));
  if (shouldGet) {
    check(delta > 0, `${name} keeps Poring Dagger's ASPD bonus (${withPlain} -> ${withDagger}, +${delta})`);
  } else {
    check(delta === 0, `${name} gets no ASPD bonus from Poring Dagger `
      + `(${withDagger} with it vs ${withPlain} with a plain Main Gauche, delta ${delta})`);
  }
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "job-gated-bonuses.png" });
console.log(ok ? "\nPASS - the class gate on item bonuses holds." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
