// Every /api/ call the app makes must carry the API key.
//
// WHY THIS EXISTS: the X-API-Key gate sat dormant for months because the backend
// was never given the key (the deploy wrote it only into the frontend bundle).
// Switching it on took the calculator down: the editor resolved the chosen monster
// with a BARE fetch() instead of the api client, so that one request carried no key
// and came back 401. Two things then made it silent rather than loud --
//
//   * the handler did `.then(r => r.json())` with no `r.ok` check, so the 401 BODY
//     parsed cleanly and {error:"Unauthorized"} was stored as though it were a
//     monster. Every target name in the UI rendered "undefined";
//   * that object has no `hp`, so hits-to-kill and time-to-kill vanished.
//
// Reported by a player as "Is the calc bugging out for others too? All mobs becomes
// undefined. Hits to kill and time to kill are gone" (2026-10-29).
//
// So this checks the RULE, not just the one call site that broke it: no source file
// outside the api client may fetch /api/ directly. A live pass follows, because a
// static rule cannot prove the key actually works.
//
// Run with the gate ON, which is the only configuration that can fail:
//   backend:  API_KEY=k  frontend: VITE_API_KEY=k
//   node tools/e2e/api-key-coverage.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "") + "/";
let ok = true;
const check = (cond, msg, extra) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}${extra === undefined ? "" : `  [${JSON.stringify(extra)}]`}`);
  if (!cond) ok = false;
};

// ---- 1. static: nothing outside the client may fetch /api/ ----------------------
const SRC = fileURLToPath(new URL("../../open-ps-calc-frontend/frontend/src/", import.meta.url));
const CLIENT = path.join(SRC, "api", "client.ts");
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const offenders = [];
for (const file of walk(SRC)) {
  if (!/\.(ts|tsx)$/.test(file) || path.resolve(file) === path.resolve(CLIENT)) continue;
  const text = readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    // fetch("/api...), fetch('/api...), fetch(`/api...)
    if (/fetch\(\s*[`'"]\/api/.test(line)) {
      offenders.push({ file: path.relative(SRC, file), line: i + 1, code: line.trim().slice(0, 90) });
    }
  });
}
check(offenders.length === 0,
  "no source file outside api/client.ts fetches /api/ directly", offenders);

// ---- 1b. static: e2e scripts that call /api must carry the key too --------------
// The app rule above scans frontend/src, so it says nothing about THIS directory --
// and that is where the gap was. After the gate went live the audit for stray API
// calls looked for `fetch(`/api` and `fetch(`http…/api`, and missed
// custom-target-copy-mob's `fetch(`${API_BASE}/api/…`) because the line starts with
// a template substitution. It was reported clean and was not.
//
// So the rule is about the KEY, not the shape of the URL: any script here that
// fetches /api at all must mention OPSCALC_API_KEY, whether it sends the header
// itself (node-side) or installs it on the page (setExtraHTTPHeaders). That holds
// however the URL is spelled.
//
// This file is exempt: the patterns it searches for are written out in it.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const unkeyed = [];
for (const f of readdirSync(HERE)) {
  if (!f.endsWith(".mjs") || f.startsWith("_")) continue;
  const p = path.join(HERE, f);
  if (path.resolve(p) === path.resolve(SELF)) continue;
  const text = readFileSync(p, "utf8");
  const hits = text.split(/\r?\n/)
    .map((line, i) => ({ line: i + 1, code: line.trim() }))
    .filter(({ code }) => /\bfetch\s*\(/.test(code) && code.includes("/api"));
  if (hits.length && !text.includes("OPSCALC_API_KEY")) {
    unkeyed.push({ file: f, line: hits[0].line, code: hits[0].code.slice(0, 80) });
  }
}
check(unkeyed.length === 0,
  "every e2e script that fetches /api also carries the key", unkeyed);

// ---- 2. live: the key actually reaches every request ----------------------------
const frontend = new URL("../../open-ps-calc-frontend/frontend/", import.meta.url);
const LZ = createRequire(new URL("package.json", frontend))("lz-string");
const src = readFileSync(new URL("src/pages/BuildEditor.tsx", frontend), "utf8");
const SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low", "armor",
  "garment", "shoes", "accessory_left", "accessory_right"];
const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
const keys = [];
for (const line of block.split(/\r?\n/).slice(1)) {
  if (line.includes("...Z3_CARD_SLOTS")) { for (const s of SLOTS) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`); continue; }
  for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
}
const enc = {}; keys.forEach((k, i) => { if (!(k in enc)) enc[k] = i.toString(36); });
const ren = (v) => Array.isArray(v) ? v.map(ren) : (v && typeof v === "object")
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
const LINK = `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 7, base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 40, vit: 40, int: 1, dex: 60, luk: 1 },
    equipped: { right_hand: 1101 },
    target_mob_id: 1002,          // Poring: 42 HP, so hits-to-kill must appear
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
const page = await ctx.newPage();
const refused = [], errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/") && (r.status() === 401 || r.status() === 403)) {
    refused.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
  }
});
await page.goto(LINK, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(8000);

check(refused.length === 0, "no /api/ request was refused", [...new Set(refused)]);

const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
// The literal word is the symptom the player reported, so assert on it directly.
check(!/\bundefined\b/i.test(body), "the word \"undefined\" appears nowhere on the page",
  (body.match(/.{0,60}undefined.{0,30}/i) || [null])[0]);
check(/Poring/.test(body), "the target monster resolved to its name");
check(/Hits to kill/i.test(body), "hits to kill is present");
check(/Time to kill/i.test(body), "time to kill is present");
check(errors.length === 0, "no page errors", errors);

await browser.close();
console.log(ok ? "PASS" : "see failures");
process.exit(ok ? 0 : 1);
