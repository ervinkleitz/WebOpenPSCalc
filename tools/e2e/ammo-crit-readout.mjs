// Where a bullet's crit goes, and why the two numbers differ.
//
// Asked by a player 2026-10-27: "is rifles extra crit with armor piercing bullet
// shown in the damage calc?" It is — Armor Piercing Bullet is +10 crit, +20 more on
// a Rifle, and the damage uses all of it. What they had actually spotted is that the
// COMBAT STATS card said 19.3% while the breakdown said 54.3%.
//
// That gap is CORRECT and must stay. battle.c:5172 adds arrow_cri at the moment of
// the shot, inside `if (flag.arrow)`, so it is not part of status.cri — which is
// exactly why the client's own status window leaves it out too. Folding it into the
// card would make the calculator stop matching the window a player can see in game,
// which is a worse bug than the confusion it would cure.
//
// So the card keeps the character's figure and explains where the rest went. What
// this test pins is the thing that would actually rot: the number the note quotes
// has to equal the breakdown's Crit chance. Two components, two code paths, one
// claim — if they ever drift, the explanation becomes a second wrong number.
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
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [enc[k] ?? k, ren(x)])) : v;
const link = (equipped) => `${URL_BASE}/?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 24, base_level: 99, job_level: 50,
    base_stats: { str: 50, agi: 90, vit: 40, int: 20, dex: 90, luk: 60 },
    equipped, target_mob_id: 1036,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

const APB = 13233, RIFLE = 13171, REVOLVER = 13100;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

const look = async (equipped) => {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1200 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(link(equipped), { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const btn = page.getByRole("button", { name: /calculate damage/i }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(5000); }
  const card = page.locator(".sec-stat-card", { has: page.locator(".sec-stat-label", { hasText: /^Critical$/ }) }).first();
  await card.scrollIntoViewIfNeeded();
  // The note is a HoverNote: its body is not in the DOM until the card is hovered
  // or focused. Reading without this gets the bare value and every assertion about
  // the note passes or fails for the wrong reason - the no-ammo check in particular
  // would pass simply because no note existed.
  await card.hover();
  await page.waitForTimeout(500);
  const text = (await card.innerText()).replace(/\s+/g, " ").trim();
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const out = {
    stat: Number((text.match(/CRITICAL\s*([\d.]+)%/i) || [])[1]),
    // "…for 62.6% on an attack that fires it"
    quoted: text.match(/for ([\d.]+)% on an attack/) ? Number(text.match(/for ([\d.]+)% on an attack/)[1]) : null,
    breakdown: Number((body.match(/CRIT CHANCE\s*([\d.]+)\s*%/i) || [])[1]),
    mentionsAmmo: /loaded ammo adds/.test(text),
    note: text,
  };
  await page.close();
  return out;
};

// ---- 1. a Rifle gets the conditional +20 on top of the flat +10 ---------------
const rifle = await look({ right_hand: RIFLE, ammo: APB });
const rifleBare = await look({ right_hand: RIFLE });
check(Math.abs((rifle.breakdown - rifleBare.breakdown) - 30) < 0.05,
  "Armor Piercing Bullet is worth +30 crit chance on a Rifle",
  { bare: rifleBare.breakdown, withBullet: rifle.breakdown });

// ---- 2. ...and only the flat +10 on anything else -----------------------------
const revolver = await look({ right_hand: REVOLVER, ammo: APB });
const revolverBare = await look({ right_hand: REVOLVER });
check(Math.abs((revolver.breakdown - revolverBare.breakdown) - 10) < 0.05,
  "and +10 on a Revolver, where the [Rifle] clause does not apply",
  { bare: revolverBare.breakdown, withBullet: revolver.breakdown });

// ---- 3. the card keeps the CHARACTER's figure, as the game's window does ------
check(rifle.stat === rifleBare.stat,
  "the Critical card does not move when ammo is loaded — it matches the game's status window",
  { bare: rifleBare.stat, withBullet: rifle.stat });

// ---- 4. ...and says where the rest went, to the same number ------------------
// This is the assertion with teeth: the note and the breakdown are rendered by
// different components from different fields, and must agree.
for (const [label, r] of [["Rifle", rifle], ["Revolver", revolver]]) {
  check(r.mentionsAmmo, `${label}: the card explains that the ammo adds more`);
  check(r.quoted != null && Math.abs(r.quoted - r.breakdown) < 0.05,
    `${label}: the total it quotes equals the breakdown's Crit chance`,
    { quoted: r.quoted, breakdown: r.breakdown });
}

// ---- 5. with no ammo it still says where such a bonus WOULD go ----------------
check(!rifleBare.mentionsAmmo && /Sharp Arrow|Armor\s*Piercing/.test(rifleBare.note || ""),
  "with nothing loaded it claims no bonus but still says where such a bonus would go",
  { mentionsAmmo: rifleBare.mentionsAmmo, hasNote: !!rifleBare.note });

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
