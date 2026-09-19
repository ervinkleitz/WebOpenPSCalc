// The "Always proc" toggle (the one that keeps Bonechewer's Brutality up) also forces the
// Holy Strike proc to fire on every attack, so a player can read its per-proc damage as a
// rate instead of an expected value. Player request, 2026-09-19. The toggle must also APPEAR
// for a build whose only forceable proc is Holy Strike (it used to show only for autobonus
// cards). Driven through the page's own controls.
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

const b = await chromium.launch({ channel: "chrome", headless: true });
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

// Priest who learned Holy Strike, a mace, NO proc cards at all, vs a Ghoul (Undead).
const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
await page.goto(shareLink({
  build: { job_id: 8, base_level: 99, job_level: 50, base_stats: { str: 80, agi: 40, vit: 40, int: 30, dex: 40, luk: 30 },
    equipped: { right_hand: 1501 }, mastery_levels: { PS_PR_HOLYSTRIKE: 1 }, target_mob_id: 1036 },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const read = async () => {
  const calc = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await calc.count()) { await calc.click(); await page.waitForTimeout(3000); }
  return page.evaluate(() => {
    const head = [...document.querySelectorAll(".breakdown-head")].map((h) => h.innerText.replace(/\s+/g, " ")).find((t) => /Holy Strike/.test(t)) || null;
    const view = [...document.querySelectorAll(".breakdown-view")].find((v) => /Holy Strike/.test(v.innerText));
    const m = /DPS \(EST\.\)\s*([\d,.]+)/i.exec(document.body.innerText.replace(/\s+/g, " "));
    const dps = m ? Number(m[1].replace(/,/g, "")) : null;
    const added = view && /DPS added\s*\+?([\d,]+)/.exec(view.innerText.replace(/\s+/g, " "));
    return { head, dps, added: added ? Number(added[1].replace(/,/g, "")) : null };
  });
};

// NB .proc-mode-row is also used by the "EXP / hit" row, so pick the Procs one by label.
const procRow = page.locator(".proc-mode-row", { has: page.locator(".proc-mode-label", { hasText: /^Procs$/ }) });

const normal = await read();
console.log("normal:", JSON.stringify(normal));
// The toggle only renders with results on screen, so check it after the first calculation.
// This build has NO proc cards: before this change the toggle appeared for autobonus cards only.
check(await procRow.count() === 1, "the Always-proc toggle should show for a build whose only forceable proc is Holy Strike");
check(normal.head && /23% per melee attack/.test(normal.head), `expected the real 23% rate, got: ${normal.head}`);

await procRow.getByRole("button", { name: /^Always$/ }).click();
await page.waitForTimeout(1200);
const always = await read();
console.log("always:", JSON.stringify(always));
check(always.head && /100% per melee attack/.test(always.head), `"Always" should force Holy Strike to 100%, got: ${always.head}`);
check(always.added > normal.added, `forced DPS added should exceed the expected-value one (${normal.added} -> ${always.added})`);
check(always.dps > normal.dps, `total DPS should rise with the proc forced (${normal.dps} -> ${always.dps})`);
// ~100/23 more proc damage; allow slack for the rest of the DPS mix.
check(always.added / normal.added > 3, `forcing 23% -> 100% should multiply the proc's DPS ~4x, got ${(always.added / normal.added).toFixed(2)}x`);

// And back: the toggle is reversible.
await procRow.getByRole("button", { name: /^Normal$/ }).click();
await page.waitForTimeout(1200);
const back = await read();
check(back.head === normal.head && back.dps === normal.dps, `switching back should restore the real rate, got: ${JSON.stringify(back)}`);

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
