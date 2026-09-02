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
// The modal has to keep implementing that grammar
// ---------------------------------------------------------------------------
test("the changelog modal still handles continuations and nested bullets", () => {
  // The test above says the file stays inside the grammar; this one says the
  // parser still implements it. Both halves have to hold - the mangling that
  // prompted these came from the parser lacking the two branches below while the
  // markdown used them freely.
  const src = fs.readFileSync(
    path.join(FRONTEND, "src", "components", "ChangelogModal.tsx"), "utf8");

  assert.ok(/next\.trim\(\) === ""/.test(src),
    "modal no longer looks past a blank line - trailing paragraphs will spill out of their entry");
  assert.ok(/kind: "ul"/.test(src),
    "modal no longer builds nested lists - sub-bullets will flatten into the parent as literal '- ' text");
  assert.ok(/<em /.test(src),
    "modal no longer renders italics - *asterisks* will show literally");
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
