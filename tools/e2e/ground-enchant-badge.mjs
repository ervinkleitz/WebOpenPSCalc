// Reported in #wiki-and-calculator 2026-10-20 by a Sage: turning on Violent Gale
// "seems to decrease damage against siroma with lightning bolt? I don't see why".
//
// It doesn't. Against a Siroma (Water 3) the gale takes Lightning Bolt Lv5 from
// 5,620–9,140 to 6,180–10,050. What they were reading was the CHANGE badge beside
// the enchant row, which said "−368".
//
// The breakdown used to carry a separate ground-enchant row. It was an annotation —
// it recorded that Volcano / Deluge / Violent Gale had been counted, while the bonus
// itself lands on the element multiplier (×2.00 becomes ×2.20) — so it had no running
// total of its own and printed "—". The change column read that missing total as zero
// and announced the loss of the entire running damage.
//
// The row is gone now: a row that moves no number should not be in a column of
// numbers. What it existed to tell you moved into the element row's own note, beside
// the multiplier it actually explains.
//
// Both halves are checked, because fixing the display would be worthless if the
// damage were genuinely wrong, and correct damage is no good if the breakdown
// contradicts it.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
function shareLink(state) {
  const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
  const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_left", "accessory_right"];
  const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
  const keys = [];
  for (const line of block.split("\n").slice(1)) {
    if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
    for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
  }
  const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
  const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object") ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
  return `${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`;
}

let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};
const num = (s) => Number(String(s).replace(/[^\d]/g, ""));

// The reported build, decoded from the share link in the report (?s=3BCHQD0).
const BUILD = {
  build: {
    job_id: 16, base_level: 63, job_level: 29,
    base_stats: { agi: 45, int: 80 }, bonus_stats: { int: 5 },
    equipped: { right_hand: 81005 },
    target_mob_id: 1776,
    active_buffs: { SC_DOUBLECASTING: 1, SC_ENERGYCOAT: 1 },
    mastery_levels: { SA_DRAGONOLOGY: 5, SA_ADVANCEDBOOK: 5, SA_FREECAST: 5, MG_FIREBALL: 10 },
    clan: "arch_wand_clan", selected_pet: "munak",
    support_buffs: { ground_effect: "SC_VIOLENTGALE", ground_effect_lv: 3 },
  },
  skill: { id: 20, level: 5, label: "Lightning Bolt" },
  targetMode: "monster",
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1600 } })).newPage();
await page.goto(shareLink(BUILD), { waitUntil: "networkidle" });
await page.waitForTimeout(3500);

const calculate = async () => {
  const b = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(4000); }
};
// Every breakdown row as {badge, name, val}.
const rows = () => page.$$eval(".pl-track .pl-row", (els) => els.map((e) => ({
  badge: (e.querySelector(".pl-badge")?.textContent || "").trim(),
  name: (e.querySelector(".pl-name")?.textContent || "").trim(),
  val: (e.querySelector(".pl-val")?.textContent || "").trim(),
})));
// The headline total is rendered outside .pl-track, so the breakdown's own last
// row carrying a running total IS the final figure.
const finalOf = (rs) => [...rs].reverse().find((r) => r.val && r.val !== "—")?.val || "";
// Buff groups collapse like equipment slots, so a control that lives in one starts
// hidden -- and `hidden` takes it out of the accessibility tree as well as off the
// screen, so getByRole finds nothing and scrollIntoViewIfNeeded waits for an element
// that will never be visible. A player opens the group once and the browser
// remembers; a fresh context never has. Reaching the control is not what this test
// is about.
const expandBuffGroups = async (pg) => {
  const btn = pg.locator('[data-panel="buffs"]').getByRole("button", { name: /expand all/i }).first();
  if (await btn.count()) { await btn.click(); await pg.waitForTimeout(500); }
};

await expandBuffGroups(page);

const ge = page.locator(".field", { has: page.locator("label", { hasText: /^Ground effect$/ }) }).locator("select").first();
await ge.scrollIntoViewIfNeeded();

await calculate();
const on = await rows();
await ge.selectOption("");
await page.waitForTimeout(600);
await calculate();
const off = await rows();
await ge.selectOption("SC_VIOLENTGALE");
await page.waitForTimeout(600);
await calculate();

// ---- 1. the gale RAISES the damage -----------------------------------------
const hiOn = num(finalOf(on).split("–")[1]), hiOff = num(finalOf(off).split("–")[1]);
check(hiOn > hiOff, "Violent Gale must raise Lightning Bolt against a Water target",
  { off: finalOf(off), on: finalOf(on) });

// ---- 2. ...by landing on the element multiplier -----------------------------
const eleOn = on.find((r) => /Element vs target/i.test(r.name));
const eleOff = off.find((r) => /Element vs target/i.test(r.name));
// A whole multiplier prints without decimals, so 200% is "×2", not "×2.00".
check(eleOn?.badge === "×2.20" && eleOff?.badge === "×2",
  "the +20% shows up on the element row, where it is actually applied",
  { off: eleOff?.badge, on: eleOn?.badge });

// ---- 3. ...and there is no phantom row to misread ---------------------------
// This is the report: that row showed "−368" beside a dash.
const ench = on.find((r) => /enchant/i.test(r.name));
check(!ench, "no separate enchant row in the running-total column", ench);
check(on.every((r) => r.val && r.val !== "—"),
  "every row in the breakdown carries a running total",
  on.filter((r) => !r.val || r.val === "—").map((r) => r.name));

// ---- 3b. the provenance survived, on the row it belongs to ------------------
// Losing the row must not lose the explanation: without it the element row reads
// 220% where the element table says 200%, and nothing accounts for the difference.
const note = await page.locator(".pl-step", { has: page.locator(".pl-name", { hasText: "Element vs target" }) })
  .locator(".pl-note").first().innerText().catch(() => "");
check(/violent gale/i.test(note) && /200%/.test(note) && /220%/.test(note),
  "the element row's note shows where the extra 20% came from", note.trim());

// ---- 4. nothing else in the breakdown reports a phantom loss ----------------
// Every remaining "−" badge must sit on a row that really did lower the total.
const bad = [];
let lastTotal = null;
for (const r of on) {
  const v = r.val === "—" ? null : num(r.val.split("–")[0]);
  if (r.badge.startsWith("−") && lastTotal != null && v != null && v >= lastTotal) {
    bad.push(`${r.name}: ${r.badge} but ${lastTotal} -> ${v}`);
  }
  if (v != null) lastTotal = v;
}
check(bad.length === 0, "no row reports a drop the running total does not show", bad);

const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.waitForTimeout(300);
check(errs.length === 0, "no page errors", errs);

await browser.close();
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
