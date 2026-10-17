// The changelog is a generated static HTML page, not an app route.
//
// It was a modal of expandable write-ups, then an SPA route showing headlines, and
// is now public/changelog.html — produced by scripts/gen-guides.mjs from the same
// CHANGELOG.md, like the guides. The point of that last move is that THE TEXT IS IN
// THE RESPONSE, so this checks it with a plain fetch rather than a rendered page: a
// rendered page cannot tell you whether a crawler would have seen anything.
//
// Run: node tools/e2e/changelog-page.mjs [baseUrl]
import { chromium } from "playwright-core";

const URL_BASE = (process.argv[2] || "http://localhost:5173/").replace(/\/$/, "");
let ok = true;
const check = (c, m, saw) => {
  if (!c) {
    console.error(`FAIL: ${m}${saw !== undefined ? `\n      saw: ${JSON.stringify(saw)}` : ""}`);
    ok = false;
  } else console.log("ok  " + m);
};

// --- the part that matters for SEO: raw HTML, no JavaScript -----------------
{
  const res = await fetch(`${URL_BASE}/changelog.html`);
  const html = await res.text();
  check(res.ok, `/changelog.html is served (HTTP ${res.status})`, res.status);

  const entries = (html.match(/<li>/g) || []).length;
  const dates = (html.match(/<h2>/g) || []).length;
  check(entries > 100, `the entries are in the HTML itself (${entries} <li>)`, entries);
  check(dates > 10, `grouped into dated sections (${dates} <h2>)`, dates);
  check(html.includes("<h1>Changelog</h1>"), "with an h1");
  check(html.includes('rel="canonical" href="https://openpscalc.com/changelog.html"'),
    "and a canonical url");
  check(/<meta name="description" content="[^"]{60,}"/.test(html), "and a real description");
  check(html.includes("application/ld+json"), "and structured data");

  // The whole reason for the move: this has to hold with scripts off.
  check(!html.includes('<div id="root"></div>'),
    "the page is not the empty SPA shell", html.slice(0, 160));
}

// --- and it is in the sitemap, dated from CHANGELOG.md ----------------------
{
  const res = await fetch(`${URL_BASE}/sitemap.xml`);
  const xml = await res.text();
  check(xml.includes("changelog.html"), "the sitemap lists it");
  const m = xml.match(/changelog\.html<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/);
  check(!!m, `with a lastmod taken from the newest entry${m ? ` (${m[1]})` : ""}`, m && m[1]);
}

// --- reachable from the app, as a real link ---------------------------------
{
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL_BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);

  const link = page.getByRole("link", { name: /^Changelog$/ }).first();
  check(await link.count() > 0, "the menu item is a link, not a button");
  const href = await link.getAttribute("href");
  check(href === "/changelog.html", "pointing at the static page", href);

  await link.click();
  await page.waitForTimeout(3000);
  check(new URL(page.url()).pathname === "/changelog.html",
    "and clicking it lands there", new URL(page.url()).pathname);
  check(await page.locator("li").count() > 100, "which renders the entries");
  check(errors.length === 0, "no page errors", errors);
  await browser.close();
}

console.log(ok ? "\nPASS" : "\nsee failures above");
process.exit(ok ? 0 : 1);
