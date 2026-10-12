// "the skill/normal hit/crit hit selection on the calculation is a bit confusing. If
// I select skill or crit it seems to work with the skill, but if I select normal it
// seems to just use an attack" — Mihtsuki via Frennetix, 2026-10-10. Beerbelly
// Slinger, in the same thread: "That normal hit means auto attack." He was right.
//
// The three buttons were not what they looked like. With a skill selected:
//   [Skill]        the skill
//   Normal hit     your AUTO ATTACK — a different attack, so no skill ratio
//   Critical hit   the SKILL, critting — the same attack, so the ratio applies
//
// So two of them looked like a pair and were not: one swapped the attack, the other
// swapped the state. Read together, "Normal hit" next to "Critical hit" means "the
// skill's non-crit hit", which is what the first button already shows. Measured on
// Sonic Blow Lv10: skill 2936, "Normal hit" 296, "Critical hit" 2936.
//
// Nothing was miscalculated — every number was right for what it computed. The label
// was wrong, so it is "Auto attack" now, in both states (it used to be "Normal
// Attack" with no skill selected and "Normal hit" with one: the same thing, two
// names).
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

// Assassin + katar: Sonic Blow is the clean reproduction because it is one of the
// skills that CAN crit, so all three buttons render. (Shadow Slash, the skill in the
// report, cannot crit — it only ever shows two.)
const link = (skill) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 70, agi: 70, vit: 40, int: 20, dex: 60, luk: 40 },
    equipped: { right_hand: 1263 }, target_mob_id: 1002,
  },
  skill, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1700 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const open = async (skill) => {
  await page.goto(link(skill), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Calculate damage" }).click();
  await page.waitForTimeout(5000);
};
const branchButtons = () => page.evaluate(() => {
  const t = document.querySelector(".branch-toggle");
  return t ? [...t.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
});
const shownDamage = () => page.evaluate(() => {
  const vals = [...document.querySelectorAll(".pl-track .pl-step .pl-val")];
  if (!vals.length) return null;
  const m = [...vals[vals.length - 1].textContent.replace(/,/g, "").matchAll(/\d+/g)].map(Number);
  return m.length ? m[m.length - 1] : null;
});

// --- with no skill: one button, named for what it is ------------------------
await open({ id: 0, level: 1, label: "Normal Attack" });
const noSkill = await branchButtons();
check(noSkill[0] === "Auto attack", `with no skill the first branch is "Auto attack" (got ${JSON.stringify(noSkill)})`);
const autoAlone = await shownDamage();
console.log(`    auto attack on its own: ${autoAlone}`);

// --- with a skill: the same thing keeps the same name -----------------------
await open({ id: 136, level: 10, label: "Sonic Blow" });
const withSkill = await branchButtons();
console.log(`    branches with a skill: ${JSON.stringify(withSkill)}`);
check(withSkill.includes("Auto attack"),
  "with a skill selected it is still called \"Auto attack\", not renamed");
check(!withSkill.some((b) => /normal/i.test(b)),
  "nothing is called \"Normal hit\" or \"Normal Attack\" any more");

// The assertion that makes the label honest: the button called "Auto attack" must
// show the auto attack's damage, the same number you get with no skill selected.
await page.getByRole("button", { name: "Auto attack", exact: true }).first().click();
await page.waitForTimeout(1500);
const autoBeside = await shownDamage();
console.log(`    "Auto attack" while Sonic Blow is selected: ${autoBeside}`);
check(autoBeside === autoAlone,
  `and it really is the auto attack \u2014 same damage as with no skill selected (${autoAlone} vs ${autoBeside})`);

// ...while the skill and its crit are the skill, several times larger.
await page.getByRole("button", { name: /^Sonic Blow/ }).first().click();
await page.waitForTimeout(1500);
const skillDmg = await shownDamage();
check(skillDmg != null && autoAlone != null && skillDmg > autoAlone * 2,
  `the skill is plainly a different number (${autoAlone} auto vs ${skillDmg} skill)`);

if (withSkill.includes("Critical hit")) {
  await page.getByRole("button", { name: "Critical hit", exact: true }).first().click();
  await page.waitForTimeout(1500);
  const critDmg = await shownDamage();
  console.log(`    "Critical hit": ${critDmg}`);
  check(critDmg != null && critDmg > autoAlone * 2,
    `"Critical hit" is the SKILL critting, not the auto attack's crit (${critDmg})`);
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - the branch labels say what they compute." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
