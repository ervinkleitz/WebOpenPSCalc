// Clan membership now has its own panel instead of being the last sub-section of
// Buffs. The move must not break what it does: picking a clan grants a permanent +1
// to two stats, and that has to still reach the character's stats.
//
// Checks the panel exists, that Buffs no longer carries the control, and that
// choosing Crossbow Clan (DEX+1, AGI+1) actually moves those two stats and nothing
// else.
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
const page = await ctx.newPage();
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } };

await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const panel = (title) => page.locator(".panel", { has: page.locator(".panel-title", { hasText: title }) }).first();

// --- it has its own panel ----------------------------------------------------
const clan = panel(/^Clan$/);
check(await clan.count() > 0, "there should be a Clan panel");
const clanText = (await clan.innerText().catch(() => "")).replace(/\s*\n\s*/g, " | ");
console.log("Clan panel:", clanText.slice(0, 160));
check(/Clan membership/i.test(clanText), "the Clan panel should hold the membership control");

// --- and Buffs no longer does ------------------------------------------------
const buffs = (await panel(/^Buffs$/).innerText().catch(() => "")).replace(/\s+/g, " ");
check(!/Clan membership/i.test(buffs), "Buffs should no longer carry the clan control");
console.log("Buffs still mentions clan membership:", /Clan membership/i.test(buffs));

// --- the bonus still lands ---------------------------------------------------
// Each stat is a .ro-stat-card: a .ro-stat-name label and a .ro-stat-total, which is
// the number AFTER job, equipment and buff bonuses — i.e. the one a clan moves.
const readStat = async (name) => {
  const card = page.locator(".ro-stat-card", {
    has: page.locator(".ro-stat-name", { hasText: new RegExp(`^${name}$`, "i") }),
  }).first();
  if (!(await card.count())) return null;
  const t = (await card.locator(".ro-stat-total").first().innerText().catch(() => "")).trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};
const before = { dex: await readStat("DEX"), agi: await readStat("AGI"), str: await readStat("STR") };
console.log("stats before:", JSON.stringify(before));

await clan.locator("select").first().selectOption("crossbow_clan");
await page.waitForTimeout(2500);
const after = { dex: await readStat("DEX"), agi: await readStat("AGI"), str: await readStat("STR") };
console.log("stats after Crossbow Clan:", JSON.stringify(after));

check(after.dex === before.dex + 1, `Crossbow Clan should add DEX+1 (${before.dex} -> ${after.dex})`);
check(after.agi === before.agi + 1, `Crossbow Clan should add AGI+1 (${before.agi} -> ${after.agi})`);
check(after.str === before.str, `and leave STR alone (${before.str} -> ${after.str})`);

// --- and it survives a reload, which is the part a reorder can quietly break ---
// The editor keeps the build in the address bar, so reload that rather than going
// through the clipboard — a clipboard read fails headless and the check would skip
// silently, which is no check at all.
// The editor restores from localStorage on a plain reload; the ?b= form is only
// produced by Copy share link. Reloading the bare URL therefore still proves the
// control is wired to the persisted build.
const stateUrl = page.url();
await page.goto(stateUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const val = await panel(/^Clan$/).locator("select").first().inputValue().catch(() => "");
console.log("clan after reloading the build URL:", JSON.stringify(val));
check(val === "crossbow_clan", `the URL should keep the clan, got "${val}"`);
const reDex = await readStat("DEX");
console.log("DEX after reload:", reDex);
check(reDex === after.dex, `the bonus should survive the reload (${after.dex} -> ${reDex})`);

await page.screenshot({ path: "clan-panel.png" });
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
