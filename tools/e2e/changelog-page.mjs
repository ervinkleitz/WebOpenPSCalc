// The changelog is a PAGE of headlines, not a modal of expandable write-ups.
//
// It used to be a modal where each entry was a <details>: a one-line summary you
// opened to get the full explanation. Those explanations are written for whoever
// maintains the fix — which number moved, why, what the source says — so a player
// scanning for "is the thing I reported in yet?" had to open every one of them. And
// a modal is not somewhere you can send someone a link to.
//
// Run: node tools/e2e/changelog-page.mjs [baseUrl]
import { chromium } from "playwright-core";

const URL_BASE = process.argv[2] || "http://localhost:5173/";
let ok = true;
const check = (c, m, saw) => {
  if (!c) { console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`); ok = false; }
  else console.log("ok  " + m);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
// Wide enough that the topbar has not collapsed its buttons into the hamburger.
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1400 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// --- reached the way a player reaches it ------------------------------------
await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.getByRole("button", { name: /^Changelog$/ }).first().click();
await page.waitForTimeout(2500);
check(new URL(page.url()).pathname === "/changelog",
  "the Changelog button goes to /changelog", new URL(page.url()).pathname);

const shape = () => page.evaluate(() => ({
  dates: document.querySelectorAll(".cl-date").length,
  sections: document.querySelectorAll(".cl-section").length,
  lines: document.querySelectorAll(".cl-line").length,
  details: document.querySelectorAll("details").length,
  longest: Math.max(0, ...[...document.querySelectorAll(".cl-line")].map((e) => e.textContent.length)),
}));
const s = await shape();
check(s.lines > 100, `every entry is listed (${s.lines} of them)`, s);
check(s.dates > 10, `grouped by date (${s.dates})`, s);
check(s.details === 0, "and nothing is hidden behind a disclosure", s);
// The whole point: a headline, not a write-up. The longest entry in CHANGELOG.md
// runs to several hundred characters; a headline does not.
check(s.longest > 0 && s.longest < 180,
  `the longest line is a headline, not a paragraph (${s.longest} chars)`, s);

// --- a deep link works, which is why it is a page ---------------------------
{
  const p2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await p2.goto(URL_BASE.replace(/\/$/, "") + "/changelog", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(6000);
  const direct = await p2.evaluate(() => document.querySelectorAll(".cl-line").length);
  check(direct > 100, `/changelog loads directly, not just via the button (${direct} lines)`, direct);
  await p2.context().close();
}

// --- and back again ----------------------------------------------------------
await page.getByRole("link", { name: /Back to the calculator/ }).click();
await page.waitForTimeout(2500);
check(new URL(page.url()).pathname === "/", "the back link returns to the calculator");

check(errors.length === 0, "no page errors", errors);
await browser.close();
console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
