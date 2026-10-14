#!/usr/bin/env node
/**
 * gen-ps-card-names.mjs — Payon Stories' own card prefix/suffix table.
 *
 * WHY THIS EXISTS, separately from gen-card-names.mjs: that one reads the official
 * CLIENT tables, which only know vanilla cards. Every PS custom is absent from them, so
 * a slotted PS card contributed no word and the host item was titled as if the slot were
 * empty. PS publishes the real table themselves:
 *
 *     https://tools.payonstories.com/card_database
 *
 * which is server-rendered HTML — "Card Name (ID: n) | Prefix | Suffix" — so it can be
 * parsed without running their JavaScript. It is also authoritative in a way the client
 * tables are not FOR THIS SERVER: where the two disagree, PS has reworked the card.
 * Stalactic Golem is "Resist Stun" in the client and "of Sturdiness" on PS; Wootan
 * Fighter is "Bleeding Guard" vs "Smoldering"; Ungoliant flips from a suffix to a
 * prefix. See PS_SOURCES.md — a PS tool outranks a vanilla scrape on PS mechanics.
 *
 * The output is the WHOLE PS table, not just the customs, because that is what it is:
 * the card names on Payon Stories. It is applied only to the payon_stories profile
 * (cardNames.js), so the vanilla profile keeps the vanilla words.
 *
 * Run: node tools/gen-ps-card-names.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "open-ps-calc-backend", "backend", "src",
  "engine", "data", "ps", "ps_card_names.json");
const SRC = "https://tools.payonstories.com/card_database";

const res = await fetch(SRC, { headers: { "user-agent": "Mozilla/5.0" } });
if (!res.ok) throw new Error(`${SRC}: HTTP ${res.status}`);
const html = await res.text();

// Their table is Mantine-rendered, so the markup is noisy but the shape is stable:
// one <tr> per card, three <td>s, the first carrying "Name (ID: n)".
const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " ",
  "&#x27;": "'", "&#39;": "'", "&apos;": "'", "&#x2F;": "/",
};
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);

const strip = (cell) => decode(cell.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "")).trim();
// An em dash (and its friends) is how the table writes "this card has no word here".
const EMPTY = new Set(["", "-", "–", "—", "N/A", "None", "�"]);

const body = html.slice(html.indexOf("<tbody"));
const rows = body.match(/<tr\b[\s\S]*?<\/tr>/g) || [];

const cards = {};
let skipped = 0, both = 0;
for (const tr of rows) {
  const tds = (tr.match(/<td\b[\s\S]*?<\/td>/g) || []).map(strip);
  if (tds.length < 3) { skipped++; continue; }
  const m = tds[0].match(/^(.*?)\s*\(ID:\s*(\d+)\)$/);
  if (!m) { skipped++; continue; }
  const id = Number(m[2]);
  const prefix = EMPTY.has(tds[1]) ? "" : tds[1];
  const suffix = EMPTY.has(tds[2]) ? "" : tds[2];
  if (!prefix && !suffix) continue;            // card contributes no word at all
  // A card is one or the other. If PS ever lists both, prefer the prefix and say so
  // rather than silently dropping half the name.
  if (prefix && suffix) { both++; console.warn(`  ! ${id} ${m[1]} has BOTH "${prefix}" and "${suffix}" — using the prefix`); }
  cards[id] = prefix ? { n: prefix } : { n: suffix, after: true };
}

if (Object.keys(cards).length < 500) {
  throw new Error(`only parsed ${Object.keys(cards).length} cards — the page markup probably changed`);
}

const ordered = {};
for (const k of Object.keys(cards).map(Number).sort((a, b) => a - b)) ordered[k] = cards[k];

fs.writeFileSync(OUT, JSON.stringify({
  _source: SRC,
  _generated_by: "tools/gen-ps-card-names.mjs",
  _note: "Payon Stories' own card prefix/suffix table. Applied to the payon_stories "
    + "profile only; the vanilla profile uses the client tables in ../card_names.json. "
    + "n = the word; after = true means it follows the item name.",
  _fetched: new Date().toISOString().slice(0, 10),
  cards: ordered,
}, null, 1) + "\n");

console.log(`ps_card_names.json: ${Object.keys(ordered).length} cards`
  + ` (${Object.values(ordered).filter((c) => c.after).length} suffixes)`
  + `${skipped ? `, ${skipped} rows skipped` : ""}${both ? `, ${both} with both` : ""}`);
for (const id of [4001, 4035, 8218, 8239, 8244]) {
  console.log(`  ${id}: ${JSON.stringify(ordered[id] ?? null)}`);
}
