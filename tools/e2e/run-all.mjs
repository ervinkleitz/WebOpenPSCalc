#!/usr/bin/env node
/**
 * run-all.mjs — run the browser regression suite.
 *
 * WHY A RUNNER: these are 50 standalone scripts, which is good (each one is readable on
 * its own and quotes the bug it was written for) and bad (there was no single command,
 * and nothing told you WHY a run failed when the real problem was that you had not
 * started the dev servers). Every prerequisite below was something that fails with a
 * stack trace rather than a sentence.
 *
 *   node tools/e2e/run-all.mjs                  everything, against localhost
 *   node tools/e2e/run-all.mjs card             only scripts whose name contains "card"
 *   node tools/e2e/run-all.mjs --url https://openpscalc.com/
 *   node tools/e2e/run-all.mjs --bail           stop at the first failure
 *
 * The full run takes the better part of an hour: each script starts a browser, loads
 * the app and waits for a real calculation to come back. Filter while you work.
 */
import { readdirSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const BAIL = argv.includes("--bail");
const urlIdx = argv.indexOf("--url");
const BASE = urlIdx >= 0 ? argv[urlIdx + 1] : "http://localhost:5173/";
// The guard has to be conditional: with no --url, urlIdx is -1 and "i !== urlIdx + 1"
// excludes index 0 — which silently swallowed the filter and ran the whole suite.
const filter = argv.find((a, i) => !a.startsWith("--") && !(urlIdx >= 0 && i === urlIdx + 1));

// Scripts starting with _ are scratch; run-all and the contrast check are not regressions.
const SKIP = new Set(["run-all.mjs", "theme-contrast.mjs"]);
const scripts = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && !SKIP.has(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!scripts.length) {
  console.error(filter ? `no scripts match ${JSON.stringify(filter)}` : "no scripts found");
  process.exit(1);
}

// --- prerequisites, each with the sentence that would have saved the stack trace ----
const fail = (msg) => { console.error("\n" + msg + "\n"); process.exit(1); };

try {
  const { chromium } = await import("playwright-core");
  // playwright-core deliberately ships NO browsers, so this uses the Chrome you already
  // have. If it is missing, say so plainly instead of surfacing an executable path.
  const probe = await chromium.launch({ channel: "chrome", headless: true }).catch(async () => {
    return chromium.launch({ channel: "msedge", headless: true });
  });
  await probe.close();
} catch (e) {
  if (/Cannot find package/.test(String(e.message))) {
    fail("playwright-core is not installed.\n  (cd tools/e2e && npm install)");
  }
  fail("No usable browser. These scripts drive your INSTALLED Chrome (or Edge) —\n"
    + "playwright-core bundles none on purpose. Install Google Chrome, or run them\n"
    + "against a browser you have by editing the channel.\n\n  " + String(e.message).split("\n")[0]);
}

const reachable = async (u) => {
  try { const r = await fetch(u, { method: "GET" }); return r.ok || r.status < 500; }
  catch { return false; }
};
if (!(await reachable(BASE))) {
  fail(`Nothing is serving ${BASE}.\n`
    + "  cd open-ps-calc-frontend/frontend && npm run dev     (port 5173)\n"
    + "  cd open-ps-calc-backend/backend   && npm run dev     (port 4000)\n"
    + "Both are needed: the front end proxies /api to the back end, and these tests\n"
    + "wait on real calculations.");
}
if (BASE.includes("localhost") && !(await reachable("http://localhost:4000/api/data/jobs"))) {
  fail("The front end is up but the API on port 4000 is not.\n"
    + "  cd open-ps-calc-backend/backend && npm run dev\n"
    + "Without it every script times out waiting for numbers that never arrive.");
}

// --- run ----------------------------------------------------------------------------
console.log(`${scripts.length} script${scripts.length === 1 ? "" : "s"} against ${BASE}\n`);
const started = Date.now();
const failed = [];
for (const [i, file] of scripts.entries()) {
  const name = file.replace(/\.mjs$/, "");
  process.stdout.write(`[${String(i + 1).padStart(2)}/${scripts.length}] ${name.padEnd(34)}`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, file), BASE], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (c) => {
      // Most scripts print PASS/FAIL and exit 0 regardless, so trust the text as well
      // as the exit code — otherwise half the suite reports green unconditionally.
      const said = /\bPASS\b/.test(out) && !/\bFAIL\b/.test(out);
      if (c !== 0 || !said) {
        const why = out.split("\n").filter((l) => /FAIL|Error|error:/.test(l)).slice(0, 3);
        failed.push({ name, why: why.length ? why : [`exit ${c}, no PASS in output`] });
      }
      resolve(c);
    });
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`${failed.at(-1)?.name === name ? "FAIL" : "ok  "}  ${secs}s`);
  if (BAIL && failed.length) break;
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n${scripts.length - failed.length}/${scripts.length} passed in ${mins} min`);
for (const f of failed) {
  console.error(`\nFAIL ${f.name}`);
  for (const l of f.why) console.error("     " + l.trim());
}
process.exit(failed.length ? 1 : 0);
