// Paste a link from PS's own skill planner (tools.payonstories.com/skill) and the
// right skills land in the Passive skills panel at the right levels — which is the
// whole point of the feature, and the only thing a player will judge it by.
//
// It also has to MERGE rather than replace. The link carries a job and skill levels
// and nothing else, so a player who has already set up gear here must keep it; the
// jaludev import next door does replace, and confusing the two would quietly delete
// someone's build.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";
import zlib from "zlib";

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

// Encode a planner link the way tools.payonstories.com does.
const psLink = (job, levels) =>
  "https://tools.payonstories.com/skill?state=" +
  encodeURIComponent(zlib.deflateSync(Buffer.from(JSON.stringify({ job, levels }), "utf8")).toString("base64"));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
let ok = true;
const check = (cond, msg) => { if (!cond) { console.error("FAIL: " + msg); ok = false; } };

// Start as a Knight with gear already set up, so the merge has something to protect.
await page.goto(shareLink({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 60, vit: 60, int: 1, dex: 90, luk: 1 },
    equipped: { right_hand: 1129, armor: 2314 }, target_mob_id: 1023,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// Scoped to the Passive skills grid, and keyed on the label's own text (CSS
// upper-cases it on screen but textContent keeps the authored case).
const passiveLevels = () => page.evaluate(() => {
  const out = {};
  for (const f of document.querySelectorAll(".passive-grid .field")) {
    const label = f.querySelector("label")?.textContent?.trim();
    const input = f.querySelector("input[type=number]");
    if (label && input) out[label] = Number(input.value);
  }
  return out;
});
const weaponSlot = () => page.locator(".field", { has: page.locator("label", { hasText: /Right hand/i }) }).first().innerText();

const damage = async () => {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(4500);
  const t = (await page.locator(".metric-range .value").first().innerText()).replace(/\s+/g, " ");
  const n = [...t.matchAll(/([\d,]+)\s*(?:min|max)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
  return n.length === 2 ? (n[0] + n[1]) / 2 : null;
};

const dmgBefore = await damage();
const before = await passiveLevels();
console.log("before — Blade Mastery:", before["Blade Mastery"], " weapon:", (await weaponSlot()).replace(/\s+/g, " ").slice(0, 60));
check((before["Blade Mastery"] ?? 0) === 0, "the test build should start with no Blade Mastery");

// Paste a Knight planner link: Blade Mastery 10, Spear Mastery 7, plus a Priest quest
// skill their planner hands to every class (which must NOT come across).
await page.getByRole("button", { name: /^Import$/i }).first().click();
await page.waitForTimeout(800);
await page.locator(".modal-card textarea").first()
  .fill(psLink("Knight", { SM_TWOHAND: 10, KN_SPEARMASTERY: 7, AL_HOLYSTRIKE: 1, SM_PROVOKE: 10 }));
await page.getByRole("button", { name: /^Import$/i }).last().click();
await page.waitForTimeout(2500);

const summary = (await page.locator(".modal-card").first().innerText()).replace(/\s+/g, " ");
console.log("modal:", summary.slice(0, 320));
check(/Blade Mastery Lv10/i.test(summary), `the summary should list Blade Mastery Lv10 — got: ${summary}`);
check(/Spear Mastery Lv7/i.test(summary), `the summary should list Spear Mastery Lv7 — got: ${summary}`);
check(/Provoke/i.test(summary), "a real Knight skill we don't price should be named, not silently dropped");
check(/from other classes/i.test(summary), "the other classes' quest skills should be reported as a count");

await page.getByRole("button", { name: /^Done$/i }).first().click();
await page.waitForTimeout(1500);

const after = await passiveLevels();
console.log("after  — Blade Mastery:", after["Blade Mastery"], " Spear Mastery:", after["Spear Mastery"]);
check(after["Blade Mastery"] === 10, `Blade Mastery should be 10, got ${after["Blade Mastery"]}`);
check(after["Spear Mastery"] === 7, `Spear Mastery should be 7, got ${after["Spear Mastery"]}`);

// The merge must not have thrown away the gear.
const weapon = (await weaponSlot()).replace(/\s+/g, " ");
console.log("weapon after import:", weapon.slice(0, 70));
check(/Flamberge/i.test(weapon), `the weapon must survive a skill import — got: ${weapon}`);

// And the imported mastery has to reach the DAMAGE, not just the input box. Blade
// Mastery is +4 ATK a level, so importing Lv10 has to move the number.
const dmgAfter = await damage();
console.log(`damage: ${dmgBefore} -> ${dmgAfter}`);
check(dmgBefore != null && dmgAfter != null, "both calculations should produce a damage range");
check(dmgAfter > dmgBefore,
  `importing Blade Mastery 10 must raise the damage (${dmgBefore} -> ${dmgAfter})`);

console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
