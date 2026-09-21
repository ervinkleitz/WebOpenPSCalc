// Venom Splasher gains +30% ATK per Poison React level (wiki Venom_Splasher: "Poison React
// adds extra (30% * Skill level)% ATK passive bonus", up to 1300%). The engine read that
// level from a field nothing ever set, and Poison React was in no panel, so the bonus was
// always 0 (Laila, 2026-09-21). Driven through the UI, the way a player sets it.
//
// The Double Attack half of the same report: Double Attack's +1 HIT per level, only on the
// swing that procs it, was always in the DPS but shown nowhere. The Double Attack panel now
// states the proc swing's own hit chance.
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
const calculate = async (page) => {
  const calc = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await calc.count()) { await calc.click(); await page.waitForTimeout(3500); }
};

// ── 1. Poison React ──────────────────────────────────────────────────────────
{
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1300 } })).newPage();
  // Capture what the page itself asked for and got, to cross-check the rendered numbers.
  const responses = [];
  page.on("response", async (r) => { if (/\/calculate$/.test(new URL(r.url()).pathname) && r.request().method() === "POST") { try { responses.push({ skill: r.request().postDataJSON()?.skill?.id, res: await r.json() }); } catch {} } });
  await page.goto(shareLink({
    build: { job_id: 12, base_level: 99, job_level: 50, base_stats: { str: 90, agi: 60, vit: 1, int: 1, dex: 60, luk: 1 },
      equipped: { right_hand: 1201 }, target_mob_id: 1002 },
    skill: { id: 141, level: 10, label: "Venom Splasher" }, targetMode: "monster",
  }), { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const panel = page.locator(".panel", { has: page.locator("h2", { hasText: /Passive skills/i }) }).first();
  const field = panel.locator(".field", { has: page.locator("label", { hasText: /^Poison React$/i }) }).first();
  check(await field.count() === 1, "Poison React is not in the Assassin's Passive skills panel");
  const fieldText = (await field.innerText()).replace(/\s+/g, " ");
  check(/\/\s*10\b/.test(fieldText), `Poison React should cap at 10, field reads: ${fieldText}`);

  const lastFor = (id) => responses.filter((x) => x.skill === id).at(-1)?.res;
  const ratioOf = (r) => r?.result?.normal?.steps?.find((s) => /ratio/i.test(s.name));
  await calculate(page);
  const before = lastFor(141);
  const avg0 = before?.result?.normal?.avg_damage;
  await field.locator("input").first().fill("10");
  await page.waitForTimeout(800);
  await calculate(page);
  const after = lastFor(141);
  const avg10 = after?.result?.normal?.avg_damage;
  console.log("Venom Splasher avg, Poison React 0 -> 10:", avg0, "->", avg10, "ratio steps:", ratioOf(before)?.multiplier, ratioOf(after)?.multiplier);
  check(avg0 > 0 && avg10 > 0 && Math.abs(avg10 / avg0 - 1.3) < 0.02, `Poison React 10 should raise Venom Splasher by 1300/1000, got ${avg0} -> ${avg10}`);
  // The number a player reads must be the one computed.
  const body = (await page.locator("body").innerText()).replace(/,/g, "");
  check(body.includes(String(Math.round(avg10))), `the page does not show the new average ${Math.round(avg10)}`);
  await page.screenshot({ path: join(tmpdir(), "poison-react.png"), fullPage: false });
}

// ── 2. Double Attack's proc-swing hit chance ─────────────────────────────────
{
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1300 } })).newPage();
  const responses = [];
  page.on("response", async (r) => { if (/\/calculate$/.test(new URL(r.url()).pathname) && r.request().method() === "POST") { try { responses.push({ skill: r.request().postDataJSON()?.skill?.id, res: await r.json() }); } catch {} } });
  // A Thief who misses a Wander Man often: DEX 80 gives ~36% base hit.
  const load = async (dex) => {
    await page.goto(shareLink({
      build: { job_id: 6, base_level: 50, job_level: 40, base_stats: { str: 50, agi: 1, vit: 1, int: 1, dex, luk: 1 },
        equipped: { right_hand: 1201 }, mastery_levels: { TF_DOUBLE: 10 }, target_mob_id: 1208 },
      skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
    }), { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await calculate(page);
  };
  const daPanel = async () => {
    const p = page.locator(".breakdown-view", { hasText: /Double Attack/ }).first();
    return (await p.count()) ? (await p.innerText()).replace(/\s+/g, " ") : null;
  };
  await load(80);
  const r = responses.filter((x) => x.skill === 0).at(-1)?.res?.result;
  const text = await daPanel();
  const m = text && text.match(/hits (\d+\.\d)% of the time — (\d+\.\d)% \+(\d+) HIT on a Double Attack swing/);
  console.log("DA panel line:", m ? m[0] : text?.slice(0, 200), "| API:", r?.hit_chance, r?.double_hit_chance, r?.double_hit_bonus);
  check(!!m, "the Double Attack panel does not state the proc swing's hit chance");
  if (m && r) {
    check(m[1] === r.double_hit_chance.toFixed(1), `shown ${m[1]}% but computed ${r.double_hit_chance}`);
    check(m[2] === r.hit_chance.toFixed(1), `base shown ${m[2]}% but computed ${r.hit_chance}`);
    check(m[3] === "10", `bonus should be +10 HIT (Double Attack 10), shown +${m[3]}`);
    check(r.double_hit_chance > r.hit_chance, "the proc swing should hit more often than a plain swing");
  }
  await page.locator(".breakdown-view", { hasText: /Double Attack/ }).first().screenshot({ path: join(tmpdir(), "da-hit.png") }).catch(() => {});

  // Negative: at 100% hit the bonus changes nothing, so the line is not shown.
  await load(250);
  const r2 = responses.filter((x) => x.skill === 0).at(-1)?.res?.result;
  const t2 = await daPanel();
  console.log("at DEX 250: hit", r2?.hit_chance, "| panel mentions HIT bonus:", /\+\d+ HIT on a/.test(t2 || ""));
  if (r2?.hit_chance >= 100) check(t2 && !/\+\d+ HIT on a/.test(t2), "the HIT line should be hidden when hit is already 100%");
  else check(false, `negative case needs 100% hit, got ${r2?.hit_chance}`);
}

console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
