// "the Damage/Hit section from pins is drawing from the first Final Damage subtable,
// rather than the Final Damage at the end; the Hits to Kill line is affected by this
// as a consequence" — Frennetix, 2026-10-10.
//
// A PS dual-wield Assassin lands two right-hand hits and one left-hand hit in a
// single swing, and the breakdown prints each weapon's sub-total before the swing
// total. The Compare columns read `result.normal` straight off the response — the
// right hand's share — so a pin said "Damage / hit 1,625" directly above a breakdown
// ending on "Final damage 5,074–5,327", and its Hits to kill was wrong by the same
// factor.
//
// Both now go through lib/killMetrics. This test puts the two readouts side by side
// and refuses to let them disagree.
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
for (const l of blk.split("\n").slice(1)) {
  if (l.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of l.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;

// Zherlthsh, 18,300 HP — enough that a kill takes a double-digit number of swings,
// so a hit count off by a factor of three is unmissable rather than a rounding nudge.
const ZHERLTHSH = 1200;
// Assassin with a Gladius in each hand: the dual-wield path, which is the one that
// splits the breakdown into per-weapon sub-tables.
const link = (equipped, skill) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 90, vit: 40, int: 20, dex: 70, luk: 40 },
    equipped, target_mob_id: ZHERLTHSH,
  },
  skill: skill ?? { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The headline metrics of the breakdown panel, plus the breakdown's own final line.
const panel = () => page.evaluate(() => {
  const metrics = {};
  for (const m of document.querySelectorAll(".results-panel .summary-headline .metric")) {
    const k = m.querySelector(".label")?.textContent?.replace(/\s+/g, " ").trim();
    const v = m.querySelector(".value")?.textContent?.replace(/\s+/g, " ").trim();
    if (k) metrics[k] = v;
  }
  const view = [...document.querySelectorAll(".breakdown-view")][0] || null;
  const finals = view ? [...view.querySelectorAll(".breakdown-total")]
    .filter((r) => /final damage/i.test(r.querySelector(".breakdown-total-label")?.textContent || ""))
    .map((r) => r.querySelector(".breakdown-total-val")?.textContent?.replace(/\s+/g, " ").trim()) : [];
  // Each weapon's own final line inside the step list — the first of these is the
  // right-hand sub-total the pin used to quote as the whole swing.
  const subTotals = view ? [...view.querySelectorAll(".pl-row--final")]
    .map((e) => e.textContent.replace(/\s+/g, " ").trim()) : [];
  return { metrics, finals, subTotals };
});

// The Compare table, as a {rowLabel: [cells]} map.
const compare = () => page.evaluate(() => {
  const table = document.querySelector(".compare-table");
  if (!table) return null;
  const out = {};
  for (const tr of table.querySelectorAll("tbody tr")) {
    const label = tr.querySelector(".cmp-metric-label")?.textContent?.trim();
    if (!label) continue;
    out[label] = [...tr.querySelectorAll("td:not(.cmp-metric-label)")].map((td) => ({
      val: td.querySelector(".cmp-val")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      range: td.querySelector(".cmp-val-range")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    }));
  }
  return out;
});

const open = async (equipped, skill) => {
  await page.goto(link(equipped, skill), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5200);
};
// First number in a string: "5,074–5,327" -> 5074. Stripping every non-digit would
// concatenate the two ends of a range into one meaningless number.
const int = (s) => {
  const m = String(s ?? "").match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : NaN;
};
const ints = (s) => [...String(s ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));

// === a dual-wielding Assassin, the shape that exposed this =================
const GLADIUS = 1221;
await open({ right_hand: GLADIUS, left_hand: GLADIUS });

const p = await panel();
console.log(`    panel: ${JSON.stringify({ range: p.metrics["Damage range"], hits: p.metrics["Hits to kill"], ttk: p.metrics["Time to kill"], final: p.finals })}`);
const [panelMin, panelMax] = ints(p.metrics["Damage range"]);
check(Number.isFinite(panelMin) && Number.isFinite(panelMax) && panelMax > 0,
  `the panel quotes a damage range (${panelMin}\u2013${panelMax})`);
// The final line of the breakdown is the swing total; it must agree with the
// headline range, or the panel is already contradicting itself.
const [finalMin, finalMax] = ints(p.finals[0]);
check(finalMin === panelMin && finalMax === panelMax,
  `and the breakdown's final line is that same swing (${p.finals[0]})`);

// The per-weapon sub-totals must be present AND clearly smaller than the swing —
// otherwise this build is not dual-wielding and every assertion below passes on
// nothing. This is the gap the bug lived in.
console.log(`    per-weapon sub-totals: ${JSON.stringify(p.subTotals)}`);
check(p.subTotals.length >= 2, `the breakdown splits into per-weapon sub-tables (${p.subTotals.length} final rows)`);
const rhSub = ints(p.subTotals[0]).filter((n) => n > 1);
const rhAvg = rhSub.length > 1 ? Math.round((rhSub[0] + rhSub[rhSub.length - 1]) / 2) : rhSub[0];
check(rhAvg > 0 && rhAvg < panelMin * 0.9,
  `and the right-hand sub-total (${rhAvg}) is well under the swing (${panelMin}–${panelMax}), so the two cannot be confused by accident`);

await page.getByRole("button", { name: "Pin current" }).click();
await page.waitForTimeout(1200);

const c = await compare();
check(c != null && !!c["Damage / hit"], "pinning adds a Compare column");
const dmgCells = c["Damage / hit"];
console.log(`    compare "Damage / hit": ${JSON.stringify(dmgCells)}`);
console.log(`    compare "Hits to kill": ${JSON.stringify(c["Hits to kill"])}`);
console.log(`    compare "Time to kill": ${JSON.stringify(c["Time to kill"])}`);

// Every column (the pin and the live build are the same build here) must quote the
// swing the panel shows, not one weapon's share of it.
const mid = Math.round((panelMin + panelMax) / 2);
for (const [i, cell] of dmgCells.entries()) {
  const avg = int(cell.val);
  const [lo, hi] = ints(cell.range);
  check(Math.abs(avg - mid) <= 1,
    `column ${i + 1} damage/hit is the swing total, not one weapon's hit (${avg} vs the panel's ${panelMin}\u2013${panelMax})`);
  check(lo === panelMin && hi === panelMax,
    `column ${i + 1} quotes the panel's own range (${cell.range})`);
  check(avg !== rhAvg,
    `column ${i + 1} is not the right-hand sub-table (${rhAvg}) — the exact bug reported`);
}

// Hits to kill must sit inside the best/worst envelope the panel prints, which is
// what it means for the two to share a basis. Before the fix the pin reported ~3x
// the panel's count, far outside it.
const [hitsBest, hitsWorst] = ints(p.metrics["Hits to kill"]);
for (const [i, cell] of c["Hits to kill"].entries()) {
  const h = int(cell.val);
  check(h >= hitsBest && h <= hitsWorst,
    `column ${i + 1} hits to kill (${h}) is inside the panel's ${hitsBest}\u2013${hitsWorst}`);
}
// Time to kill was already right; assert it so a future change cannot "fix" the
// damage by moving the duration instead.
const panelTtk = ints(p.metrics["Time to kill"])[0];
for (const [i, cell] of c["Time to kill"].entries()) {
  check(Math.abs(ints(cell.val)[0] - panelTtk) <= 0.1,
    `column ${i + 1} time to kill matches the panel (${cell.val} vs ${p.metrics["Time to kill"]})`);
}

// === and a single-weapon skill build, which must not have moved ============
// The dual-wield total is the exception, not the rule: a one-handed skill build's
// columns have to keep reading the skill's own damage.
await open({ right_hand: GLADIUS }, { id: 136, level: 10, label: "Sonic Blow" });
// A page load drops the pins, so pin again before the table exists.
await page.getByRole("button", { name: "Pin current" }).click();
await page.waitForTimeout(1200);
const p2 = await panel();
const c2 = await compare();
const [min2, max2] = ints(p2.metrics["Damage range"]);
console.log(`    single-weapon Sonic Blow panel: ${p2.metrics["Damage range"]}  compare: ${JSON.stringify(c2?.["Damage / hit"]?.[0])}`);
const live2 = c2["Damage / hit"][c2["Damage / hit"].length - 1];
check(ints(live2.range)[0] === min2 && ints(live2.range)[1] === max2,
  `a one-handed skill build still shows the skill's own damage (${live2.range})`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - pinned columns quote the same swing the breakdown ends on." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
