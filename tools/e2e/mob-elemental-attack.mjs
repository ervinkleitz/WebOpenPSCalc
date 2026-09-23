// A monster's elemental attack (NPC_*ATTACK) is a weapon hit for 100% × skill level —
// Stormy Knight's Wind Attribute Attack Lv4 is 400% of its ATK. The survivability panel
// priced those lines as a plain re-coloured basic attack (100%), because our skill_db
// types the whole NPC_ attack family "Misc" and the pipeline skips Misc as non-damage.
// Reported in-game: "for MVPs like Stormy and Orc Lord the elemental damage seems too
// low — maybe the attack level is set too low" (2026-09-22).
//
// Driven through the UI, the way a player reads it: the Wind line must name the skill,
// show its level, and its damage must be the one the server computed at ratio 400%.
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
const num = (s) => Number(String(s).replace(/,/g, ""));

const page = await (await b.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
const incoming = [];
page.on("response", async (r) => {
  if (!/\/calculate\/incoming$/.test(new URL(r.url()).pathname) || r.request().method() !== "POST") return;
  try { incoming.push({ req: r.request().postDataJSON(), res: await r.json() }); } catch {}
});

// A Knight vs Stormy Knight (1251): Wind 4, and its Wind Attribute Attack is Lv4.
await page.goto(shareLink({
  build: { job_id: 7, base_level: 99, job_level: 50, base_stats: { str: 90, agi: 60, vit: 80, int: 1, dex: 50, luk: 1 },
    equipped: { right_hand: 1101, armor: 2314 }, target_mob_id: 1251 },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(4500);

const panel = page.locator(".surv-panel, .breakdown-view", { hasText: /Survivability/ }).first();
const lines = await page.locator(".surv-line").allInnerTexts();
const wind = lines.map((t) => t.replace(/\s+/g, " ")).find((t) => /^Wind attack/.test(t));
console.log("Wind line:", wind);
check(!!wind, "no Wind attack line on the survivability panel");
check(wind && /Wind Attribute Attack Lv4/i.test(wind), `the line should name the skill and its level, got: ${wind}`); // the panel styles it uppercase
// The mitigation chip is measured against the post-ratio hit, so it stays a real
// percentage instead of going negative on a 400% attack.
const mit = (wind || "").match(/(-?\d+)% mitigated/);
check(mit && Number(mit[1]) >= 0 && Number(mit[1]) <= 100, `mitigation should read 0-100%, line: ${wind}`);

// The number shown must be the one the server computed for that skill.
const skillCall = incoming.find((x) => x.req?.mob_skill?.id === 187);
check(!!skillCall, "the page never asked for the Wind Attribute Attack's damage");
// With the fix out, the skill resolves as a status ("no direct damage") and the server
// returns no result at all — report that as a failure rather than crashing on it.
check(!skillCall || !!skillCall.res.result,
  `the server priced no damage for Wind Attribute Attack (modeled: ${skillCall?.res?.modeled}, damageType: ${skillCall?.res?.skill?.damageType})`);
if (skillCall && skillCall.res.result && wind) {
  const r = skillCall.res.result;
  const ratioStep = (r.steps || []).find((s) => s.name === "Skill Ratio");
  console.log("API:", r.min_damage, "-", r.max_damage, "| ratio step:", ratioStep && ratioStep.note, "| level", skillCall.req.mob_skill.level);
  check(skillCall.req.mob_skill.level === 4, `the page must ask at the level the monster casts (4), asked ${skillCall.req.mob_skill.level}`);
  check(ratioStep && /Ratio 400%/.test(ratioStep.note), `Lv4 must price at 400%, got: ${ratioStep && ratioStep.note}`);
  const shown = (wind.match(/([\d,]+)(?:–([\d,]+))?\s*\/ hit/) || []);
  const lo = num(shown[1]), hi = shown[2] ? num(shown[2]) : lo;
  check(lo === Math.round(r.min_damage) && hi === Math.round(r.max_damage),
    `the page shows ${lo}–${hi} but the server computed ${Math.round(r.min_damage)}–${Math.round(r.max_damage)}`);
  // 400% must actually be four times the same hit at 100% — the bug was this line
  // being priced as a plain attack.
  const atOne = await page.evaluate(async ([build, mods]) => {
    const r = await fetch("/api/calculate/incoming", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ build, target: { mob_id: 1251 }, mob_skill: { id: 187, level: 1 }, target_mods: mods }) });
    return (await r.json()).result;
  }, [skillCall.req.build, skillCall.req.target_mods]);
  console.log("same skill at Lv1 (100%):", atOne.min_damage, "-", atOne.max_damage);
  // Slightly ABOVE 4× after mitigation: the ratio scales the monster's ATK, then your
  // DEF comes off as a flat subtraction, so it eats proportionally less of the bigger hit.
  const times = r.avg_damage / atOne.avg_damage;
  check(times > 4 && times < 4.6, `Lv4 should hit ~4× as hard as Lv1, got ${times.toFixed(2)}×`);
}

await panel.screenshot({ path: join(tmpdir(), "mob-elemental.png") }).catch(() => {});
console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
