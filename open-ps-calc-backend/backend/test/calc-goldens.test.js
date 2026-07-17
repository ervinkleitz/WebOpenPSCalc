/**
 * calc-goldens.test.js — golden regression suite for the damage engine.
 *
 * Every scenario in test/scenarios.js is run through the real engine and its
 * normalized output (damage min/max/avg, step names, DPS, hit/crit chance,
 * status values) is compared against test/goldens.json.
 *
 * If this fails after a code change:
 *   - UNINTENTIONAL: you broke a calc — fix the code, not the golden.
 *   - INTENTIONAL (verified formula fix): regenerate with
 *       node test/gen-goldens.js
 *     and review the goldens.json diff — every changed number is a behavior
 *     change users will see.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { scenarios } = require("./scenarios");
const { runScenario } = require("./engineRunner");

const goldens = JSON.parse(fs.readFileSync(path.join(__dirname, "goldens.json"), "utf8"));

test("every scenario has a golden and vice versa", () => {
  const names = scenarios.map((s) => s.name);
  assert.deepStrictEqual(
    Object.keys(goldens).sort(),
    [...names].sort(),
    "scenarios.js and goldens.json are out of sync — run `node test/gen-goldens.js`",
  );
  assert.strictEqual(new Set(names).size, names.length, "duplicate scenario names");
});

for (const sc of scenarios) {
  test(`golden: ${sc.name}`, () => {
    const actual = runScenario(sc);
    assert.deepStrictEqual(
      actual,
      goldens[sc.name],
      `engine output changed for "${sc.name}" — if intentional and verified, run \`node test/gen-goldens.js\` and review the diff`,
    );
  });
}
