// The refine pill's caret must not sit on top of its digits.
//
// Reported with a screenshot 2026-10-27: at +10 the second digit ran underneath the
// down-caret. The caret is drawn by .refine-wrap::after rather than by the native
// select (appearance:none is load-bearing — a native select reserves the arrow's
// room INSIDE its width, which clipped "+10"), so the ONLY thing holding the digits
// clear of it is the select's right padding.
//
// That padding was on a bare `.refine-select` at specificity (0,1,0), and the
// density pass carries `html[data-density="compact"] select` at (0,1,1), which
// replaced the asymmetric padding with a symmetric 0.45rem. Comfortable kept its
// 4px of clearance; compact went to -4px and the digit was under the caret. One
// density was right, which is why it survived.
//
// Measured rather than eyeballed: the glyph width comes from a canvas using the
// select's own resolved font, and the caret's left edge from its computed `right`.
// A screenshot test would not catch a 4px overlap, and the native popup never
// appears in one anyway.
//
// Run: node tools/e2e/refine-caret-clearance.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${saw === undefined ? "" : `  ${JSON.stringify(saw)}`}`);
  if (!c) ok = false;
};

const FE = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", FE))("lz-string");
const feSrc = readFileSync(new URL("src/pages/BuildEditor.tsx", FE), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_left", "accessory_right"];
const blk = feSrc.slice(feSrc.indexOf("const Z3_KEYS: string[] = ["), feSrc.indexOf("const Z3_ENC"));
const z3 = [];
for (const line of blk.split("\n").slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of SLOTS) for (const i of [1, 2, 3, 4]) z3.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) z3.push(m[1]);
}
const enc = {}; z3.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x])=> [enc[k] ?? k, ren(x)])) : v;
// +10 is the widest the control ever shows, so it is the only case worth measuring.
const LINK = `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 60, vit: 60, int: 1, dex: 60, luk: 20 },
    equipped: { right_hand: 1364 }, refine: { right_hand: 10 }, target_mob_id: 1036,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

for (const density of ["comfortable", "compact"]) {
  for (const theme of ["dark", "light"]) {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 1100 } })).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(LINK, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    await page.evaluate(([t, d]) => {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-density", d);
    }, [theme, density]);
    const slot = page.locator(".equip-slot").filter({ hasText: "Right hand" });
    await slot.locator(".equip-slot-head").click();
    await page.waitForTimeout(600);

    const geo = await page.evaluate(() => {
      const sel = document.querySelector(".refine-select");
      const wrap = document.querySelector(".refine-wrap");
      if (!sel || !wrap) return null;
      const s = sel.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      const cs = getComputedStyle(sel);
      const c = document.createElement("canvas").getContext("2d");
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = sel.options[sel.selectedIndex].text;
      const textW = c.measureText(text).width;
      const caretRight = parseFloat(getComputedStyle(wrap, "::after").right);
      const CARET_W = 6; // 3px + 3px border triangle
      return {
        text,
        gap: +((w.right - caretRight - CARET_W) - (s.left + parseFloat(cs.paddingLeft) + textW)).toFixed(1),
        clipped: +(sel.scrollWidth - sel.clientWidth).toFixed(1),
      };
    });

    check(!!geo && geo.text === "+10", `${density}/${theme}: the control is showing +10`, geo && geo.text);
    // > 0 is "not overlapping"; 2px is the floor for it to read as separate rather
    // than as a digit wearing a hat.
    check(!!geo && geo.gap >= 2,
      `${density}/${theme}: the digits clear the caret`, geo && { gap: geo.gap });
    // The other half of the original bug: the fix must not buy clearance by
    // squeezing the control until the digits are cut off instead.
    check(!!geo && geo.clipped <= 0,
      `${density}/${theme}: and are not clipped to make room`, geo && { overflow: geo.clipped });
    await page.close();
  }
}

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
