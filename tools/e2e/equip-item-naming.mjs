// "in the equipment section, prepend the upgrade vs append (ex +7 cutlass). add the
// card prefix as well (ex. double bloody boned gladius for 2 skel worker, and 1 hydra
// cards slotted)" — 2026-10-13.
//
// The pill used to read "Gladius +7", with the cards listed separately below it, so it
// matched nothing a player sees in their own inventory. It now reads the way the client
// writes it: refine first, then one word per card, repeats collapsed into
// Double/Triple/Quadruple.
//
// The ORDER is slot order, not alphabetical and not grouped-by-count — which is why
// 2x Skel Worker in slots 1-2 plus 1x Hydra in slot 3 is "Double Boned Bloody Gladius"
// and not "Double Bloody Boned Gladius". The words themselves come from the client's
// cardprefixnametable (4092 Skel Worker = "Boned", 4035 Hydra = "Bloody").
//
// Run: node tools/e2e/equip-item-naming.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "module";
import { readFileSync } from "fs";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
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

const GLADIUS3 = 1220, SKEL_WORKER = 4092, HYDRA = 4035;
const COTTON_SHIRT = 2302, RODA_FROG = 4014;   // 4014 is a SUFFIX card: "of Champion"

const link = (equipped, refine) => `${URL_BASE}?b=z3_` + LZ.compressToEncodedURIComponent(JSON.stringify(ren({
  build: {
    job_id: 12, base_level: 99, job_level: 50,
    base_stats: { str: 83, agi: 89, vit: 10, int: 10, dex: 59, luk: 1 },
    equipped, refine, target_mob_id: 1002,
  },
  skill: { id: 0, level: 1, label: "Normal Attack" }, targetMode: "monster",
})));

let ok = true;
const check = (cond, msg, saw) => {
  if (!cond) { console.error(`FAIL: ${msg}\n      saw: ${JSON.stringify(saw)}`); ok = false; }
  else console.log(`ok  ${msg}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The visible name of a slot's pill, by the slot's own <label>.
const pillName = async (equipped, refine, label) => {
  await page.goto(link(equipped, refine), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  return page.evaluate((lbl) => {
    const field = [...document.querySelectorAll(".field")]
      .find((f) => f.querySelector("label")?.textContent?.trim() === lbl);
    const pill = field?.querySelector(".selected-pill .selected-pill__name");
    return pill ? pill.textContent.replace(/\s+/g, " ").trim() : null;
  }, label);
};

// --- 1. the reported case ------------------------------------------------------
const carded = {
  right_hand: GLADIUS3,
  right_hand_card1: SKEL_WORKER, right_hand_card2: SKEL_WORKER, right_hand_card3: HYDRA,
};
let name = await pillName(carded, { right_hand: 7 }, "Right hand (weapon)");
check(name === "+7 Double Boned Bloody Gladius",
  'a +7 Gladius[3] with 2x Skel Worker + 1x Hydra reads "+7 Double Boned Bloody Gladius"', name);

// --- 2. refine leads, and +0 says nothing --------------------------------------
name = await pillName(carded, { right_hand: 0 }, "Right hand (weapon)");
check(name === "Double Boned Bloody Gladius",
  "+0 contributes no word — the refine spinner is where a zero is read", name);

// --- 3. a bare weapon is just its name -----------------------------------------
name = await pillName({ right_hand: GLADIUS3 }, { right_hand: 4 }, "Right hand (weapon)");
check(name === "+4 Gladius", "an uncarded +4 Gladius reads \"+4 Gladius\"", name);

// --- 4. triple, and the count word tracks the card COUNT ------------------------
name = await pillName({
  right_hand: GLADIUS3,
  right_hand_card1: HYDRA, right_hand_card2: HYDRA, right_hand_card3: HYDRA,
}, { right_hand: 10 }, "Right hand (weapon)");
check(name === "+10 Triple Bloody Gladius", "three of one card gives \"Triple\"", name);

// --- 5. a SUFFIX card goes after the name, not before --------------------------
// Ignoring the client's postfix table would render "of Champion Cotton Shirt".
name = await pillName({ armor: COTTON_SHIRT, armor_card1: RODA_FROG },
  { armor: 0 }, "Armor");
check(name === "Cotton Shirt of Champion",
  "a suffix card follows the item name", name);

// --- 6. switching to wildcard mix drops the real cards' words ------------------
// Reported 2026-10-13: "switching to wildcard mix from a previous selection retains
// the prefixes of the previous set."
//
// Switching to the mix deliberately LEAVES the real cards equipped, so that switching
// back restores them — which means data.equipped still holds them and naming the pill
// from it kept titling the weapon after cards the engine had stopped pricing. This is
// the TRANSITION, clicked rather than loaded from a link, because that is the path the
// report came from and because it also covers the restore on the way back.
await page.goto(link(carded, { right_hand: 7 }), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const rightHand = page.locator(".equip-grid > .field")
  .filter({ has: page.locator('label:text-is("Right hand (weapon)")') });
const shownName = () => page.evaluate(() => {
  const f = [...document.querySelectorAll(".equip-grid > .field")]
    .find((x) => x.querySelector("label")?.textContent?.trim() === "Right hand (weapon)");
  return f?.querySelector(".selected-pill__name")?.textContent.replace(/\s+/g, " ").trim() ?? null;
});

check(await shownName() === "+7 Double Boned Bloody Gladius",
  "starts carded", await shownName());

await rightHand.getByRole("button", { name: /^Wildcard mix$/ }).click();
await page.waitForTimeout(2500);
name = await shownName();
check(name === "+7 Gladius",
  "in wildcard mix the weapon is named as if uncarded — the mix's bonuses have no names",
  name);

await rightHand.getByRole("button", { name: /^Cards$/ }).click();
await page.waitForTimeout(2500);
name = await shownName();
check(name === "+7 Double Boned Bloody Gladius",
  "switching back restores the real cards' words", name);

// --- 7. a host carrying more cards than it has room for -----------------------
// The jaludev importer emits this: its item tables are keyed by NAME, so a carded
// item whose name has no slotted variant in our DB resolves to a slotless id while
// its card arrives separately. The engine prices those cards — cardFitsSlot gates on
// loc, not on slot count — so the bonus is live. The editor drew `item.slots` rows,
// which for a slotless host is none, so it was live AND invisible, with no x to
// remove it. Rows now follow whichever is larger.
//
// 2289 Poo Poo Hat has 0 slots; 4002 Fabre Card is "Vital".
await page.goto(link({ armor: 2289, armor_card1: 4002 }, {}), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);

const armorSlot = () => page.evaluate(() => {
  const f = [...document.querySelectorAll(".equip-grid > .field")]
    .find((x) => x.querySelector("label")?.textContent?.trim() === "Armor");
  return {
    name: f?.querySelector(".selected-pill__name")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    rows: f ? f.querySelectorAll(".card-slot").length : 0,
    removers: f ? [...f.querySelectorAll(".card-slot button")].filter((b) => b.textContent.trim() === "×").length : 0,
    note: !!f?.querySelector(".card-slot-note"),
  };
});

let slot = await armorSlot();
check(slot.name === "Vital Poo Poo Hat", "a slotless host still shows its card's word", slot.name);
check(slot.rows === 1, "and the card gets a row even though the host has no slots", slot.rows);
check(slot.removers === 1, "with an x, so the live bonus can actually be removed", slot.removers);
check(slot.note, "and a note saying why the row is there", slot.note);

await page.locator(".equip-grid > .field")
  .filter({ has: page.locator('label:text-is("Armor")') })
  .locator(".card-slot button", { hasText: "×" }).first().click();
await page.waitForTimeout(2500);
slot = await armorSlot();
check(slot.name === "Poo Poo Hat" && slot.rows === 0 && !slot.note,
  "removing it drops the word, the row and the note", slot);

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
