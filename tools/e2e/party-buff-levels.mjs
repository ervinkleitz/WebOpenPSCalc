// A party buff's LEVEL is the player's to set.
//
// Ticking one used to apply its max and leave it there — "you don't control the
// caster's actual level", said the tooltip. In practice you usually do: it is your
// own Priest friend, your alt, or yourself (Blessing and Over Thrust have no
// self-cast entry, so a Priest or Blacksmith buffing themselves ticks these too),
// and a Blessing 5 priced as Blessing 10 is +5 STR/INT/DEX that is not there.
//
// This drives the control and then checks the stat readout moved by the right
// amount, so a selector that only looks connected fails.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
let ok = true;
const check = (c, m) => { if (!c) { console.error("FAIL: " + m); ok = false; } else console.log("ok  " + m); };
const num = (s) => Number(String(s ?? "").replace(/[^\d.]/g, ""));

// Share-link encoder, for the stale-build case at the end.
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
const shareLink = (payload) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren(payload)));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1800 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

// The six stat cards. Each shows the TOTAL — base points plus job, gear and buff
// bonuses — above its input, and that total is where a party buff has to show up.
const stats = () => page.evaluate(() => {
  const out = {};
  for (const c of document.querySelectorAll(".ro-stat-card")) {
    const k = c.querySelector(".ro-stat-name")?.textContent?.trim();
    const v = c.querySelector(".ro-stat-total")?.textContent?.trim();
    if (k) out[k] = v;
  }
  return out;
});
const field = (label) => page.locator(".field-checkbox", { hasText: label }).first();

// === Blessing: a selector appears, and it is the caster's level ============
const before = await stats();
const blessing = field("Blessing");
check(await blessing.count() > 0, "Blessing is offered as a party buff");
check(await blessing.locator("select").count() === 0, "with no level selector until it is ticked");

await blessing.locator('input[type="checkbox"]').check();
await page.waitForTimeout(1800);
const onMax = await stats();
check(await blessing.locator("select").count() === 1, "ticking it reveals a level selector");
check(await blessing.locator("select").inputValue() === "10", "which starts at the highest level");

// Blessing is +1 STR/INT/DEX per level, so Lv10 -> Lv4 must drop each by 6.
await blessing.locator("select").selectOption("4");
await page.waitForTimeout(1800);
const onFour = await stats();
console.log(`    STR: ${before.STR ?? "?"} -> Lv10 ${onMax.STR ?? "?"} -> Lv4 ${onFour.STR ?? "?"}`);
for (const stat of ["STR", "INT", "DEX"]) {
  const base = num(before[stat]), max = num(onMax[stat]), four = num(onFour[stat]);
  check(max - base === 10, `Blessing Lv10 gives +10 ${stat} (${base} -> ${max})`);
  check(four - base === 4, `and Lv4 gives +4 ${stat}, not +10 (${base} -> ${four})`);
}

// === a duration-only buff keeps its plain checkbox =========================
const gloria = field("Gloria");
if (await gloria.count()) {
  await gloria.locator('input[type="checkbox"]').check();
  await page.waitForTimeout(1200);
  check(await gloria.locator("select").count() === 0,
    "Gloria is one rank, so it gets no selector — a one-entry dropdown implies a choice that is not there");
}

// === the level survives a reload through the share link ====================
const url = await page.evaluate(() => location.href);
const copy = page.getByRole("button", { name: /share link|copy share/i }).first();
if (await copy.count()) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await copy.click();
  await page.waitForTimeout(1200);
  const shared = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (shared && shared !== url) {
    const p2 = await (await browser.newContext({ viewport: { width: 1500, height: 1800 } })).newPage();
    await p2.goto(shared, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(7000);
    const lv = await p2.locator(".field-checkbox", { hasText: "Blessing" }).first().locator("select").inputValue().catch(() => null);
    console.log(`    after reopening the share link, Blessing reads Lv${lv}`);
    check(lv === "4", `the chosen level survives a share link (got ${lv})`);
    await p2.context().close();
  }
}

// === a build shared before a cap came down ================================
// Over Thrust was once offered at 10 ranks; the real maximum is 5, and the engine
// clamps. The selector has to show the level that will actually be used, or the
// screen and the damage disagree.
{
  const stale = shareLink({
    build: {
      job_id: 7, base_level: 99, job_level: 50,
      base_stats: { str: 80, agi: 40, vit: 40, int: 20, dex: 50, luk: 10 },
      support_buffs: { SC_OVERTHRUST: 10 },   // a rank the skill no longer has
    },
    skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
  });
  const p3 = await (await browser.newContext({ viewport: { width: 1500, height: 1800 } })).newPage();
  await p3.goto(stale, { waitUntil: "domcontentloaded" });
  await p3.waitForTimeout(7000);
  const ot = p3.locator(".field-checkbox", { hasText: "Over Thrust" }).first();
  const lv = await ot.locator("select").inputValue().catch(() => null);
  console.log(`    a build stored with Over Thrust 10 shows Lv${lv} (the cap is 5)`);
  check(await ot.locator('input[type="checkbox"]').isChecked(), "the stored buff is still on");
  check(lv === "5", `and is shown at the level the engine will use, not the stored 10 (got ${lv})`);
  await p3.context().close();
}

check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
console.log(ok ? "\nPASS - party buffs run at the level you set." : "\nsee failures above");
await browser.close();
process.exit(ok ? 0 : 1);
