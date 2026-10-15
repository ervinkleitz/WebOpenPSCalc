// "I could see some value in the previous thing that felt like it averaged between
// crit and non-crit. Now it seems the 'Shadow Slash Lv 5' option is only non-crit?
// Or maybe I'm reading that wrong" — Mihtsuki via Frennetix, 2026-10-11.
//
// They were reading it right: each branch button shows ONE outcome, and the skill
// button shows the cast that does not crit. On a 70%-crit Ninja neither button is
// what you actually do per cast, and the blend — which the DPS, Hits to kill and
// Time to kill are all built from — was only reachable by dividing the DPS by the
// cast rate yourself.
//
// So "Average / cast" is now beside them. This test holds it to being the real
// blend, not a third arbitrary number: strictly between the two outcomes, equal to
// crit% × crit + (1−crit%) × non-crit, the same on every branch (it is the mix, not
// a branch), and consistent with the hit count it feeds.
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

const ZHERLTHSH = 1200;
const link = (job, weapon, skill, support, stats) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: job, base_level: 99, job_level: 50,
    base_stats: stats, equipped: { right_hand: weapon },
    support_buffs: support || {}, target_mob_id: ZHERLTHSH,
  },
  skill, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };
const ints = (s) => [...String(s ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2200 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const metrics = () => page.evaluate(() => {
  const out = {};
  for (const m of document.querySelectorAll(".summary-headline .metric")) {
    const k = m.querySelector(".label")?.textContent?.replace(/\s+/g, " ").trim();
    const v = m.querySelector(".value")?.textContent?.replace(/\s+/g, " ").trim();
    if (k) out[k] = { value: v, title: m.getAttribute("title") || "" };
  }
  return out;
});
const open = async (job, weapon, skill, support, stats) => {
  await page.goto(link(job, weapon, skill, support, stats), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5200);
};
const tab = async (name) => {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await page.waitForTimeout(1400);
  return metrics();
};

// === a skill that crits most of the time ===================================
await open(25, 1220, { id: 530, level: 5, label: "Shadow Slash" }, { shadows_within: true },
  { str: 80, agi: 80, vit: 40, int: 20, dex: 70, luk: 60 });

const onSkill = await tab("Shadow Slash");
console.log(`    skill tab: ${JSON.stringify(Object.fromEntries(Object.entries(onSkill).map(([k, v]) => [k, v.value])))}`);
check("Average / cast" in onSkill, "the skill branch shows an \"Average / cast\"");

const critPct = ints(onSkill["Crit chance"]?.value)[0];
const [nonCritMin, nonCritMax] = ints(onSkill["Damage range"]?.value);
const nonCrit = (nonCritMin + nonCritMax) / 2;
const avg = ints(onSkill["Average / cast"]?.value)[0];
const [hitsBest, hitsWorst] = ints(onSkill["Hits to kill"]?.value);

const onCrit = await tab("Critical hit");
const [critMin, critMax] = ints(onCrit["Damage range"]?.value);
const crit = (critMin + critMax) / 2;
console.log(`    non-crit ${nonCrit} | crit ${crit} | crit rate ${critPct}% | average ${avg}`);

// A build that crits 70% of the time must sit between the two, nearer the crit.
check(critPct > 50 && critPct < 100, `fixture check: the build crits sometimes, not always (${critPct}%)`);
check(crit > nonCrit, `fixture check: a crit hits harder than an ordinary cast (${crit} vs ${nonCrit})`);
check(avg > nonCrit && avg < crit,
  `the average is between the two outcomes, not one of them (${nonCrit} < ${avg} < ${crit})`);

// ...and it is the actual weighting, not just "something in the middle".
const expected = (critPct / 100) * crit + (1 - critPct / 100) * nonCrit;
check(Math.abs(avg - expected) <= Math.max(2, expected * 0.01),
  `it is crit% \u00d7 crit + (1\u2212crit%) \u00d7 non-crit (${Math.round(expected)} expected, ${avg} shown)`);

// The mix is a property of the build, not of the button you are on.
check(ints(onCrit["Average / cast"]?.value)[0] === avg,
  `the same figure shows on the Critical hit branch \u2014 it is the mix, not a branch (${onCrit["Average / cast"]?.value})`);

// And the hit count it feeds has to agree with it, or the panel contradicts itself.
const hp = ints(onSkill["Hits to kill"]?.title)[0];
check(hp > 1000, `fixture check: the tooltip names the target's HP (${hp})`);
const impliedHits = Math.ceil(hp / avg);
check(impliedHits >= hitsBest && impliedHits <= hitsWorst,
  `HP \u00f7 average = the Hits to kill it is built from (${hp}/${avg} = ${impliedHits}, panel says ${hitsBest}\u2013${hitsWorst})`);

// === and a build with one outcome, where the figure would be noise =========
// Bash cannot crit at all; at 100% hit chance with no procs there is exactly one
// outcome, so a second number saying the same thing is worse than none.
await open(7, 1129, { id: 5, level: 10, label: "Bash" }, {},
  { str: 90, agi: 40, vit: 40, int: 20, dex: 90, luk: 1 });
const bash = await tab("Bash");
console.log(`    Bash tab: hit ${bash["Hit chance"]?.value}, damage ${bash["Damage range"]?.value}, average ${bash["Average / cast"]?.value ?? "(none)"}`);
check(ints(bash["Hit chance"]?.value)[0] === 100, "fixture check: Bash never misses here, so there is nothing else to average");
check(!("Average / cast" in bash),
  "a single-outcome cast shows no average \u2014 it would just repeat the damage above it");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - the crit/non-crit blend is back, beside the outcomes it averages." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
