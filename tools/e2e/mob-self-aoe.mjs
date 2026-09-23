// A monster's self-centred splash attack (Magnum Break, Pulse Strike, Grand Cross…)
// lands on everyone standing next to it — you included. The survivability panel left
// them out of the skill list entirely and reported "no direct damage" for them, because
// both the list and the pricing asked only for skills aimed AT a foe. Follow-up to the
// 2026-09-22 elemental-attack report, which surfaced the same classification gap.
//
// Golden Thief Bug casts Magnum Break at Lv20 (monsters cast above the player cap):
// 100 + 20×lv = 500% of its ATK, Fire.
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

const page = await (await b.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
const incoming = [];
page.on("response", async (r) => {
  if (!/\/calculate\/incoming$/.test(new URL(r.url()).pathname) || r.request().method() !== "POST") return;
  try { incoming.push({ req: r.request().postDataJSON(), res: await r.json() }); } catch {}
});

await page.goto(shareLink({
  build: { job_id: 7, base_level: 99, job_level: 50, base_stats: { str: 90, agi: 60, vit: 80, int: 1, dex: 50, luk: 1 },
    equipped: { right_hand: 1101, armor: 2314 }, target_mob_id: 1086 /* Golden Thief Bug */ },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
}), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /calculate damage/i }).first().click();
await page.waitForTimeout(4500);

// 1. It is offered at all — the list used to skip self-targeted skills.
const chip = page.locator(".surv-skill-chip, button, .surv-kit button", { hasText: /Magnum Break/i }).first();
const listed = await chip.count();
check(listed > 0, "Magnum Break is not offered in the monster's damage-skill list");

// 2. Picking it shows real damage, not "no direct damage".
if (listed) {
  await chip.click();
  await page.waitForTimeout(3000);
  const body = (await page.locator(".surv-view").innerText()).replace(/\s+/g, " ");
  const detail = body.slice(body.indexOf("Magnum Break"));
  console.log("panel:", detail.slice(0, 160));
  check(!/no direct damage/i.test(detail.slice(0, 200)), `Magnum Break must not read as harmless: ${detail.slice(0, 120)}`);

  const call = incoming.find((x) => x.req?.mob_skill && x.res?.skill?.name === "SM_MAGNUM");
  check(!!call, "the page never asked what Magnum Break does to you");
  if (call) {
    const r = call.res.result;
    console.log("API:", call.res.skill.name, "Lv" + call.res.skill.level, "ratio", call.res.skill.ratio,
      "->", r && Math.round(r.min_damage) + "-" + Math.round(r.max_damage));
    check(!!r, `the server priced no damage (damageType ${call.res.skill.damageType})`);
    check(call.res.skill.ratio === 500, `Lv${call.res.skill.level} Magnum Break is 100 + 20×lv = 500%, got ${call.res.skill.ratio}`);
    check(call.res.skill.estimated === false, "Magnum Break is priced from the player ratio, so it is not an estimate");
    if (r) {
      const shown = Math.round(r.max_damage).toLocaleString();
      check(body.includes(shown), `the panel does not show the computed ${shown}`);
    }
  }
}

await page.locator(".surv-view").screenshot({ path: join(tmpdir(), "mob-self-aoe.png") }).catch(() => {});
console.log(ok ? "PASS" : "see failures");
await b.close();
process.exit(ok ? 0 : 1);
