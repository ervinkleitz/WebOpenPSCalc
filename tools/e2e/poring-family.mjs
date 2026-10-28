// The Poring family holds the Porings a player can actually meet — and nothing else.
//
// Jelring Card promises +30% against Poring-type monsters, and the family it matches
// against was first built by taking every monster id that shares a name on
// wiki.payonstories.com/What_is_a_Poring%3F. Several of those names resolve to more
// than one id, and the extras are not monsters anyone fights: boss-flagged level-1
// 50-HP stubs, zero-EXP event copies, and — the one that matters — Poring 1847, an
// MVP at level 98 with 10,000,000 HP, Angel race and Ghost element, a Poring in name
// only. The card's own text excludes bosses and minibosses, so it was paying out
// against things it says it does not touch.
//
// Read off the Card Fix row's note, which names the family and the total it applied:
//   Race RC_Plant+0%  NonBoss+0%  Ele+0%  Size+0%  Family(RC2_Poring)+90% ...
// When nothing matches, the Family( ... ) clause is absent entirely — so this test is
// "the note says +90%" against "the note does not mention a family at all", which is
// a presence check rather than a numeric one and cannot pass by rounding.
//
// WHY NOT COMPARE DAMAGE: Poring 1847's DEF floors this build's hit at 1, and 130% of
// 1 is still 1. A with-card/without-card damage comparison is vacuous on exactly the
// id this change is most about, which is why the note is the thing being read.
//
// Run: node tools/e2e/poring-family.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
function shareLink(state) {
  const slots = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
    "garment", "shoes", "accessory_left", "accessory_right"];
  const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
  const keys = [];
  for (const line of block.split("\n").slice(1)) {
    if (line.includes("...Z3_CARD_SLOTS")) { for (const s of slots) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
    for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
  }
  const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
  const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
  return `${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`;
}

let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

// Chain [3] with three Jelring Cards (8213). Three rather than one so the figure in
// the note is +90%, which no other bonus on this build could coincidentally produce.
const build = (mob) => ({
  build: {
    job_id: 4, base_level: 40, job_level: 30,
    base_stats: { str: 29, agi: 1, vit: 1, int: 1, dex: 54, luk: 1 },
    equipped: { right_hand: 1520, right_hand_card1: 8213, right_hand_card2: 8213, right_hand_card3: 8213 },
    target_mob_id: mob,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1600 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The row is LABELLED "Cards & gear" on screen — stepLabel() renames the engine's
// "Card Fix" for the reader — so match either, and keep the engine name for the day
// the label changes again. Read with textContent, which reports a collapsed row too,
// and with the tooltip title, which carries the same string.
const CARD_ROW = /cards?\s*&\s*gear|card\s*fix/i;
const DEF_ROW = /target.s def/i;
const readRows = () => page.$$eval(".pl-step", (els) => els.map((e) => ({
  name: (e.querySelector(".pl-name")?.textContent || "").trim(),
  note: (e.querySelector(".pl-note")?.textContent || "").trim(),
  title: e.querySelector("[title]")?.getAttribute("title") || "",
})));

async function breakdown(mob) {
  await page.goto(shareLink(build(mob)), { waitUntil: "domcontentloaded" });
  // WAIT for the button, do not test for it. An `if (await btn.count())` after a flat
  // sleep found nothing on a cold load and skipped the click without a word.
  const btn = page.getByRole("button", { name: /calculate damage/i }).first();
  await btn.waitFor({ state: "visible", timeout: 60000 });
  await btn.click();
  // Poll for a shape that only exists after a real calculation, rather than sleeping
  // a fixed amount: "Target's DEF" is absent from the pre-calculation preview. A flat
  // wait read a half-rendered breakdown, and a half-rendered breakdown has no family
  // bonus in it — which is the answer six of these eleven targets expect, so a slow
  // page would have "confirmed" the fix on its own.
  let rows = [];
  for (let i = 0; i < 60; i++) {
    rows = await readRows();
    if (rows.some((r) => DEF_ROW.test(r.name))) break;
    await page.waitForTimeout(500);
  }
  const text = (r) => `${r.note} ${r.title}`;
  return {
    calculated: rows.some((r) => DEF_ROW.test(r.name)),
    cardNote: (() => { const r = rows.find((x) => CARD_ROW.test(x.name)); return r ? (r.note || r.title) : null; })(),
    anyFamily: rows.some((r) => /Family\(/.test(text(r))),
    names: rows.map((r) => r.name),
  };
}

const MEMBERS = [[3990, "Jelring, the reported case"], [1002, "Poring"], [1113, "Drops"],
  [1857, "Marin 1857 — the second of Marin's two real ids"], [3048, "Onigiring"]];
const OUTSIDERS = [
  [1847, "Poring 1847, the level-98 MVP with 10M HP"],
  [1973, "Poring 1973, a boss-flagged level-1 stub"],
  [2510, "Jelring 2510, a boss-flagged stub beside the real 3990"],
  [25522, "Onigiring 25522, which has 1 HP and 1 ATK"],
  [1062, "Santa Poring, excluded by the wiki by name"],
  [3994, "King Poring, an MVP inside the 399x block"],
];

for (const [mob, label] of MEMBERS) {
  const { calculated, cardNote, names } = await breakdown(mob);
  // Without this the two halves below both pass on a page that never calculated.
  check(calculated, `#${mob} ${label}: the page produced a real breakdown`, names);
  check(!!cardNote && /Family\(RC2_Poring\)\+90%/.test(cardNote),
    `#${mob} ${label} takes the +90%`, cardNote);
}

for (const [mob, label] of OUTSIDERS) {
  const { calculated, anyFamily, names } = await breakdown(mob);
  check(calculated, `#${mob} ${label}: the page produced a real breakdown`, names);
  // The cards row DISAPPEARS when it would do nothing: DamageSummary hides a step
  // whose multiplier is ~1 and whose running total is unchanged. So the evidence a
  // player sees for "no family bonus" is the row's absence, not a row reading +0%,
  // and the assertion is that the word Family appears nowhere in the breakdown.
  check(!anyFamily, `#${mob} ${label} gets no family bonus`, names);
}

check(errors.length === 0, "no page errors", errors);
await page.screenshot({ path: "poring-family.png", fullPage: false });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
