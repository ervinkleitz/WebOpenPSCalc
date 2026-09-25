// The Holy Strike proc must be VISIBLE, not just priced. The engine has computed it (and
// folded it into the DPS) since 2026-09-09, and since 2026-09-18 the Mummy + Ancient Mummy
// combo grants it to any class - but the damage panel only rendered autospell / auto_blitz /
// triple_attack / card_autocast_* branches, never `holy_strike`. A player looking at the
// page saw no trace of it and reported the combo as unimplemented, twice. So this asserts
// what the player SEES, loading the build through a share link like a player would.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");

// Encode a build the same way the app's share links do (z3_: keys renamed to their
// position in Z3_KEYS, then LZ-compressed). Read the key list from the source so this
// cannot drift from it.
function shareLink(state) {
  const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
  const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_left", "accessory_right"];
  const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
  const keys = [];
  for (const line of block.split("\n").slice(1)) {
    if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
    for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
  }
  const enc = {};
  keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
  const ren = (v) => Array.isArray(v) ? v.map(ren)
    : (v && typeof v === "object") ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
  return `${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`;
}

// The weapon has to be one the class can hold: the page drops an unequippable weapon, and
// the Mummy Card slotted in it with it (a Priest cannot hold the Knight's Sword).
const build = (job, extra = {}, weapon = 1101) => ({
  build: { job_id: job, base_level: 99, job_level: 50,
    base_stats: { str: 80, agi: 60, vit: 40, int: 20, dex: 40, luk: 30 },
    equipped: { right_hand: weapon, right_hand_card1: 4106, left_hand: 2101, left_hand_card1: 4248 }, // Mummy + Ancient Mummy
    target_mob_id: 1036, ...extra },                                                                // Ghoul (Undead)
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
});

const b = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

async function panels(state) {
  const page = await b.newPage({ viewport: { width: 1500, height: 1200 } });
  await page.goto(shareLink(state), { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const calc = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await calc.count()) { await calc.click(); await page.waitForTimeout(3000); }
  const out = await page.evaluate(() => ({
    heads: [...document.querySelectorAll(".breakdown-head")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
    // The whole Holy Strike panel, so the per-proc rows can be read too.
    holyStrike: [...document.querySelectorAll(".breakdown-view")]
      .map((v) => v.innerText.replace(/\s+/g, " ").trim())
      .find((t) => /Holy Strike/.test(t)) || "",
  }));
  await page.close();
  return out;
}
const panelText = async (state) => (await panels(state)).heads;

// A Knight with the pair: the combo alone grants a 7% proc.
const knight = await panelText(build(7));
const hsKnight = knight.find((h) => /Holy Strike/.test(h));
console.log("Knight panels:", knight.join(" | "));
check(hsKnight, "no Holy Strike panel for a Knight wearing the Mummy pair");
check(hsKnight && /7% per melee attack/.test(hsKnight), `Knight's Holy Strike should read 7% per melee attack, got: ${hsKnight}`);

// A Priest who learned it: it was invisible for Priests too, since the same render gap.
const priest = await panelText(build(8, { mastery_levels: { PS_PR_HOLYSTRIKE: 1 } }, 1501)); // Club
const hsPriest = priest.find((h) => /Holy Strike/.test(h));
check(hsPriest && /30% per melee attack/.test(hsPriest), `Priest's Holy Strike should read 30% (20 + LUK/10 + 7), got: ${hsPriest}`);

// Holy Strike crits like any weapon hit — wiki.payonstories.com/Holy_Strike, "Holy
// Strike can be a critical attack". The proc used to be built non-crit and pushed into
// DPS as a single outcome, so a battle priest's crit rate did nothing for it (reported
// 2026-09-25). The panel must now show both outcomes, and the crit must be the bigger.
const critPriest = await panels(build(8, { mastery_levels: { PS_PR_HOLYSTRIKE: 1 }, base_stats: { str: 90, agi: 60, vit: 40, int: 40, dex: 70, luk: 99 } }, 1501));
console.log("Holy Strike panel:", critPriest.holyStrike);
const critRow = /Per-proc damage \(critical\s*[\u2014-]\s*([\d.]+)% of procs\)\s*([\d,]+)/i.exec(critPriest.holyStrike);
const normRow = /Per-proc damage \(normal\)\s*([\d,]+)/i.exec(critPriest.holyStrike);
check(!!critRow, `the Holy Strike panel must show its critical outcome, got: ${critPriest.holyStrike}`);
check(!!normRow, `the Holy Strike panel must still show its normal outcome, got: ${critPriest.holyStrike}`);
if (critRow && normRow) {
  const critDmg = Number(critRow[2].replace(/,/g, ""));
  const normDmg = Number(normRow[1].replace(/,/g, ""));
  const critPct = Number(critRow[1]);
  console.log(`  normal ${normDmg}  |  critical ${critDmg} on ${critPct}% of procs`);
  check(critDmg > normDmg, `a critical proc must hit harder (${critDmg} vs ${normDmg})`);
  check(critPct > 1, `the crit share should be the character's real crit rate, got ${critPct}%`);
}

// No combo, no skill: no panel.
const plain = await panelText({ ...build(7), build: { ...build(7).build, equipped: { right_hand: 1101 } } });
check(!plain.some((h) => /Holy Strike/.test(h)), "a plain Knight must not show a Holy Strike panel");

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
