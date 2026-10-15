// theme-contrast.mjs — every visible string, measured against its real background, in
// BOTH themes.
//
// WHY THIS EXISTS: this calculator ships a dark theme and a light one, and for a long
// while only the dark one was ever looked at. That is how two players comparing screens
// found selected text unreadable (2026-10-14, Sandrea and Noobitaa) — nobody had checked
// what the other theme, or the browser's own defaults, were doing. A colour that passes
// in dark can fail in light and vice versa: the accent is #d8a657 on dark and #966419 on
// light, so white-on-accent is fine in one and washed out in the other.
//
// It is NOT a style opinion. It computes the WCAG contrast ratio of each text element
// against the background actually painted behind it (walking up through translucent
// layers and compositing them), and compares against the AA threshold for that text's
// size and weight.
//
// BASELINE, not a pass/fail gate. The app already has failures, some of them deliberate
// (a muted hint is meant to recede). Everything currently failing is recorded in
// theme_contrast_baseline.json and stays quiet; the run fails only on something NEW,
// which is the same shape as the PS item/skill audits. After reviewing a real finding,
// re-run with --accept and commit the baseline.
//
//   node tools/e2e/theme-contrast.mjs            check against the baseline
//   node tools/e2e/theme-contrast.mjs --accept   record the current state as the baseline
//   node tools/e2e/theme-contrast.mjs --list     print everything failing, baseline or not
//
// Pass a base URL as the last argument to point it at something other than localhost.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync } from "fs";

const args = process.argv.slice(2);
const ACCEPT = args.includes("--accept");
const LIST = args.includes("--list");
const BASE = args.find((a) => !a.startsWith("--")) || "http://localhost:5173/";
const BASELINE = new URL("theme_contrast_baseline.json", import.meta.url);

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

// A populated build, so the sweep sees real numbers, pills, cards and a skill rather
// than an empty editor. Carded + refined + a skill + a target exercises most of the
// colours the app has.
const URL_ = BASE + "?b=z3_" + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
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

// Runs in the page. Composites translucent backgrounds down to something opaque, then
// applies the WCAG relative-luminance formula.
const SWEEP = () => {
  const toRGB = (c) => {
    const m = (c || "").match(/[\d.]+/g);
    return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] !== undefined ? +m[3] : 1 } : null;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // The background actually behind this text: walk up compositing translucent layers
  // until something opaque is reached. Reading only the element's own background-color
  // reports "transparent" for almost everything and makes the whole check meaningless.
  const effBg = (el) => {
    let n = el, acc = null;
    while (n && n !== document.documentElement) {
      const c = toRGB(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
      n = n.parentElement;
    }
    const root = toRGB(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, root) : root;
  };
  const cls = (el) => (el.className && el.className.baseVal !== undefined
    ? el.className.baseVal : String(el.className || "")).trim().split(/\s+/)[0] || el.tagName.toLowerCase();

  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    // Only elements holding their own text, so a wrapper is not blamed for its children.
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join(" ").trim();
    if (!txt || txt.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = toRGB(cs.color);
    if (!fg) continue;
    const bg = effBg(el);
    const cr = ratio(fg.a < 1 ? over(fg, bg) : fg, bg);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (cr < need) out.push({ key: cls(el), ratio: Math.round(cr * 100) / 100, need, sample: txt.slice(0, 40) });
  }
  // One row per class: a repeated component is one finding, not forty.
  const best = new Map();
  for (const o of out) if (!best.has(o.key) || best.get(o.key).ratio > o.ratio) best.set(o.key, o);
  return [...best.values()].sort((a, b) => a.ratio - b.ratio);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const found = {};
for (const theme of ["dark", "light"]) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 2400 } })).newPage();
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(800);
  found[theme] = await page.evaluate(SWEEP);
  await page.close();
}
await browser.close();

if (LIST) {
  for (const theme of ["dark", "light"]) {
    console.log(`\n### ${theme} — ${found[theme].length} below AA`);
    for (const f of found[theme]) {
      console.log(`  ${String(f.ratio).padStart(5)}:1 (need ${f.need})  .${f.key.padEnd(32)} ${JSON.stringify(f.sample)}`);
    }
  }
  process.exit(0);
}

if (ACCEPT) {
  const baseline = {};
  for (const theme of ["dark", "light"]) baseline[theme] = found[theme].map((f) => f.key).sort();
  writeFileSync(BASELINE, JSON.stringify({
    _note: "Text already below WCAG AA when this check was written. Known, not endorsed — "
      + "the point of the file is that a NEW failure is loud. Shrink it when you touch "
      + "one of these, and re-run with --accept.",
    _accepted: new Date().toISOString().slice(0, 10),
    ...baseline,
  }, null, 1) + "\n");
  console.log(`baseline written: ${baseline.dark.length} dark, ${baseline.light.length} light`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("no baseline — run with --accept once, review it, and commit it");
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));
let ok = true;
for (const theme of ["dark", "light"]) {
  const known = new Set(base[theme] || []);
  const fresh = found[theme].filter((f) => !known.has(f.key));
  const fixed = [...known].filter((k) => !found[theme].some((f) => f.key === k));
  console.log(`${theme.padEnd(6)} ${found[theme].length} below AA (${known.size} known)`);
  for (const f of fresh) {
    console.error(`  NEW  ${f.ratio}:1 (need ${f.need})  .${f.key}  ${JSON.stringify(f.sample)}`);
    ok = false;
  }
  if (fixed.length) console.log(`  improved, drop from the baseline: ${fixed.join(", ")}`);
}
console.log(ok ? "\nPASS — no new contrast failures in either theme"
  : "\nFAIL — new text below AA. Fix it, or accept it deliberately with --accept.");
process.exit(ok ? 0 : 1);
