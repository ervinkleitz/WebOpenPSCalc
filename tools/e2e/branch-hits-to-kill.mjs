// "would be nice to select crit and normal hit for skill" / "at least for slashing
// the 'average amount of hits' doesn't tend to be that useful" — Mihtsuki via
// Frennetix, 2026-10-10. Two separate things, both guarded here.
//
// 1. "Hits to kill" is deliberately the same number on every branch: it shares one
//    basis with "Time to kill" (expected damage per attack cycle), so the two cannot
//    contradict each other. An earlier version used the displayed branch's per-hit
//    damage and produced the nonsense of a big-crit build showing FEWER hits but a
//    SLOWER time. That basis stays — but it means clicking Critical hit told you
//    nothing new, which is the complaint. So there is now an "All crits" figure
//    beside it: how many of THAT hit alone would do it.
//
// 2. Shadow Slash ("slashing") cannot crit on Payon Stories unless Shadow's Within is
//    up, so its branch row simply ended with no Critical hit button and no reason
//    given — indistinguishable from "this skill never crits". It now says so.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
// Resolved from this script's own location, so the suite runs from any checkout on
// any OS. It used to be an absolute path to one developer's machine.
const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
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

// Zherlthsh: 18,300 HP. Big enough that a kill takes several hits, so the counts are
// meaningful — against something a skill one-shots every branch reads "1" and the
// whole test would pass on nothing.
const ZHERLTHSH = 1200;
const link = (job, weapon, skill, support) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: job, base_level: 99, job_level: 50,
    base_stats: { str: 80, agi: 80, vit: 40, int: 20, dex: 70, luk: 60 },
    equipped: { right_hand: weapon }, support_buffs: support || {}, target_mob_id: ZHERLTHSH,
  },
  skill, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const metrics = () => page.evaluate(() => {
  const out = {};
  for (const m of document.querySelectorAll(".metric")) {
    const k = m.querySelector(".label")?.textContent?.replace(/\s+/g, " ").trim();
    const v = m.querySelector(".value")?.textContent?.replace(/\s+/g, " ").trim();
    if (k) out[k] = v;
  }
  return out;
});
const branches = () => page.evaluate(() => {
  const t = document.querySelector(".branch-toggle");
  return t ? [...t.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
});
const note = () => page.evaluate(() => document.querySelector(".branch-note")?.textContent?.trim() ?? null);
const open = async (job, weapon, skill, support) => {
  await page.goto(link(job, weapon, skill, support), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5200);
};
// "7 min – 7 max" must read as 7, not 77. Stripping every non-digit concatenated the
// two ends of the range and made the comparison below pass against any value at all.
const int = (s) => {
  const m = String(s ?? "").match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : 0;
};

// === 1. the per-branch count ===============================================
await open(12, 1263, { id: 136, level: 10, label: "Sonic Blow" }, {});
await page.getByRole("button", { name: "Critical hit", exact: true }).first().click();
await page.waitForTimeout(1500);
const m = await metrics();
console.log(`    crit branch metrics: ${JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => /kill|all /i.test(k))))}`);

check("All crits" in m, "the crit branch shows an \"All crits\" count");
const blended = int(m["Hits to kill"]);
const allCrits = int(m["All crits"]);
check(blended > 0 && allCrits > 0, `both counts are present (blended ${blended}, all-crits ${allCrits})`);
// Crits hit harder, so it must take FEWER of them than the realistic mixed count.
// If this ever reads higher, the new figure is not the branch's own count.
check(allCrits < blended,
  `fewer crits than mixed hits are needed, which is the point of the figure (${allCrits} vs ${blended})`);
// Time to kill must NOT have followed it: that is the inconsistency this design
// deliberately avoids.
const t1 = m["Time to kill"];
await page.getByRole("button", { name: /^Sonic Blow/ }).first().click();
await page.waitForTimeout(1500);
const m2 = await metrics();
check(m2["Time to kill"] === t1,
  `Time to kill stays put across branches \u2014 it is the realistic figure (${t1} both)`);

// === 2. Shadow Slash explains its missing crit =============================
await open(25, 1220, { id: 530, level: 5, label: "Shadow Slash" }, {});
const b1 = await branches(), n1 = await note();
console.log(`    Shadow Slash, no buff: ${JSON.stringify(b1)}  note: ${JSON.stringify(n1)}`);
check(!b1.includes("Critical hit"), "Shadow Slash has no Critical hit branch without Shadow's Within");
check(n1 != null && /Shadow's Within/i.test(n1),
  `and says why instead of just ending (${JSON.stringify(n1)})`);

await open(25, 1220, { id: 530, level: 5, label: "Shadow Slash" }, { shadows_within: true });
const b2 = await branches(), n2 = await note();
console.log(`    Shadow Slash + Shadow's Within: ${JSON.stringify(b2)}  note: ${JSON.stringify(n2)}`);
check(b2.includes("Critical hit"), "ticking Shadow's Within gives it a Critical hit branch");
check(n2 == null, "and the note goes away, because there is nothing left to explain");

// A skill that simply cannot crit must NOT get the note \u2014 it is specific, not a
// blanket "maybe there's a buff".
await open(7, 1129, { id: 5, level: 10, label: "Bash" }, {});
check(await note() === null, "a skill that just cannot crit shows no note");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - per-branch hit counts, and Shadow Slash explains its missing crit." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
