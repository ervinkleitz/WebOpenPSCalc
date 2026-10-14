#!/usr/bin/env node
/**
 * gen-card-names.mjs — build card_names.json from the RO client's own name tables.
 *
 * WHY THIS EXISTS: a slotted item's displayed name ("+7 Double Boned Bloody Gladius")
 * is assembled by the CLIENT, not the server. Neither Hercules, nor the Payon Stories
 * item API, nor our own item DB carries the per-card name fragment — it lives in two
 * client data files, keyed by card id:
 *
 *   cardprefixnametable.txt   4035#Bloody#        the fragment itself, for every card
 *   cardpostfixnametable.txt  4014#              ids whose fragment goes AFTER the name
 *
 * The second file is a LIST, not a map: an id appearing there means "this fragment is a
 * suffix". Its fragment still comes from the first file ("of Champion"), which is why
 * ignoring the postfix table does not merely drop a word — it renders
 * "of Champion Gladius".
 *
 * SOURCE: zackdreaver/ROenglishRE, the English client translation project. These are
 * the official client's tables, not a community reconstruction. Pinned to a commit
 * below so a re-run reproduces the same file; bump it deliberately.
 *
 * This is not PS data and PS does not override it — card ids are vanilla and these are
 * display names, which no server-side rework touches. PS's own custom cards simply have
 * no entry, and an item with no entry contributes no word to the name, which is exactly
 * what the client does.
 *
 * Run: node tools/gen-card-names.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "open-ps-calc-backend", "backend", "src",
  "engine", "data", "card_names.json");

// A COMMIT, not a branch: "master" would have made this say "pinned" while quietly
// re-reading whatever upstream looks like on the day it is run. Bump it deliberately
// when you want new cards, and the regenerated JSON shows up as a reviewable diff.
// 2019-10-10, head of master at the time this landed.
const REF = "c940bca97de8e91470de8809d6ae3b658b1e0cdd";
const BASE = `https://raw.githubusercontent.com/zackdreaver/ROenglishRE/${REF}/Ragnarok/data/`;

const fetchText = async (file) => {
  const r = await fetch(BASE + file);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.text();
};

// Both files are "id#value#" with // comments and blank lines. The prefix table's value
// is the fragment; the postfix table's is empty — presence is the whole signal.
const parseIds = (text) => {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const m = line.match(/^(\d+)#([^#]*)#?$/);
    if (!m) continue;
    out.set(Number(m[1]), m[2].trim());
  }
  return out;
};

const [prefixText, postfixText] = await Promise.all([
  fetchText("cardprefixnametable.txt"),
  fetchText("cardpostfixnametable.txt"),
]);

const fragments = parseIds(prefixText);
const after = new Set(parseIds(postfixText).keys());

const data = {};
for (const [id, name] of [...fragments].sort((a, b) => a[0] - b[0])) {
  if (!name) continue;                       // an id with no fragment adds no word
  data[id] = after.has(id) ? { n: name, after: true } : { n: name };
}

const suffixes = Object.values(data).filter((d) => d.after).length;
fs.writeFileSync(OUT, JSON.stringify({
  _source: "zackdreaver/ROenglishRE Ragnarok/data/card{prefix,postfix}nametable.txt",
  _ref: REF,
  _generated_by: "tools/gen-card-names.mjs",
  _note: "Client-side display names. n = word; after = true means it follows the item name.",
  cards: data,
}, null, 1) + "\n");

console.log(`card_names.json: ${Object.keys(data).length} cards (${suffixes} suffixes)`);
for (const id of [4035, 4092, 4014]) {
  console.log(`  ${id}: ${JSON.stringify(data[id] ?? null)}`);
}
