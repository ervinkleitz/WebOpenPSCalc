// "Triple attack under critical explosion should crit now" — Sandrea via Frennetix,
// 2026-10-10, citing wiki.payonstories.com/Critical_Explosion: "Triple Attack can
// critically hit while Critical Explosion is active."
//
// It already did. The engine has modelled it in both directions for a while
// (MO_TRIPLEATTACK_PS_BONUS + SC_EXPLOSIONSPIRITS), and the DPS moved accordingly —
// Monk/knuckle vs Orc Warrior went 390 -> 434 with Critical Explosion up. What was
// missing is that the Triple Attack panel only ever rendered the NON-crit branch, so
// the number a player stares at to answer "does this crit?" was byte-identical with
// the buff on and off. The crit was computed, folded into DPS, and never shown.
//
// So this guards the readout, not the maths: the crit row must appear exactly when
// Critical Explosion is up, and must carry the crit damage rather than a repeat of
// the normal figure.
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

// A Monk with a knuckle and Triple Attack 10, against a target with real DEF so the
// crit (which bypasses it) is plainly a different number rather than a rounding nudge.
// Against a 0-DEF Poring a pre-renewal crit is nearly identical to a normal hit, which
// would make this test look like it passed on noise.
const ORC_WARRIOR = 1023;
const link = (buffs) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 15, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 70, vit: 40, int: 20, dex: 60, luk: 30 },
    equipped: { right_hand: 1801 }, mastery_levels: { MO_TRIPLEATTACK: 10 },
    active_buffs: buffs, target_mob_id: ORC_WARRIOR,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const read = async (buffs) => {
  await page.goto(link(buffs), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5200);
  return page.evaluate(() => {
    const panel = [...document.querySelectorAll(".breakdown-view")]
      .find((v) => /Triple Attack/i.test(v.textContent || ""));
    if (!panel) return null;
    const rows = [...panel.querySelectorAll(".breakdown-total")].map((r) => ({
      label: r.querySelector(".breakdown-total-label")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      value: r.querySelector(".breakdown-total-val")?.textContent?.trim() ?? "",
    }));
    return { rows, text: panel.textContent.replace(/\s+/g, " ") };
  });
};
const num = (s) => Number(String(s).split("\u2013").pop().replace(/,/g, ""));

// --- without Critical Explosion: no crit row at all -------------------------
const off = await read({});
check(off != null, "the Triple Attack panel renders");
console.log(`    without Critical Explosion: ${JSON.stringify(off.rows)}`);
check(!off.rows.some((r) => /crit/i.test(r.label)),
  "with no Critical Explosion there is no crit row \u2014 which is itself the answer to \"does it crit?\"");

// --- with it: a crit row carrying the crit damage ---------------------------
const on = await read({ SC_EXPLOSIONSPIRITS: 5 });
console.log(`    with Critical Explosion Lv5: ${JSON.stringify(on.rows)}`);
const critRow = on.rows.find((r) => /crit/i.test(r.label));
check(!!critRow, "Critical Explosion adds a crit row to the Triple Attack panel");

const normalRow = on.rows.find((r) => /per-proc/i.test(r.label));
check(!!normalRow && !!critRow && num(critRow.value) > num(normalRow.value),
  `and it is the CRIT damage, higher than the ordinary proc because it skips the target's DEF `
  + `(${normalRow?.value} -> ${critRow?.value})`);

// The percentage shown must be the crit chance the DPS is actually weighted by, not
// the proc rate sitting in the panel header.
check(/\d+(\.\d+)?% of procs/.test(critRow?.label ?? ""),
  `the row states how often it crits (${JSON.stringify(critRow?.label)})`);
check(/Critical Explosion/i.test(on.text), "and the panel says Critical Explosion is why");

// The non-crit figure must not have moved — only the readout gained a row.
const offNormal = off.rows.find((r) => /per-proc/i.test(r.label));
check(offNormal?.value === normalRow?.value,
  `the ordinary proc damage is unchanged by this (${offNormal?.value} both ways)`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - Triple Attack shows its crit under Critical Explosion." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
