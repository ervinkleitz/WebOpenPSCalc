/**
 * frontend-source.test.js — regression guards for frontend behaviour that has no
 * other test.
 *
 * WHY THIS EXISTS: there is no frontend test runner in this repo, so a UI bug fixed
 * today can silently return tomorrow. These read the React source and assert the
 * fix is still present. That is a weak form of testing — it checks the code says
 * the right thing, not that it does it — so keep each assertion anchored to a
 * specific reported bug and explain the failure mode, or a future refactor will
 * quite reasonably delete it as noise.
 *
 * The precedent is buff-labels.test.js, which parses BuildEditor.tsx for the same
 * reason. Kept OUT of protected-values.test.js on purpose: that file is about the
 * handful of values that decide where money goes and who the site credits, and it
 * stays readable only if it is not also a general dumping ground.
 *
 * If a real frontend test setup ever lands, these should move into it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..", "..");
const FRONTEND = path.join(REPO, "open-ps-calc-frontend", "frontend");
const read = (...p) => fs.readFileSync(path.join(FRONTEND, ...p), "utf8");
const BACKEND = path.join(REPO, "open-ps-calc-backend", "backend");
const readBackend = (...p) => fs.readFileSync(path.join(BACKEND, ...p), "utf8");

// ---------------------------------------------------------------------------
// Per-slot state that must not outlive the item it belongs to
// ---------------------------------------------------------------------------
test("changing or removing a weapon clears that slot's forge data", () => {
  // Forge (Star Crumbs / element / ranked) is stored per SLOT but describes a
  // SPECIFIC weapon. Left behind on a swap it makes the next weapon read as forged,
  // which hides its card slots entirely — and if that weapon is not forgeable, the
  // forge controls are hidden too, so there is no way to clear it from the UI.
  // A player hit exactly this: a shared build with a forged Damascus, switched to a
  // Main Gauche, and no card slots ever appeared.
  const src = read("src", "pages", "BuildEditor.tsx");

  const onSelect = src.slice(src.indexOf("onSelect={(r) => {"));
  assert.ok(/delete next\.forge\[slot\.key\]/.test(onSelect.slice(0, 1600)),
    "the item picker must drop the slot's forge data when the equipped item changes");

  const unequip = src.slice(src.indexOf("next.equipped[slot.key] = null;"));
  assert.ok(/delete next\.forge\[slot\.key\]/.test(unequip.slice(0, 700)),
    "Unequip must drop the slot's forge data too, or the next weapon inherits it");
});

test("a saved build keeps its own name, on save and on load", () => {
  // The editor's `currentState` is snapshotted BEFORE `onSave` pushes the new name
  // into `data`, so saving it verbatim stored the previous name inside the state while
  // the list entry got the typed one. A build saved once from a fresh editor then
  // loaded back as "New Build"; re-saving hid it, so only save-once builds broke.
  const src = read("src", "components", "SavedBuildsModal.tsx");

  assert.ok(/saveBuild\(\s*name\s*,\s*\{[^)]*build:\s*\{[^)]*name\s*\}/s.test(src),
    "saveBuild must persist the state with the typed name baked into build.name");

  // Loading must trust the entry's name, which also repairs builds saved before the
  // fix — otherwise those stay wrong forever in the user's browser.
  assert.ok(/onLoad\(\s*\{[^)]*b\.state[^)]*name:\s*b\.name/s.test(src),
    "Load must override build.name with the saved entry's name");
});

// ---------------------------------------------------------------------------
// Picker affordances
// ---------------------------------------------------------------------------
test("the item picker marks forgeable weapons", () => {
  // Whether a weapon can be Blacksmith-forged is otherwise invisible until after you
  // equip it, so the badge saves picking a weapon just to find out. Both weapon
  // searches carry it — the main slot picker and the off-hand one, which lists
  // shields and weapons together (shields are never forgeable and stay unmarked).
  const editor = read("src", "pages", "BuildEditor.tsx");
  const badged = [...editor.matchAll(/FORGEABLE_WEAPON_IDS\.has\(it\.id\)[\s\S]{0,120}?badge:\s*"Forgeable"/g)];
  assert.equal(badged.length, 2,
    "both the main-slot and off-hand weapon searches should badge forgeable weapons");

  // The picker must stay generic — it renders whatever `badge` it is handed and
  // knows nothing about forging, so the same mechanism can mark anything later.
  const picker = read("src", "components", "SearchPicker.tsx");
  assert.ok(/r\.badge/.test(picker), "SearchPicker must render the result's badge");
  assert.ok(!/FORGE/i.test(picker), "SearchPicker must not learn about forging specifically");

  // And it needs a style, or it renders as unstyled text in the middle of the row.
  const css = read("src", "styles.css");
  assert.ok(/\.search-result-badge\s*\{/.test(css), "the badge needs its own style rule");
});

// ---------------------------------------------------------------------------
// The forgeable list is duplicated across the stack and must not drift
// ---------------------------------------------------------------------------
test("the frontend and backend agree on which weapons are forgeable", () => {
  // BuildEditor.tsx carries a copy so the picker can badge without a round-trip, and
  // its own comment says "Keep in sync with FORGEABLE_WEAPON_IDS in backend
  // buildManager.js." Drift would mean the UI offers forging the engine won't price,
  // or badges a weapon that cannot actually be forged.
  const ids = (src) => {
    const m = src.match(/FORGEABLE_WEAPON_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m, "FORGEABLE_WEAPON_IDS must stay a literal Set so both sides can be compared");
    return new Set((m[1].match(/\d+/g) || []).map(Number));
  };
  const fe = ids(read("src", "pages", "BuildEditor.tsx"));
  const be = ids(fs.readFileSync(
    path.join(REPO, "open-ps-calc-backend", "backend", "src", "engine", "buildManager.js"), "utf8"));

  const onlyFe = [...fe].filter((x) => !be.has(x));
  const onlyBe = [...be].filter((x) => !fe.has(x));
  assert.deepEqual(onlyFe, [], "ids the frontend thinks are forgeable but the engine does not");
  assert.deepEqual(onlyBe, [], "ids the engine forges but the picker will not badge");
  assert.ok(fe.size > 0);
});

// ---------------------------------------------------------------------------
// Equipped items are titled the way the game titles them
// ---------------------------------------------------------------------------
test("the card name table is present and the words are the client's", () => {
  // The words come from the RO client's cardprefixnametable, fetched by
  // tools/gen-card-names.mjs — they are not in Hercules, not in the PS item API and
  // not in our own item DB, so if the generated file goes missing there is no other
  // source to fall back on and every slotted item silently loses its name.
  const { cardNameFragment } = require("../src/engine/cardNames");

  // The reported example: 2x Skel Worker + 1x Hydra in a Gladius.
  assert.deepEqual(cardNameFragment(4092), { name: "Boned", after: false }, "Skel Worker");
  assert.deepEqual(cardNameFragment(4035), { name: "Bloody", after: false }, "Hydra");

  // A SUFFIX card. Dropping the postfix table does not merely lose a word — it
  // renders "of Champion Cotton Shirt".
  assert.deepEqual(cardNameFragment(4014), { name: "of Champion", after: true }, "Roda Frog");

  // Anything with no entry contributes no word, which is what the client does with a
  // card it does not know — every PS custom lands here.
  assert.equal(cardNameFragment(999999), null);

  const { CARD_NAMES } = require("../src/engine/cardNames");
  assert.ok(Object.keys(CARD_NAMES).length > 900,
    `expected the full table, found ${Object.keys(CARD_NAMES).length} cards`);
});

test("PS card names apply to PS only, and cover the customs", () => {
  // Two tables: the official client's (vanilla words) and Payon Stories' own published
  // one. PS covers their customs, which the client knows nothing about, AND overrides a
  // handful of vanilla cards they have reworked. That override must NOT leak onto the
  // vanilla profile — a PS rework is not a vanilla fact.
  const { cardNameFragment, PS_NAMES, CLIENT_NAMES } = require("../src/engine/cardNames");

  // A PS custom: named on PS, absent from the client entirely.
  assert.deepEqual(cardNameFragment(8244, "payon_stories"),
    { name: "of Sanctuary", after: true }, "Moon Rabbit on PS");
  assert.equal(cardNameFragment(8244, "standard"), null,
    "a PS custom must not be named on the vanilla profile");

  // The three reworked vanilla cards found when the PS table first landed. Each is a
  // real divergence, not a parse artefact, so each is pinned on BOTH profiles.
  const SPLIT = {
    4223: [{ name: "of Sturdiness", after: true }, { name: "Resist Stun", after: false }],
    4261: [{ name: "Smoldering", after: false }, { name: "Bleeding Guard", after: false }],
    4336: [{ name: "Cracking", after: false }, { name: "of Vitality", after: true }],
  };
  for (const [id, [ps, vanilla]] of Object.entries(SPLIT)) {
    assert.deepEqual(cardNameFragment(Number(id), "payon_stories"), ps, `${id} on PS`);
    assert.deepEqual(cardNameFragment(Number(id), "standard"), vanilla, `${id} on vanilla`);
  }

  // The parse reads the right columns. These three were collected by hand off the items
  // in game BEFORE the table was found, and matched it exactly — the only independent
  // check available that prefix and suffix are not swapped.
  assert.deepEqual(cardNameFragment(8218), { name: "of Transfusion", after: true });
  assert.deepEqual(cardNameFragment(8239), { name: "Magic Missile", after: false });

  assert.ok(Object.keys(PS_NAMES).length > 900,
    `the PS table looks truncated: ${Object.keys(PS_NAMES).length} cards`);
  assert.ok(Object.keys(CLIENT_NAMES).length > 900, "the client table looks truncated");

  // Defaulting matters: every existing caller omits the server and means PS.
  assert.deepEqual(cardNameFragment(8244), cardNameFragment(8244, "payon_stories"),
    "cardNameFragment must default to the PS table");
});

test("the editor titles an equipped item through the shared helper", () => {
  // The pill used to be built inline as `{item.name}{" +" + refine}` — "Gladius +7",
  // which matches nothing a player sees in their own inventory. The order (refine
  // first, cards before the name) and the Double/Triple collapsing live in
  // lib/itemName.ts; this catches a revert to inline string building.
  const src = read("src", "pages", "BuildEditor.tsx");
  assert.ok(/import \{ displayItemName \} from "\.\.\/lib\/itemName"/.test(src),
    "BuildEditor no longer imports displayItemName");
  assert.ok(/displayItemName\(/.test(src), "the equipment pill no longer calls displayItemName");
  assert.ok(!/\$\{isRefineable \? ` \+\$\{data\.refine/.test(src),
    "the old appended-refine string is back — refine leads the name now");

  // The helper's own contract, asserted on its source for the same reason the rest of
  // this file does: there is no frontend test runner. Behaviour is covered live by
  // tools/e2e/equip-item-naming.mjs.
  const lib = read("src", "lib", "itemName.ts");
  assert.ok(/"", "Double ", "Triple ", "Quadruple "/.test(lib),
    "the count words must stay the client's set, in order");
  assert.ok(/card_name_after \? after : before/.test(lib),
    "suffix cards must still be routed after the item name");
});

// ---------------------------------------------------------------------------
// What the browser is allowed to decide for itself
// ---------------------------------------------------------------------------
test("the page declares its colour scheme and styles its own selection", () => {
  // Reported by two players comparing browsers (Sandrea on Firefox, Noobitaa on Brave,
  // 2026-10-14): "the selection looks weird in dark mode", and it looked different to
  // each of them. Two causes, both "we left it to the browser":
  //
  //   1. ::selection was never styled, so each engine used its own default. Chromium
  //      paints a solid blue block, which swallows the accent and link colours in the
  //      features list; Firefox picks something else.
  //   2. color-scheme was declared only on `select`, never on the page, so a browser in
  //      forced-dark ("dark mode" in Brave/Edge, an add-on in Firefox) was free to
  //      second-guess an already-dark palette.
  const css = read("src", "styles.css");

  // BOTH schemes on BOTH themes, preferred one first. Listing only the active scheme
  // is not enough and the light theme proves it: Chromium skips auto-darkening a page
  // whose color-scheme includes `dark`, so `color-scheme: light` alone was an invitation
  // — a browser in forced dark re-inverted 99% of the light theme's pixels (measured).
  assert.ok(/:root\s*\{[^}]*color-scheme:\s*dark\s+light\s*;/s.test(css),
    "the page must declare `color-scheme: dark light` — dark first for its own "
    + "preference, light listed so forced-dark browsers leave the page alone");
  assert.ok(/\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light\s+dark\s*;/s.test(css),
    "the light theme must declare `color-scheme: light dark`. With `light` alone a "
    + "browser in forced dark re-inverts the whole theme.");

  assert.ok(/::selection\s*\{[^}]*background:/.test(css), "::selection is unstyled again");
  assert.ok(/::-moz-selection\s*\{[^}]*background:/.test(css), "::-moz-selection is gone");

  // The reason they are two rules. A selector LIST containing a pseudo-element the
  // engine does not recognise invalidates the whole rule, so "::selection,
  // ::-moz-selection { ... }" silently styles nothing in one browser or the other —
  // which is precisely the cross-browser inconsistency this fixed.
  assert.ok(!/::selection\s*,|,\s*::-moz-selection/.test(css),
    "::selection and ::-moz-selection must stay SEPARATE rules — combining them into "
    + "one selector list makes a browser that does not know one of them drop both");
});

// ---------------------------------------------------------------------------
// Every custom property referenced must actually exist
// ---------------------------------------------------------------------------
test("no CSS variable is referenced that is never defined", () => {
  // This exact mistake shipped twice in one week, and both times it was invisible in
  // review because the CSS looks perfectly reasonable:
  //
  //   .refine-select option { background: var(--panel); color: var(--text); }
  //     There is no --panel token. The background was dropped as invalid while the
  //     colour applied, giving near-white text on the browser's white dropdown — the
  //     refine numbers a player screenshotted as unreadable.
  //
  //   color: var(--text-muted, #888)
  //     No --text-muted either, so all four of these silently used the #888 fallback:
  //     a fixed grey that cannot respond to the theme at all.
  //
  // A var() naming something undefined does not warn, it just quietly does nothing (or
  // takes a fallback that nobody tuned). That is exactly the kind of thing a test is
  // for and a reader is not.
  // Comments are stripped first: this very test's own comment names var(--panel) as the
  // example, and a mention in prose is not a reference.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const css = strip(read("src", "styles.css"));
  const editor = strip(read("src", "pages", "BuildEditor.tsx"));

  // Everything the stylesheet DEFINES, anywhere — :root, a theme block, a component.
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

  // Properties the browser defines itself, which are legitimately referenced undefined.
  const BUILT_IN = new Set();

  const missing = new Map();
  for (const [src, label] of [[css, "styles.css"], [editor, "BuildEditor.tsx"]]) {
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
      const [, name, next] = m;
      if (defined.has(name) || BUILT_IN.has(name)) continue;
      const key = `${name} (${label}${next === "," ? ", has a fallback" : ""})`;
      missing.set(key, (missing.get(key) || 0) + 1);
    }
  }
  assert.deepEqual([...missing.keys()].sort(), [],
    "these var() references name a custom property that is defined nowhere. Either "
    + "define it, or use the token that was meant. A fallback is not an excuse: it is "
    + "a hard-coded value that no theme can reach.");
});

// ---------------------------------------------------------------------------
// CHANGELOG structure
// ---------------------------------------------------------------------------
test("CHANGELOG.md is well formed", () => {
  // I have broken this file three ways while working on it: filing four days of
  // entries under one stale date heading, doubling the blank line between every
  // inserted entry, and leaving an empty orphaned heading behind after repairing the
  // first two. It is edited by script often enough that "read it and see" is not a
  // real check, so the shape is asserted here instead.
  const text = fs.readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");
  const lines = text.split("\n");

  const dates = lines.filter((l) => /^## \d{4}-\d{2}-\d{2}$/.test(l)).map((l) => l.slice(3));

  // One heading per date.
  const dupes = dates.filter((d, i) => dates.indexOf(d) !== i);
  assert.deepEqual([...new Set(dupes)], [], "a date has more than one heading");

  // Newest first, so the top of the file is the most recent work.
  assert.deepEqual(dates, [...dates].sort().reverse(), "date headings are out of order");

  // No empty section — a heading immediately followed by another heading is the
  // orphan left behind by a bad slice.
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^## \d{4}-\d{2}-\d{2}$/.test(lines[i])) continue;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    assert.ok(next && !next.startsWith("## "),
      `${lines[i]} has no content — orphaned heading`);
  }

  // One Added/Changed/Fixed per date, and nothing else.
  let current = null;
  const seen = new Map();
  for (const l of lines) {
    const d = l.match(/^## (\d{4}-\d{2}-\d{2})$/);
    if (d) { current = d[1]; seen.set(current, []); continue; }
    const h = l.match(/^### (.+)$/);
    if (h && current) {
      // The Keep a Changelog set. Added/Changed/Fixed carry almost everything here;
      // the rest are allowed so a legitimate section is never a test failure.
      assert.ok(["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"].includes(h[1]),
        `${current}: unexpected section "${h[1]}"`);
      assert.ok(!seen.get(current).includes(h[1]),
        `${current} has a second "### ${h[1]}" — merge them`);
      seen.get(current).push(h[1]);
    }
  }

  // Single blank line between entries.
  let run = 0;
  lines.forEach((l, i) => {
    run = l.trim() === "" ? run + 1 : 0;
    assert.ok(run < 2, `line ${i + 1}: ${run} consecutive blank lines`);
  });
});

// ---------------------------------------------------------------------------
// Every path that hydrates the editor must default the same fields
// ---------------------------------------------------------------------------
test("mount and load hydrate editor state through the same helper", () => {
  // These two paths drifted, and the drift crashed the app. Mount defaulted all
  // five state fields with ??; onLoadSavedState defaulted only targetMods. A saved
  // build with no customTarget therefore set it to undefined, and customTarget.element
  // is read inside a useMemo DEPENDENCY ARRAY (signumApplicable) — evaluated on every
  // render, before any guard — so React threw. There is no error boundary, so the whole
  // app unmounted to a blank page and the Load button looked like it did nothing.
  //
  // The fix is one shared hydrateState(); this keeps it shared.
  const src = read("src", "pages", "BuildEditor.tsx");

  const helper = src.match(/function hydrateState\(([^)]*)\)[^{]*{([\s\S]*?)\n}/);
  assert.ok(helper, "hydrateState() is gone — the two hydration paths can drift again");
  for (const field of ["build", "skill", "targetMode", "customTarget", "targetMods"]) {
    assert.ok(helper[2].includes(field + ":"),
      `hydrateState does not default "${field}"`);
  }

  // The load path must delegate rather than assign the incoming state directly.
  const load = src.match(/function onLoadSavedState\([^)]*\)[^{]*{([\s\S]*?)\n  }/);
  assert.ok(load, "onLoadSavedState not found");
  assert.ok(/hydrateState\(/.test(load[1]),
    "onLoadSavedState no longer routes through hydrateState");
  const raw = load[1].match(/set\w+\(state\.\w+/g) || [];
  assert.deepEqual(raw, [],
    "onLoadSavedState assigns saved state straight into React state, skipping the defaults");

  // ...and so must loading a pinned build. Pins are JSON round-tripped snapshots
  // taken by whatever version of the editor was running at the time, so they are
  // exactly as untrustworthy as a saved build.
  const pin = src.match(/const handleLoadPin = useCallback\(\(pin[^)]*\) => {([\s\S]*?)\n  }, \[\]\);/);
  assert.ok(pin, "handleLoadPin not found");
  assert.ok(/hydrateState\(/.test(pin[1]),
    "handleLoadPin no longer routes through hydrateState");

  // Which slots are in wildcard mix is READ OFF the build, not tracked beside it.
  //
  // It used to live in its own useState, which every path that swapped the build had
  // to remember to re-sync; loading a saved build and loading a pinned build both
  // forgot, and the previous build's wildcard flags kept pricing cards the new build
  // did not have equipped. This asserted that both paths called setWildcardMode.
  //
  // Deriving it removes the chance to forget, so the guarantee is now stronger: there
  // is no separate state to drift. Assert THAT instead — re-introducing the state is
  // what would bring the bug back.
  assert.ok(/function deriveWildcardMode\(/.test(src), "deriveWildcardMode() is gone");
  assert.ok(/const wildcardMode = useMemo\(\(\) => deriveWildcardMode\(data\), \[data\]\);/.test(src),
    "wildcardMode is no longer derived from the build on every render");
  assert.ok(!/setWildcardMode/.test(src),
    "wildcardMode is held in separate state again — every build swap must now remember "
    + "to re-sync it, which is exactly how stale wildcard slots priced a loaded build");

  // ...and the choice itself is STORED, so it survives a share link, a save and a pin.
  // Inferring it from wildcard_slots cannot represent the ordinary case: switching to
  // a wildcard mix leaves the real cards equipped so switching back restores them, and
  // a slot with real cards reads as "not in wildcard mode" — so a build shared or
  // saved mid-experiment came back with the cards, worth 100 HIT on a Phreeoni Card.
  assert.ok(/wildcard_mode/.test(src),
    "build.wildcard_mode is gone — wildcard mix will not survive a share link or a save");
  const z3 = src.match(/const Z3_KEYS: string\[\] = \[([\s\S]*?)\n\];/);
  assert.ok(z3 && /"wildcard_mode"/.test(z3[1]),
    "wildcard_mode is not in Z3_KEYS, so share links cannot carry it");
});

// ---------------------------------------------------------------------------
// A render crash must not blank the page
// ---------------------------------------------------------------------------
test("the app is wrapped in an error boundary", () => {
  // Without one, any throw during render unmounts the whole tree to a white page,
  // which is how a missing field in a saved build reached players as "the Load
  // button does nothing" - no message, no stack, nothing to report.
  const boundary = read("src", "components", "ErrorBoundary.tsx");
  assert.ok(/getDerivedStateFromError/.test(boundary), "no getDerivedStateFromError");
  assert.ok(/componentDidCatch/.test(boundary), "no componentDidCatch");

  const app = read("src", "App.tsx");
  assert.ok(/<ErrorBoundary>/.test(app), "App does not mount the ErrorBoundary");
  const inside = app.slice(app.indexOf("<ErrorBoundary>"), app.indexOf("</ErrorBoundary>"));
  assert.ok(/<Routes>/.test(inside), "the routes are not inside the boundary");
});

// ---------------------------------------------------------------------------
// CHANGELOG must stay inside what the modal can render
// ---------------------------------------------------------------------------
test("CHANGELOG.md uses only markup the changelog modal renders", () => {
  // The file is prose I edit constantly and the modal is a ~40-line hand-rolled
  // markdown parser, so the failure mode is not a broken build - it is an entry
  // that silently renders wrong in the app while every other test passes. It has
  // happened: a bullet whose trailing paragraph sat after a blank line spilled out
  // of its own entry and rendered one <p> per source line, hard-wrapped
  // mid-sentence, across 72 lines and 8 entries before a player screenshotted it.
  //
  // So this pins the grammar the modal actually implements. Inside a dated section
  // every line must be one of:
  //   ""                      blank
  //   "### Section"           Added / Changed / Fixed ...
  //   "- text"                a top-level entry
  //   "  text"                a continuation, indented in multiples of two
  // Anything else - a bare paragraph at column 0, a table, a code fence, a deeper
  // heading - hits the modal's fallback branch and renders outside its entry.
  const text = fs.readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");
  const lines = text.split("\n");

  const firstDate = lines.findIndex((l) => /^## \d{4}-\d{2}-\d{2}$/.test(l));
  assert.ok(firstDate > 0, "no dated section found");

  const bad = [];
  for (let i = firstDate; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (/^## \d{4}-\d{2}-\d{2}$/.test(l)) continue;
    if (/^### \S/.test(l)) continue;
    if (/^- \S/.test(l)) continue;
    if (/^ +\S/.test(l)) {
      const indent = l.length - l.trimStart().length;
      if (indent % 2 !== 0) bad.push([i + 1, l, `indent of ${indent} is not a multiple of two`]);
      continue;
    }
    bad.push([i + 1, l, "renders as a loose paragraph outside its entry"]);
  }
  assert.deepEqual(
    bad.map(([n, l, why]) => `line ${n}: ${why} -> ${l.slice(0, 60)}`), [],
  );

  // A tab indents by one character as far as slice(2) is concerned, so it
  // silently eats the first letter of the line.
  const tabbed = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /^\t/.test(l));
  assert.deepEqual(tabbed, [], "tab-indented lines - the modal dedents by two spaces");

  // A continuation separated from its bullet by a blank line only stays in the
  // entry because the modal looks past the blank; a blank line followed by an
  // UNINDENTED paragraph is the shape that used to spill.
  for (let i = firstDate; i < lines.length - 2; i++) {
    if (!/^- \S|^ +\S/.test(lines[i])) continue;
    if (lines[i + 1].trim() !== "") continue;
    const after = lines[i + 2];
    assert.ok(
      after.trim() === "" || /^#{2,3} |^- \S|^ +\S/.test(after),
      `line ${i + 3}: paragraph after a blank line inside an entry, unindented -> ${after.slice(0, 60)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The changelog page shows headlines only
// ---------------------------------------------------------------------------
test("the changelog page renders one line per entry, not the write-ups", () => {
  // It used to be a modal where each entry was a <details> you expanded into the
  // full explanation. Those explanations are written for whoever maintains the fix —
  // which number moved and why — and a player scanning for "is my report in yet?"
  // had to open every one. It is a page now, at /changelog, showing the bold lead of
  // each entry and nothing else.
  //
  // This pins the two things that would quietly undo that: rendering an entry's
  // continuation lines, and going back to a disclosure widget.
  // Comments stripped first: this page's own comment explains the <details> it
  // replaced, and a mention in prose is not a disclosure widget. Same trap that the
  // undefined-var test hit.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const src = strip(read("src", "pages", "ChangelogPage.tsx"));

  assert.ok(/headline\(/.test(src), "the page no longer reduces an entry to its headline");
  assert.ok(!/<details/.test(src),
    "the changelog is a list of headlines, not expandable entries — if the detail is "
    + "wanted back, it belongs on its own route, not behind a disclosure on this one");

  // The parser's whole vocabulary is three line shapes. Anything else in the file is
  // an entry's continuation, and continuations are exactly what this page omits.
  for (const shape of ["^## ", "^### ", "^- "]) {
    assert.ok(src.includes(shape), `the page must still recognise ${shape} lines`);
  }

  // And it has to be reachable, or it is a page nobody can get to.
  const app = read("src", "App.tsx");
  assert.ok(/path="\/changelog"/.test(app), "no /changelog route");
  const editor = read("src", "pages", "BuildEditor.tsx");
  assert.ok(/navigate\("\/changelog"\)/.test(editor),
    "the Changelog button must navigate to the page");
  assert.ok(!/ChangelogModal/.test(editor), "the old modal is still mounted");
});

// ---------------------------------------------------------------------------
// Hand-authored items must carry the text that explains them
// ---------------------------------------------------------------------------
test("every hand-authored item has a description", () => {
  // ps_item_manual entries are written by hand, and it is easy to add a `script`
  // (which changes damage, so it gets tested) while forgetting `description` (which
  // only shows on hover, so nothing notices). The result is an item whose effects all
  // work and whose tooltip is blank — reported twice by players, on Rust-Worn
  // Apparatus and then Giant Pestle, before this guard existed.
  const { loader } = require("../src/engine/dataLoader");
  const { getProfile } = require("../src/engine/serverProfiles");
  loader.setProfile(getProfile("payon_stories"));

  // Items PS has not published: the item API returns "No data" for both id and name,
  // so there is no source to copy and inventing tooltip copy would be worse than a
  // blank. Re-check the API — it has caught up on other items a day or two post-patch.
  const NO_SOURCE = new Set(["8324"]);

  const man = JSON.parse(fs.readFileSync(
    path.join(REPO, "open-ps-calc-backend", "backend", "src", "engine", "data", "ps",
              "ps_item_manual.json"), "utf8"));

  const missing = Object.keys(man)
    .filter((id) => /^\d+$/.test(id) && !NO_SOURCE.has(id))
    .filter((id) => {
      const d = loader.getItemDescription(Number(id));
      return !(d && d.description && String(d.description).trim());
    })
    .map((id) => `${id} ${(man[id] || {}).name || "?"}`);

  assert.deepEqual(missing, [],
    "hand-authored items with no tooltip text — copy it from tools.payonstories.com/api/pc/item?id=<id>");
});


// Decrease AGI as a target debuff (2026-09-09 patch-note audit). The mechanism to
// carry it — cut the target's AGI, drop its flee 1:1 — already existed for Quagmire;
// the Acolyte's own version simply had no entry. PS condensed the skill to 5 ranks
// and set the cut to a FLAT 3 per level (wiki Decrease_Agi table: 3/6/9/12/15, and
// the rework PDF agrees). It lives in the TS route with the other target mods, which
// the plain-node engine suite cannot import — hence a source-level assertion, the
// same approach the rest of this file uses.
test("Decrease AGI is applied as a target debuff: flat 3/level, flee 1:1, no bosses", () => {
  const route = readBackend("src", "routes", "calculate.ts");
  const block = route.slice(route.indexOf("targetModsInput.decrease_agi"));
  assert.ok(block.length > 0, "the route must read target_mods.decrease_agi");
  assert.ok(/Math\.min\(5,/.test(block.slice(0, 400)), "capped at the PS max of 5 ranks");
  assert.ok(/3 \* decAgiLv/.test(block.slice(0, 700)), "flat 3 AGI per level");
  assert.ok(/!target\.is_boss/.test(block.slice(0, 700)), "bosses are immune");
  assert.ok(/target\.flee = Math\.max\(0, target\.flee - agiCut\)/.test(block.slice(0, 900)),
    "and the AGI cut must lower flee 1:1, as Quagmire's does");

  // The UI must offer it, or the engine support is unreachable.
  const editor = read("src", "pages", "BuildEditor.tsx");
  assert.ok(/decrease_agi: Number\(e\.target\.value\)/.test(editor), "a control must set it");
  assert.ok(/"decrease_agi"/.test(editor), "and its key must be in the share dictionary");
});


// Rogue Strip debuffs (2026-09-09 patch-note audit). PS Rogue notes: "Strip Weapon:
// -40% ATK; Strip Shield: -30% Hard Defense; Strip Armor: -30% Hard Magic Defense;
// Strip Helm: -40% of Base Intelligence Attribute", with "Individual Strips no
// longer affect Boss-type monsters" (wiki Strip_Shield: "Decreases the hard DEF of a
// target by 30%", "Cannot be used on MvPs"). All four were entirely unmodelled —
// Strip Shield alone is a large physical-damage swing on a DEF-heavy target.
test("Rogue Strips are modelled: DEF/MDEF outgoing, ATK/INT incoming, never on bosses", () => {
  const route = readBackend("src", "routes", "calculate.ts");

  // Offensive pair: they cut what the TARGET resists with.
  const out = route.slice(route.indexOf("targetModsInput.strip_shield"));
  assert.ok(/def_percent[^;]*- 30/.test(out.slice(0, 400)), "Strip Shield: -30% hard DEF");
  assert.ok(/mdef_percent[^;]*- 30/.test(out.slice(0, 600)), "Strip Armor: -30% hard MDEF");
  const guard = route.slice(Math.max(0, route.indexOf("targetModsInput.strip_shield") - 300),
    route.indexOf("targetModsInput.strip_shield"));
  assert.ok(/!target\.is_boss/.test(guard), "and both are gated on the target not being a boss");

  // Defensive pair: they cut what the MONSTER brings, so they ride the incoming opts.
  const inc = route.slice(route.indexOf("stripOpts"));
  assert.ok(/mob_atk_bonus_rate = -40/.test(inc.slice(0, 600)), "Strip Weapon: -40% monster ATK");
  assert.ok(/mob_int_bonus_rate = -40/.test(inc.slice(0, 600)), "Strip Helm: -40% monster INT");
  assert.ok(/is_boss/.test(inc.slice(0, 600)), "and these are boss-gated too");

  // Reachable from the UI, and shareable.
  const editor = read("src", "pages", "BuildEditor.tsx");
  for (const key of ["strip_shield", "strip_armor", "strip_weapon", "strip_helm"]) {
    assert.ok(new RegExp(`"${key}"`).test(editor), `${key} must be offered and in the share dictionary`);
  }
});

// ---------------------------------------------------------------------------
// Every self-buff toggle must have a known source skill, or be deliberately
// exempt. A PS planner import sets the rank a buff switches on at, via
// known_buff_levels keyed by status change — so a buff whose SC nothing maps to
// silently falls back to its MAX, which is the bug this whole thing fixes.
//
// This fails when someone adds a SELF_BUFFS entry without deciding how its rank
// is resolved, rather than letting it quietly default.
// ---------------------------------------------------------------------------
test("every self-buff resolves to a skill, or is a documented exception", () => {
  const src = read("src", "pages", "BuildEditor.tsx");
  const start = src.indexOf("const SELF_BUFFS = [");
  const end = src.indexOf("const PARTY_BUFFS = [");
  assert.ok(start > 0 && end > start, "could not find the SELF_BUFFS table");
  // Party buffs and songs come from OTHER players, so your own rank is irrelevant
  // to them — only the self-cast table is in scope here.
  const keys = [...new Set([...src.slice(start, end).matchAll(/key:\s*"(SC_[A-Z0-9_]+)"/g)].map((m) => m[1]))];
  assert.ok(keys.length > 15, `expected the self-buff table, found ${keys.length} keys`);

  const { loader } = require("../src/engine/dataLoader");
  const { getProfile } = require("../src/engine/serverProfiles");
  loader.setProfile(getProfile("payon_stories"));
  const { SC_SOURCE_SKILL } = require("../src/engine/psToolsImport");

  const declared = new Set();
  for (const sk of loader.getAllSkills()) {
    for (const sc of [].concat(sk.status_change || [])) if (sc) declared.add(sc);
  }

  // No learnable source on a base or 2nd job — this calculator models no further.
  const EXEMPT = {
    SC_AMPLIFYMAGICPOWER: "a High Wizard skill (maintainer ruling 2026-09-22); trans classes are unmodelled",
    SC_PS_ZENYPINCHER: "a PS-custom passive — it arrives via mastery_levels, not as a toggled rank",
    // The SP bracket selector that rides alongside the Energy Coat toggle, not a buff.
    SC_ENERGYCOAT_sp_pct: "a UI field, not a status change",
  };

  const orphans = keys.filter((k) => !declared.has(k) && !(k in SC_SOURCE_SKILL) && !(k in EXEMPT));
  assert.deepEqual(orphans, [],
    `these self-buffs have no source skill: ${orphans.join(", ")}. Either the skill DB `
    + "declares the status change, or add it to SC_SOURCE_SKILL in psToolsImport.js, or "
    + "document it as exempt here — otherwise an imported character's rank is ignored "
    + "and the buff switches on at its max.");

  // And the exemptions must stay honest: if a skill ever does declare one, the
  // exemption is stale and should go.
  for (const k of Object.keys(EXEMPT)) {
    assert.ok(!declared.has(k),
      `${k} is now declared by a skill — drop it from the exempt list so imports use the real rank`);
  }
});

// A Z3 share code is an INDEX into Z3_KEYS, in base 36. Inserting a key anywhere but
// the end renumbers every key below it, and every share link already in the wild
// decodes into the wrong fields — silently, because the JSON still parses.
//
// This nearly happened on 2026-10-11: the PS-planner-import branch and main had both
// appended to the list while they were apart, and a merge that put the branch's two
// keys above main's would have broken every link made since custom targets shipped.
// The comment in the source says "keep at the end"; this makes it enforceable.
test("Z3 share keys are append-only — the live ones keep their positions", () => {
  const src = fs.readFileSync(path.join(FRONTEND, "src", "pages", "BuildEditor.tsx"), "utf8");
  const block = src.slice(src.indexOf("const Z3_KEYS: string[] = ["), src.indexOf("const Z3_ENC"));
  assert.ok(block.length > 200, "could not find Z3_KEYS");
  const keys = [];
  const CARD_SLOTS = ["right_hand", "left_hand", "head_top", "head_mid", "head_low",
    "armor", "garment", "shoes", "accessory_left", "accessory_right"];
  for (const line of block.split("\n").slice(1)) {
    if (line.includes("...Z3_CARD_SLOTS")) {
      for (const s of CARD_SLOTS) for (const i of [1, 2, 3, 4]) keys.push(`${s}_card${i}`);
      continue;
    }
    for (const m of line.replace(/\/\/.*$/, "").matchAll(/"([^"]+)"/g)) keys.push(m[1]);
  }

  // A sample of keys at known positions, taken from the deployed list. Each one is
  // from a different era of the file, so an insert anywhere trips at least one.
  const ANCHORS = {
    build: 0, job_id: 6, right_hand_card1: 71, forge: 111,
    SC_ENERGYCOAT: 131, wildcard_mode: 133, manual: 137, pct: 150,
  };
  for (const [key, index] of Object.entries(ANCHORS)) {
    assert.equal(keys[index], key,
      `Z3 key ${index} must stay "${key}" — it is "${keys[index]}". A key was inserted or `
      + "removed above it, which renumbers every share link already in the wild.");
  }
  // And new work goes strictly after them.
  assert.ok(keys.indexOf("known_skill_levels") > ANCHORS.pct, "the newest keys append last");
  assert.equal(new Set(keys).size, keys.length, "a duplicate key would shadow the first one's code");
});
