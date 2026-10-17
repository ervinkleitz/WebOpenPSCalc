// The Skill panel is one row, shaped like a buff row.
//
// It used to be four controls for one decision: a pill showing the chosen skill, a
// number box for its rank, a "Use normal attack" button, and a separately labelled
// search field. Now the search field IS the display — idle it shows the chosen
// skill, typing searches it — with a Lv select and an x beside it, the same shape as
// the party-buff rows.
//
// Run: node tools/e2e/skill-row.mjs [baseUrl]
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
let ok = true;
const check = (c, m, saw) => {
  if (!c) { console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`); ok = false; }
  else console.log("ok  " + m);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1600 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);

// Skills are filtered by job; an empty build offers none.
await page.locator(".character-identity select").first().selectOption({ label: "Assassin" });
await page.waitForTimeout(2500);

const row = () => page.evaluate(() => {
  const r = document.querySelector(".skill-row");
  return r && {
    value: r.querySelector("input")?.value,
    chosen: !!r.querySelector(".search-input--chosen"),
    level: r.querySelector(".skill-level")?.value ?? null,
    clear: !!r.querySelector(".pill-remove"),
    // The four-controls-for-one-decision shape is what this replaced.
    numberInputs: r.querySelectorAll('input[type="number"]').length,
  };
});

const before = await row();
// It must SAY what it is pricing. With nothing chosen the row showed only the
// "Search skills…" placeholder, which reads as an empty state — but a normal attack
// is what the calculator is actually costing, and the panel used to say so.
check(before && /normal attack/i.test(before.value || ""),
  "with no skill chosen the row still says Normal Attack", before);
check(before && before.level === null, "with no level, since a normal attack has no rank", before);
check(before && !before.clear, "and no x, since there is nothing to clear back to", before);
check(before && before.numberInputs === 0, "and no number box anywhere in the row", before);

// --- picking happens in the same field --------------------------------------
const box = page.locator(".skill-row input").first();
await box.click();
await page.waitForTimeout(400);
await page.keyboard.type("son", { delay: 80 });
await page.waitForTimeout(2500);
check(await page.locator(".search-result-item").count() > 0, "typing in it searches");
await page.locator(".search-result-item").first().click();
await page.waitForTimeout(2000);

const picked = await row();
check(picked && picked.value !== "" && picked.value !== "son",
  "the field now shows the chosen skill, not the query", picked);
check(picked && picked.chosen,
  "styled as a choice rather than as placeholder text", picked);
check(picked && picked.level !== null, "the Lv select appears", picked);
check(picked && picked.clear, "and an x to go back to normal attack", picked);

// The selection must survive the box still having focus — selecting clears the
// query while focus stays put, and keying the display off focus blanked the field
// with a skill plainly selected.
await box.click();
await page.waitForTimeout(600);
const refocused = await row();
check(refocused && refocused.value === picked.value,
  "clicking back into the field still shows the chosen skill", refocused);
await page.keyboard.press("Escape");

// --- the level drives the engine, not just the display -----------------------
const dmg = async () => {
  await page.getByRole("button", { name: /calculate damage/i }).first().click();
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    const hit = t.match(/([\d,]+)\s*MIN/i);
    return hit ? Number(hit[1].replace(/,/g, "")) : null;
  });
};
await page.locator(".skill-level").first().selectOption("1");
await page.waitForTimeout(1200);
const atLv1 = await dmg();
await page.locator(".skill-level").first().selectOption({ index: 0 });   // highest
await page.waitForTimeout(1200);
const atMax = await dmg();
check(atLv1 != null && atMax != null, "a damage figure is available to compare", { atLv1, atMax });
check(atMax > atLv1, `the Lv select changes the damage (${atLv1} -> ${atMax})`, { atLv1, atMax });

// --- x returns to normal attack ----------------------------------------------
await page.locator(".skill-row .pill-remove").click();
await page.waitForTimeout(1500);
const cleared = await row();
check(cleared && cleared.level === null && !cleared.clear
  && /normal attack/i.test(cleared.value || ""),
  "the x returns the row to Normal Attack, not to a blank field", cleared);

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
