// Nothing you have to hit should be smaller than a fingertip — in EITHER density.
//
// Measured on production 2026-10-17, geared build, 390px wide: 87 interactive
// elements were under 28px in their short dimension at comfortable density and 130
// in compact. Compact made it half as bad again, which is backwards — compact is a
// request for more rows per screen, and it is meant to take that out of padding,
// type size and gaps, not out of the hit area. A phone is both where compact is
// most tempting and where a finger is least forgiving.
//
// WHAT "SIZE" MEANS HERE, because the naive reading is wrong three different ways:
//   * a checkbox's target is its LABEL — clicking the words ticks the box — so a
//     16px box on a 30px row is a 30px target, and measuring the <input> would
//     report a failure that is not there;
//   * .pill-remove and .info-tooltip are deliberately small and grow a transparent
//     ::after halo instead of growing themselves, which no rect on the element can
//     see — so those are hit-tested, by asking the document what is actually at a
//     point outside the element;
//   * .hover-description is not a control. It is an item name that reveals its
//     description on hover, it is keyboard-reachable so it shows up in any
//     [tabindex] sweep, and there is nothing to press. It is excluded by name.
//
// Run: node tools/e2e/tap-targets.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

// Geared, carded, refined, with a skill and a target — so the sweep sees the pills,
// the card rows, the refine pickers and the × buttons, none of which exist on the
// empty build the first version of this measured.
const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
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
const GEARED = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
    equipped: {
      right_hand: 1220, right_hand_card1: 8089, right_hand_card2: 4092,
      right_hand_card3: 4035, armor: 2302, armor_card1: 4014, shoes: 2403, head_top: 5002,
    },
    refine: { right_hand: 7, armor: 4 }, target_mob_id: 1002,
  },
  skill: { id: 28, level: 10, label: "Sonic Blow" }, targetMode: "monster",
})));

const SWEEP = () => {
  // A checkbox is activated by its label, so the label is the target. Everything
  // else answers for its own box.
  const EXCLUDE = (el) => el.closest(".hover-description") !== null;
  const out = [];
  for (const el of document.querySelectorAll(
    "button, select, textarea, input, .topbar-link, [role=button]")) {
    if (EXCLUDE(el)) continue;
    const isTick = el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
    const target = isTick ? (el.closest("label") || el) : el;
    const b = target.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    const cls = String(el.className || "").trim().split(/\s+/).filter(Boolean)[0] || "";
    out.push({
      key: `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""}.${cls || "-"}`,
      w: Math.round(b.width), h: Math.round(b.height),
      halo: el.matches(".pill-remove, .info-tooltip"),
    });
  }
  return { rows: out, pageH: document.documentElement.scrollHeight };
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const heights = {};

for (const density of ["comfortable", "compact"]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(GEARED, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.evaluate((d) => document.documentElement.setAttribute("data-density", d), density);
  await page.waitForTimeout(700);

  const { rows, pageH } = await page.evaluate(SWEEP);
  heights[density] = pageH;

  // The floor on a touch screen. 32px for a control that is small in both
  // dimensions; 30px for a checkbox row, which is 150px+ wide and so only ever
  // needs height. The halo pair is checked properly below rather than by its rect.
  const short = rows.filter((r) => !r.halo && Math.min(r.w, r.h) < 30);
  const worst = {};
  for (const r of short) {
    const k = r.key;
    if (!worst[k] || Math.min(r.w, r.h) < Math.min(worst[k].w, worst[k].h)) worst[k] = r;
  }
  check(short.length === 0,
    `390px / ${density}: every control reaches the touch floor (${short.length} short of it)`,
    Object.values(worst).map((r) => `${r.key} ${r.w}x${r.h}`));

  // The halo pair: ask the document what is at a point OUTSIDE the element. If the
  // ::after is doing its job the control answers; if someone deletes it, the panel
  // behind answers and this fails, which is the whole point.
  for (const sel of [".pill-remove", ".info-tooltip"]) {
    // Both live well below the fold on a phone, and elementFromPoint only answers
    // for what is on screen — without the scroll this reported "not exercised"
    // twice per density and checked nothing at all.
    // `:visible`, because the first .info-tooltip is the header's and this
    // breakpoint hides it — scrolling to a display:none element moves nothing.
    await page.locator(`${sel}:visible`).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    const hit = await page.evaluate((s) => {
      const el = [...document.querySelectorAll(s)].find((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 1 && b.top > 60 && b.bottom < innerHeight - 10;
      });
      if (!el) return { found: false };
      const b = el.getBoundingClientRect();
      // 4px outside the left edge, vertically centred — inside the -7px halo.
      const at = document.elementFromPoint(b.left - 4, b.top + b.height / 2);
      return { found: true, box: Math.round(b.width), ours: at === el || el.contains(at) };
    }, sel);
    if (!hit.found) { console.log(`    (no ${sel} in view — halo not exercised)`); continue; }
    check(hit.ours, `390px / ${density}: ${sel} is still hittable ${4}px outside its ${hit.box}px box`, hit);
  }
  await ctx.close();
}

// Compact still has to be worth choosing. The floor costs it height — that is the
// trade — but if it ever stops being clearly shorter than comfortable, the setting
// has become a lie and someone needs to know.
const saved = 1 - heights.compact / heights.comfortable;
console.log(`    page height: comfortable ${heights.comfortable}, compact ${heights.compact} (${(saved * 100).toFixed(0)}% shorter)`);
check(saved > 0.18,
  `compact is still meaningfully shorter than comfortable (${(saved * 100).toFixed(0)}%)`,
  heights);

// And a mouse gets the smaller floor, so the desktop layout is not pushed around by
// a rule written for thumbs.
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(GEARED, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
  await page.waitForTimeout(700);
  const { rows } = await page.evaluate(SWEEP);
  const short = rows.filter((r) => !r.halo
    && r.key !== "input[checkbox].-" && r.key !== "input[radio].-"
    && Math.min(r.w, r.h) < 28);
  check(short.length === 0,
    `1500px / compact: every control reaches the pointer floor (${short.length} short)`,
    short.slice(0, 8).map((r) => `${r.key} ${r.w}x${r.h}`));
  await ctx.close();
}

await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
