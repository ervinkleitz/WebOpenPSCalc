// Double Attack was fully modelled and completely invisible. A player reported it as
// "not implemented": maxed Double Attack on a Thief/Rogue/Assassin, or a Monk with a
// Sidewinder Card, and nothing on screen mentioned a proc. The engine had it all along
// — 7%/level on Payon Stories, folded straight into the DPS — but the UI read only
// `proc_branches`, and Double Attack reports through `double_hit` / `proc_chance`, so
// no panel ever rendered. Triple Attack, two lines away in the same file, got one.
//
// A number that silently includes something is indistinguishable from one that ignores
// it, so this asserts the proc is NAMED on screen with its chance.
import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:5173/";
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

const build = (over) => ({
  build: {
    name: "e2e", job_id: 17, job_name: "Rogue", base_level: 99, job_level: 50,
    base_stats: { str: 90, agi: 90, vit: 1, int: 1, dex: 50, luk: 1 },
    bonus_stats: {}, equipped: {}, refine: {}, forge: {}, mastery_levels: {},
    target_mob_id: 1002, server: "payon_stories", consumable_buffs: {},
    active_buffs: {}, song_state: {}, wildcard_slots: {}, ...over,
  },
  skill: { id: 0, level: 1, label: "Normal Attack", max_level: 10 },
  targetMode: "monster", customTarget: {}, targetMods: {},
});

const cases = [
  // Dagger + the skill itself: 7%/lv on PS, so Lv10 is 70%.
  { name: "Rogue, dagger, Double Attack 10", expect: /Double Attack/, chance: "70.0",
    state: build({ equipped: { right_hand: 1224 }, mastery_levels: { TF_DOUBLE: 10 } }) },
  // The card works on the weapon it is compounded in, whatever that is (wiki
  // Class_Rebalance, Thief). It grants Double Attack level 2, so a Monk's knuckle shows
  // the same 14% a dagger would. This expected 5% until 2026-09-02 — the value from
  // before the weapon restriction was lifted, which this file went on asserting for
  // hours because it is deliberately outside `npm test` and nobody re-ran it.
  { name: "Monk, knuckle + Sidewinder Card", expect: /Double Attack/, chance: "14.0",
    state: build({ job_id: 15, job_name: "Monk", equipped: { right_hand: 1801, right_hand_card1: 4117 } }) },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.evaluate((s) => sessionStorage.setItem("opscalc.draft", JSON.stringify({ state: s, sourceParam: null })), c.state);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "Calculate damage" }).click();
    await page.waitForTimeout(4800);

    const panel = page.locator(".breakdown-view", { hasText: c.expect }).first();
    if (!(await panel.count())) {
      fail(`${c.name}: no proc panel on screen — the DPS includes it but nothing says so`);
    } else {
      const text = (await panel.innerText()).replace(/\s+/g, " ");
      if (!text.includes(`${c.chance}%`)) fail(`${c.name}: panel does not show ${c.chance}% (got "${text.slice(0, 90)}")`);
      else console.log(`${c.name.padEnd(34)} -> ${text.slice(0, 46)}`);
    }
    await page.close();
  }
  if (!process.exitCode) console.log("\nPASS — the proc is named on screen with its chance.");
} finally {
  await browser.close();
}
