// "If a weapon is carded with the Mummy Card and I switch to a Wildcard mix, the HIT
// carries over in the UI. However, the final Hit Chance calculation is correct."
// — reported by a player via Frennetix, 2026-10-06.
//
// Which slots are in wildcard mode is React state, deliberately not part of the build
// (see deriveWildcardMode), so a build in wildcard mode still carries the real card
// ids. The damage request built its own override and deleted them; the character
// status readout, the gear stat bonuses and the breakpoints all read sanitizedBuild
// and did not. So Mummy Card's +20 HIT stayed in the stat panel after the switch
// while the hit chance underneath was correctly computed without it.
//
// Both numbers are read from the engine rather than hardcoded, so the test states the
// property that was broken — the panel agrees with the build it is pricing — instead
// of a total that a future formula change would invalidate.
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

// Chain (1520) is a 3-slot mace an Acolyte-line character can hold. Mummy Card
// (4106) is the reported card, `bonus bHit,20`. Drops Card (4004) is `bonus bDex,1;
// bonus bHit,3` — it moves a raw stat as well, which covers the equip-bonus badge
// beside the stats, a second reader that was taking the un-overridden build.
const WEAPON = 1520, MUMMY = 4106, DROPS = 4004;
const CARDED = { right_hand: WEAPON, right_hand_card1: MUMMY, right_hand_card2: DROPS };
const state = {
  build: {
    job_id: 8, base_level: 99, job_level: 50,
    base_stats: { str: 60, agi: 40, vit: 40, int: 40, dex: 50, luk: 20 },
    equipped: CARDED,
    target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1600 } })).newPage();
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } };
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

/** The HIT a player reads in the Character stats panel. */
const shownHit = () => page.evaluate(() => {
  for (const card of document.querySelectorAll(".sec-stat-card")) {
    if (card.querySelector(".sec-stat-label")?.textContent?.trim() === "HIT") {
      const t = card.querySelector(".sec-stat-value")?.textContent?.trim() ?? "";
      return t === "\u2014" ? null : Number(t.replace(/,/g, ""));
    }
  }
  return null;
});

/** The "from equipment / pet" badge on a raw stat, 0 when no badge is rendered. */
const equipBadge = (stat) => page.evaluate((name) => {
  for (const card of document.querySelectorAll(".ro-stat-card")) {
    if (card.querySelector(".ro-stat-name")?.textContent?.trim().toUpperCase() !== name) continue;
    const b = card.querySelector(".ro-stat-bonus--equip");
    return b ? Number(b.textContent.trim().replace("+", "")) : 0;
  }
  return null;
}, stat.toUpperCase());

/** The HIT the engine computes for a build — the same endpoint the panel feeds from
 *  and the same status the hit chance is derived from. */
const engineHit = (equipped) => page.evaluate(async (eq) => {
  const res = await fetch("/api/calculate/status", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ build: { ...window.__e2eBuild, equipped: eq } }),
  });
  return res.ok ? ((await res.json())?.hit ?? null) : null;
}, equipped);

await page.goto(`${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`, { waitUntil: "domcontentloaded" });
await page.evaluate((b) => { window.__e2eBuild = b; }, state.build);
await page.waitForTimeout(6000);

const hitCarded = await engineHit(CARDED);
const hitBare = await engineHit({ right_hand: WEAPON });
console.log(`engine HIT: carded ${hitCarded}, no cards ${hitBare}`);
check(hitCarded != null && hitBare != null, "could not read HIT from /api/calculate/status");
check(hitCarded > hitBare, "the cards must change HIT, or this test proves nothing");

const withCard = await shownHit();
const dexWithCard = await equipBadge("dex");
console.log(`shown with the cards equipped  : HIT ${withCard}, DEX equip badge +${dexWithCard}`);
check(withCard === hitCarded, `the panel should show the carded HIT (${withCard} vs ${hitCarded})`);
check(dexWithCard > 0, `Drops Card's +1 DEX should show as an equip bonus (got +${dexWithCard})`);

// Flip the right hand to Wildcard mix. The real cards stay in the build — that is
// the whole point: only the mode changes.
const wildcardBtn = page.getByRole("button", { name: /^Wildcard mix$/ }).first();
check((await wildcardBtn.count()) > 0, "the Wildcard mix toggle should be offered for a slotted weapon");
await wildcardBtn.click();
await page.waitForTimeout(6000);

const wild = await shownHit();
const dexWild = await equipBadge("dex");
console.log(`shown after switching to Wildcard: HIT ${wild}, DEX equip badge +${dexWild}`);
check(wild === hitBare,
  `the cards' HIT must drop when they are replaced by a wildcard mix, and the panel must `
  + `match the build it is pricing (showed ${wild}, engine says ${hitBare})`);
check(dexWild === 0, `the replaced card's DEX must leave the equip bonus too (got +${dexWild})`);

// Flip back: the cards are still equipped, so the HIT must return.
const cardsBtn = page.getByRole("button", { name: /^Cards$/ }).first();
check((await cardsBtn.count()) > 0, "could not find the Cards toggle to switch back");
await cardsBtn.click();
await page.waitForTimeout(6000);
const back = await shownHit();
console.log(`shown after switching back to Cards: HIT ${back}`);
check(back === hitCarded, `switching back to Cards must restore the cards' HIT (${back} vs ${hitCarded})`);

check(errors.length === 0, "page errors: " + errors.join(" | "));
await page.screenshot({ path: "wildcard-stat-readout.png" });
console.log(ok ? "\nPASS - the stat readout tracks the Cards / Wildcard mix toggle." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
