// Target debuffs are equipment slots, like the equipment, buffs and consumables.
//
// Nineteen toggles in one flat run was the longest stretch of checkbox in the
// editor. They are now five rows you open, grouped by WHAT EACH ONE CHANGES
// rather than by who casts it, because that is the question being asked: you
// arrive here having decided "it is too tanky" or "I keep missing".
//
// Two of those groups are the point of the split. "DEF & MDEF" is the armour,
// "Its attacks" is Strip Weapon / Strip Helm / Hypothermia -- which do nothing to
// your damage at all and only move the survivability numbers. Sitting beside
// Strip Shield in one undifferentiated list, they read as though they did.
//
// Run: node tools/e2e/debuff-slots.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

// --- share-link encoder, so a test can start from a state rather than click to it
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
  "garment", "shoes", "accessory_left", "accessory_right"];
const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of block.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of SLOTS) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
const shareLink = (state) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren(state)));

const KNIGHT = {
  job_id: 7, base_level: 99, job_level: 50,
  base_stats: { str: 90, agi: 40, vit: 40, int: 1, dex: 60, luk: 1 },
  equipped: { right_hand: 1101 },
  target_mob_id: 1002,          // Poring: Plant race, so NOT a Signum Crucis target
};
const stateWith = (targetMods) => ({
  build: KNIGHT,
  skill: { id: 0, level: 1, label: "Normal Attack" },
  targetMode: "monster",
  targetMods,
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const fresh = async (url) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url ?? URL_BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return { ctx, page };
};

const PANEL = '[data-panel="target"]';
const slots = (page) => page.$$eval(PANEL + " .equip-slot", (els) => els.map((e) => ({
  label: (e.querySelector(".equip-slot-label")?.textContent || "").trim(),
  value: (e.querySelector(".equip-slot-value")?.textContent || "").trim() || null,
  open: e.className.includes("equip-slot--open"),
  filled: e.className.includes("equip-slot--filled"),
})));
const LABELS = ["Element & ailment", "Damage amplifiers", "DEF & MDEF", "Flee & accuracy", "Its attacks"];

// ---- 1. five slots, collapsed, holding nothing ---------------------------------
{
  const { ctx, page } = await fresh();
  const rows = await slots(page);
  check(rows.length === 5, "the debuffs are five slots", rows.map((r) => r.label));
  check(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify(LABELS),
    "named for what they change, not for who casts them", rows.map((r) => r.label));
  check(rows.length === 5 && rows.every((r) => !r.open), "closed for a browser that has never opened one");
  check(rows.length === 5 && rows.every((r) => r.value === "None"), "each says None", rows.map((r) => r.value));

  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(600);
  const opened = await slots(page);
  check(opened.length === 5 && opened.every((r) => r.open), "Expand all opens every one");
  await panel.getByRole("button", { name: /collapse all/i }).first().click();
  await page.waitForTimeout(600);
  const shut = await slots(page);
  check(shut.length === 5 && shut.every((r) => !r.open), "Collapse all shuts them again");
  await ctx.close();
}

// ---- 2. a closed row names what is on the target -------------------------------
{
  const { ctx, page } = await fresh(shareLink(stateWith({
    element_status: "Frozen", element_change: "Water",
    lex_aeterna: true, mailbreaker: true,
    provoke: 7, strip_shield: true, burning: 3,
    quagmire: 4, blind: true,
    strip_weapon: true, hypothermia: true,
  })));
  const byLabel = Object.fromEntries((await slots(page)).map((r) => [r.label, r.value]));
  check(byLabel["Element & ailment"] === "Frozen, Change → Water",
    "the ailment and the element override", byLabel["Element & ailment"]);
  check(byLabel["Damage amplifiers"] === "Lex Aeterna, Mailbreaker",
    "the amplifiers", byLabel["Damage amplifiers"]);
  // A level is part of the fact: Provoke 7 and Provoke 10 are different numbers.
  check(byLabel["DEF & MDEF"] === "Provoke 7, Strip Shield, Burning 3",
    "the armour cuts, with their levels", byLabel["DEF & MDEF"]);
  check(byLabel["Flee & accuracy"] === "Quagmire 4, Blinded",
    "the evasion cuts", byLabel["Flee & accuracy"]);
  check(byLabel["Its attacks"] === "Strip Weapon, Hypothermia",
    "and the two that only change what it does to YOU", byLabel["Its attacks"]);
  await ctx.close();
}

// ---- 3. a debuff the target cannot take is not claimed -------------------------
// Signum Crucis is Undead/Demon only and its checkbox is disabled against anything
// else -- but a share link made before the target changed can still carry it, and a
// row reading "Signum Crucis" against a Poring would be the panel lying about your
// damage. Same for Offensive Blessing.
{
  const { ctx, page } = await fresh(shareLink(stateWith({
    signum_crucis: true, offensive_blessing: true, strip_armor: true, lex_aeterna: true,
  })));
  const byLabel = Object.fromEntries((await slots(page)).map((r) => [r.label, r.value]));
  check(byLabel["DEF & MDEF"] === "Strip Armor",
    "Signum Crucis is left out against a Plant-race Poring", byLabel["DEF & MDEF"]);
  check(byLabel["Damage amplifiers"] === "Lex Aeterna",
    "and so is Offensive Blessing", byLabel["Damage amplifiers"]);
  await ctx.close();
}

// ---- 4. the panel's own summary, including before a target is chosen -----------
{
  const { ctx, page } = await fresh();
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);
  for (const n of [/Lex Aeterna/i, /Mailbreaker/i, /Blinded/i]) {
    await panel.locator(".field-checkbox label", { hasText: n }).first()
      .locator('input[type="checkbox"]').check();
  }
  await page.waitForTimeout(400);
  await page.locator(PANEL + " h2.panel-header").first().click();
  await page.waitForTimeout(600);
  const summary = await page.locator(PANEL + " .panel-summary").first().textContent().catch(() => null);
  // No monster picked yet, so there is no name to lead with -- but three debuffs
  // are on and still change the numbers. This used to read "—".
  check(!!summary && /Lex Aeterna/.test(summary) && !/^—$/.test(summary.trim()),
    "with no target chosen the summary still names the debuffs", summary);
  await ctx.close();
}

// ---- 5. the controls still reach the engine ------------------------------------
// Lex Aeterna is exactly ×2, which no other debuff on this build produces, so the
// ratio is the proof that a control moved into a new container is still wired.
{
  const finalOf = async (page) => {
    await page.getByRole("button", { name: /calculate damage/i }).first().click();
    await page.waitForTimeout(5000);
    const rows = await page.$$eval(".pl-step", (els) => els.map((e) => ({
      name: (e.querySelector(".pl-name")?.textContent || "").trim(),
      val: (e.querySelector(".pl-val")?.textContent || "").trim(),
    })));
    const last = [...rows].reverse().find((r) => r.val && r.val !== "—");
    if (!last) return null;
    const nums = [...last.val.replace(/,/g, "").matchAll(/\d+/g)].map(Number);
    return nums.length ? nums[nums.length - 1] : null;
  };
  const a = await fresh(shareLink(stateWith({})));
  const plain = await finalOf(a.page);
  await a.ctx.close();
  const b = await fresh(shareLink(stateWith({ lex_aeterna: true })));
  const lex = await finalOf(b.page);
  await b.ctx.close();
  check(plain != null && lex != null, "a damage figure came back both times", { plain, lex });
  // Guard the ratio itself: two nulls or two equal numbers must not pass.
  check(plain != null && lex != null && Math.abs(lex / plain - 2) < 0.02,
    "Lex Aeterna still doubles the damage, so the control is wired", { plain, lex, ratio: plain ? lex / plain : null });
}

// ---- 6. one panel's Expand all leaves the other panels alone ------------------
// All three panels keep their groups in ONE map, and each Expand all passes only
// its own keys. The setter rebuilt that map from scratch, so opening the debuffs
// silently shut every buff and consumable group. It was invisible while buffs were
// the only panel with groups, and survivability-toggles is what caught it: that
// test opens the buffs, then the debuffs, then reaches for Energy Coat.
{
  const { ctx, page } = await fresh();
  const openCount = (panel) => page.$$eval(panel + " .equip-slot",
    (els) => els.filter((e) => e.className.includes("equip-slot--open")).length);
  await page.locator('[data-panel="buffs"]').getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);
  const buffsOpen = await openCount('[data-panel="buffs"]');
  check(buffsOpen > 0, "the buff groups opened", buffsOpen);

  await page.locator('[data-panel="consumables"]').getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);
  await page.locator(PANEL).getByRole("button", { name: /expand all/i }).first().click();
  await page.waitForTimeout(500);

  const after = await openCount('[data-panel="buffs"]');
  check(after === buffsOpen,
    "and opening the consumables and the debuffs left them open", { before: buffsOpen, after });
  check(await openCount('[data-panel="consumables"]') === 4, "consumables are open too");
  check(await openCount(PANEL) === 5, "and so are the debuffs");

  // Collapse all is the same setter, so it must be just as local.
  await page.locator(PANEL).getByRole("button", { name: /collapse all/i }).first().click();
  await page.waitForTimeout(500);
  check(await openCount('[data-panel="buffs"]') === buffsOpen,
    "and collapsing the debuffs does not shut the buffs either", await openCount('[data-panel="buffs"]'));
  await ctx.close();
}

check(errors.length === 0, "no page errors", errors);
console.log(ok ? "PASS" : "see failures");
await browser.close();
process.exit(ok ? 0 : 1);
