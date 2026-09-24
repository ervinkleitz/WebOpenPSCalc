// Two reports from one player, 2026-09-24:
//
//   "Spear boom doesn't exist."
//   "And can you add the option for lv 10 waterball? Rogues can plagiarize that
//    from monsters xD"
//
// Spear Boomerang WAS in the picker, under a name nobody uses: the scraped PS skill
// DB called skill 59 "Sonic Wave" (that is RK_SONICWAVE, a Rune Knight skill), so
// typing what the wiki and the game call it found nothing.
//
// Water Ball stops at 5 for a Wizard, but Ktullanux, Turtle General, Pouring and
// Hardrock Mammoth all cast it at 10 and Plagiarism copies the rank used on you — so
// a Rogue can hold Water Ball 10, and the picker has to offer that rank. The cap is
// widened for the copying jobs only; a Wizard's own Water Ball still stops at 5.
//
// Target: Teddy Bear (1622), Neutral Lv3, so Water lands at 100% and the ratio
// between the two ranks is readable straight off the page.
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

const browser = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

const build = (jobId) => ({
  build: {
    job_id: jobId, base_level: 99, job_level: 50,
    base_stats: { str: 1, agi: 40, vit: 40, int: 99, dex: 90, luk: 1 },
    equipped: {}, target_mob_id: 1622,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
});

async function openEditor(jobId) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
  await page.goto(shareLink(build(jobId)), { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return page;
}

// The picker auto-selects when a query matches exactly one skill, so typing the
// name is the whole interaction — which is also what the player did.
async function pickSkill(page, query) {
  const box = page.locator(".search-combo input").last();
  await box.fill(query);
  await page.waitForTimeout(1600);
}
const pill = (page) => page.locator(".selected-pill").first();
const rankInput = (page) => pill(page).locator("input[type=number]").first();

// The headline's "Damage range" card, as a mid-point — one number to compare ranks by.
async function damage(page) {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(4500);
  const text = (await page.locator(".metric-range .value").first().innerText().catch(() => ""))
    .replace(/\s+/g, " ");
  // The card is upper-cased in CSS and innerText returns it that way, hence /i.
  const nums = [...text.matchAll(/([\d,]+)\s*(?:min|max)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
  return nums.length === 2 ? (nums[0] + nums[1]) / 2 : null;
}

// ---------------------------------------------------------------- Spear Boomerang
{
  const page = await openEditor(7); // Knight
  await pickSkill(page, "spear boom");
  const label = (await pill(page).innerText()).replace(/\s+/g, " ").trim();
  console.log("knight, typed 'spear boom':", label);
  check(/Spear Boomerang/i.test(label),
    `typing "spear boom" should select Spear Boomerang, the pill reads "${label}"`);
  check(!/Sonic Wave/i.test(label), `the picker still calls it Sonic Wave: "${label}"`);
  await page.context().close();
}

// -------------------------------------------------------------- Water Ball, Rogue
{
  const page = await openEditor(17); // Rogue
  await pickSkill(page, "water ball");
  const cap = await rankInput(page).getAttribute("max");
  console.log("rogue, water ball rank cap:", cap);
  check(cap === "10", `a Rogue's copied Water Ball should offer 10 ranks, the input caps at ${cap}`);

  await rankInput(page).fill("10");
  await page.waitForTimeout(400);
  const at10 = await damage(page);
  await rankInput(page).fill("5");
  await page.waitForTimeout(400);
  const at5 = await damage(page);
  console.log(`rogue water ball: Lv5 = ${at5}, Lv10 = ${at10}`);
  check(at5 != null && at10 != null, "the page did not produce a damage figure");
  if (at5 && at10) {
    // 100 + 30 x lv: 250% at Lv5, 400% at Lv10. Every later step is multiplicative,
    // so the ratio survives to the headline within rounding.
    check(at10 > at5, `Lv10 must beat Lv5 (${at10} vs ${at5}) — the old build recomputed both as Lv5`);
    // 400/250 = 1.60 on the ratio step alone. The figure on screen sits a little
    // above that because soft MDEF is a FLAT subtraction taken after the ratio, so it
    // costs the smaller number proportionally more — hence a band, not an equality.
    const ratio = at10 / at5;
    check(ratio > 1.55 && ratio < 1.75,
      `Lv10/Lv5 should be about 400%/250% = 1.6, got ${ratio.toFixed(3)} (${at10}/${at5})`);
  }
  await page.context().close();
}

// ------------------------------------------------------------- Water Ball, Wizard
{
  const page = await openEditor(9); // Wizard — its own Water Ball is a 5-rank skill
  await pickSkill(page, "water ball");
  const cap = await rankInput(page).getAttribute("max");
  console.log("wizard, water ball rank cap:", cap);
  check(cap === "5", `a Wizard's own Water Ball stops at 5, the input caps at ${cap}`);
  await page.context().close();
}

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
