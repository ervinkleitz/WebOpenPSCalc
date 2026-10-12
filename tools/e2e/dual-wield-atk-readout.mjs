// "the ATK stat for DD sins is ignoring the left hand (+7 main gauche)"
// — Laila Braveheart via Frennetix, 2026-10-12, with the two readouts side by side:
// ours "348+35", the game's "391+49".
//
// Both halves of the in-game ATK window count BOTH hands — Hercules keeps `lhw`
// beside `rhw` and the status packet sums them. The two differences in that report
// are exactly a +7 Main Gauche: 43 ATK and its 14 refine. This calculator counted the
// right hand only, so a dual-dagger Assassin's headline ATK was short by a whole
// weapon. Display only; the damage pipeline has always had its own dual-wield path,
// which is why the damage looked right while the stat did not.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const FE = new URL("file:///C:/Users/ervin/WebOpenPSCalc/open-ps-calc-frontend/frontend/");
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const feSrc = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = feSrc.slice(feSrc.indexOf("const Z3_KEYS: string[] = ["), feSrc.indexOf("const Z3_ENC"));
const z3Keys = [];
for (const line of blk.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) {
    for (const sl of SLOTS) for (const i of [1, 2, 3, 4]) z3Keys.push(`${sl}_card${i}`);
    continue;
  }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) z3Keys.push(m[1]);
}
const z3Enc = {};
z3Keys.forEach((k, i) => { if (!(k in z3Enc)) z3Enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [z3Enc[k] ?? k, ren(x)])) : v;

// Assassin, Gladius +7 in the right hand. 1207 Main Gauche (43 ATK, weapon level 1,
// so +7 is 14 refine ATK), 2101 Guard — a shield, which must contribute nothing.
const GLADIUS = 1221, MAIN_GAUCHE = 1207, GUARD = 2101;
const link = (equipped, refine) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
    equipped, refine, target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The ATK card reads "<base>+<extra>", the same two numbers the game shows.
const atkCard = async (equipped, refine) => {
  await page.goto(link(equipped, refine), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return page.evaluate(() => {
    const grid = [...document.querySelectorAll(".sec-stat-grid")].find((g) => /Max HP/.test(g.textContent || ""));
    for (const c of (grid ? grid.querySelectorAll(".sec-stat-card") : [])) {
      if (c.querySelector(".sec-stat-label")?.textContent?.trim() === "ATK") {
        return (c.querySelector(".sec-stat-value")?.textContent || "").trim();
      }
    }
    return null;
  });
};
const parts = (s) => {
  const m = /^(\d+)\s*\+\s*(\d+)$/.exec(String(s || "").replace(/\s/g, ""));
  return m ? { base: Number(m[1]), extra: Number(m[2]) } : null;
};

// === one dagger, then two =================================================
const oneHand = parts(await atkCard({ right_hand: GLADIUS }, { right_hand: 7 }));
check(oneHand != null, `the ATK card reads as "base+extra" (${JSON.stringify(oneHand)})`);

const dual = parts(await atkCard({ right_hand: GLADIUS, left_hand: MAIN_GAUCHE }, { right_hand: 7, left_hand: 7 }));
console.log(`    one dagger: ${oneHand.base}+${oneHand.extra}   dual: ${dual.base}+${dual.extra}`);
check(dual != null, "and still does with a weapon in the off-hand");
// Main Gauche is 43 ATK; at +7 a level-1 weapon is worth 14 refine ATK. Those are the
// exact two numbers missing from the report.
check(dual.base - oneHand.base === 43,
  `the off-hand's 43 ATK lands in the first number (${oneHand.base} -> ${dual.base})`);
check(dual.extra - oneHand.extra === 14,
  `and its 14 refine in the second (${oneHand.extra} -> ${dual.extra})`);

// The card has to explain itself, or the jump looks like a bug in the other
// direction. Read the ATK card's OWN hover note — the item name is all over the
// equipment panel, so searching the page for it would pass on nothing.
const note = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".sec-stat-card")]
    .find((c) => c.querySelector(".sec-stat-label")?.textContent?.trim() === "ATK");
  return card?.querySelector(".info-tooltip-bubble")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
});
console.log(`    ATK card note: ${JSON.stringify(note)}`);
check(note != null && /both hands/i.test(note) && /Main Gauche/.test(note) && /43/.test(note) && /14/.test(note),
  "the ATK card's own note names the off-hand and what it contributed");

// === a shield is not a weapon =============================================
const shielded = parts(await atkCard({ right_hand: GLADIUS, left_hand: GUARD }, { right_hand: 7 }));
console.log(`    with a shield off-hand: ${shielded.base}+${shielded.extra}`);
check(shielded.base === oneHand.base && shielded.extra === oneHand.extra,
  `a shield adds no ATK (${shielded.base}+${shielded.extra} vs ${oneHand.base}+${oneHand.extra})`);

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - the ATK readout counts both hands." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
