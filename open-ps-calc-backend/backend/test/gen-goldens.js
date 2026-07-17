/**
 * gen-goldens.js — regenerate test/goldens.json from the CURRENT engine.
 *
 *   node test/gen-goldens.js
 *
 * Run this ONLY when a calc change is intentional and verified (against the
 * PS wiki / rework PDFs / in-game numbers — see ROADMAP.md's audit notes).
 * Review the resulting goldens.json diff line by line before committing: every
 * changed number is a behavior change users will see.
 */
const fs = require("fs");
const path = require("path");
const { scenarios } = require("./scenarios");
const { runScenario } = require("./engineRunner");

const out = {};
for (const sc of scenarios) {
  if (out[sc.name]) throw new Error(`duplicate scenario name: ${sc.name}`);
  out[sc.name] = runScenario(sc);
  console.log(`generated: ${sc.name}`);
}

const file = path.join(__dirname, "goldens.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote ${Object.keys(out).length} goldens to ${file}`);
