// Which slots are in "wildcard mix" mode is the player's choice, so it has to travel
// with the build. It used to be inferred from wildcard_slots instead, and the
// inference cannot represent the ordinary case: switching a slot to wildcard mix
// deliberately LEAVES the real cards equipped so switching back restores them, and a
// slot with real cards reads as "not in wildcard mode".
//
// So a build shared or saved mid-experiment came back with the cards instead of the
// mix — silently, and worth 100 HIT on a Phreeoni Card (137 vs 237 on the build
// below). Found QA'ing the 2026-10-06 stat-readout fix; same root cause, which is why
// the fix is to store the mode rather than to patch the inference.
//
// Covers all three ways a build re-enters the editor, plus the links and saves players
// already have, which carry no wildcard_mode and must still be inferred.
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
const link = (state) => `${URL_BASE}?b=z3_${LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)))}`;

const PHREEONI = 4121; // bonus bHit,100 — a carry-over is impossible to miss
const GLADIUS3 = 1220;
const base = {
  job_id: 12, base_level: 99, job_level: 50,
  base_stats: { str: 60, agi: 60, vit: 30, int: 20, dex: 30, luk: 20 },
  target_mob_id: 1002,
};
const state = (build) => ({ build: { ...base, ...build }, skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster" });

let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1700 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const settle = (ms = 6000) => page.waitForTimeout(ms);
const readHit = (p) => p.evaluate(() => {
  for (const c of document.querySelectorAll(".sec-stat-card"))
    if (c.querySelector(".sec-stat-label")?.textContent?.trim() === "HIT") {
      const t = (c.querySelector(".sec-stat-value")?.textContent ?? "").trim();
      return t === "\u2014" ? null : Number(t.replace(/,/g, ""));
    }
  return null;
});
const inWildcard = (p) => p.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Wildcard mix");
  return b ? b.className.includes("active") : null;
});

// A carded weapon, switched to wildcard mix with the cards left underneath.
await page.goto(link(state({ equipped: { right_hand: GLADIUS3, right_hand_card1: PHREEONI } })), { waitUntil: "domcontentloaded" });
await settle();
const carded = await readHit(page);
await page.getByRole("button", { name: /^Wildcard mix$/ }).first().click();
await settle();
const mixed = await readHit(page);
check(carded != null && mixed === carded - 100,
  `the Phreeoni Card's +100 HIT leaves when the slot goes to wildcard mix (${carded} -> ${mixed})`);

// 1. Share link. The address bar is NOT live — it is rewritten by Copy share link
//    (writeStateToUrl), so the link has to be produced the way a player produces it.
await page.getByRole("button", { name: /^Menu$|^☰$/ }).first().click().catch(() => {});
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Copy share link|Copied!/ }).first().click();
await page.waitForTimeout(2500);
const url = page.url();
check(/[?&]b=z3_/.test(url), `Copy share link rewrote the address bar (${url.slice(0, 60)}…)`);
const p2 = await ctx.newPage();
await p2.goto(url, { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(6500);
const sharedHit = await readHit(p2);
const sharedMode = await inWildcard(p2);
await p2.close();
check(sharedHit === mixed, `a share link reopens in wildcard mix, not with the cards (${mixed} -> ${sharedHit})`);
check(sharedMode === true, "the Wildcard mix toggle reads as active after following the share link");

// 2. Save / Load.
await page.getByRole("button", { name: "Save / Load" }).click();
await page.waitForTimeout(1200);
await page.getByPlaceholder("Build name").fill("e2e-wildcard-mode");
await page.getByRole("button", { name: /^Save$/ }).click();
await page.waitForTimeout(1200);
await page.locator(".modal-header button").last().click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /^Cards$/ }).first().click();   // perturb
await settle();
await page.getByRole("button", { name: "Save / Load" }).click();
await page.waitForTimeout(1200);
await page.locator(".saved-builds-item button", { hasText: "Load" }).first().click();
await settle();
check(await readHit(page) === mixed, `a saved build loads back in wildcard mix (expected ${mixed})`);

// 3. Pin, perturb, load the pin back.
await page.getByRole("button", { name: "Calculate damage" }).click();
await page.waitForTimeout(4500);
await page.getByRole("button", { name: /^Pin current$/ }).click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /^Cards$/ }).first().click();   // perturb
await settle();
await page.locator("button.cmp-btn-mini", { hasText: "Load" }).first().click();
await settle();
check(await readHit(page) === mixed, `a pinned build loads back in wildcard mix (expected ${mixed})`);

// 4. Backward compatibility: a link made BEFORE wildcard_mode existed carries only
//    wildcard_slots, and must still be inferred into wildcard mode.
const legacy = state({
  equipped: { right_hand: GLADIUS3 },
  wildcard_slots: { right_hand: [{ type: "race", bonus: 20 }, { type: "race", bonus: 20 }, { type: "race", bonus: 20 }] },
});
await page.goto(link(legacy), { waitUntil: "domcontentloaded" });
await settle();
check(await inWildcard(page) === true, "a pre-existing share link with no wildcard_mode still opens in wildcard mix");

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await page.screenshot({ path: "wildcard-mode-roundtrip.png" });
console.log(ok ? "\nPASS - wildcard mix survives sharing, saving and pinning." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
