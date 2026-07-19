#!/usr/bin/env node
// One-off: re-apply the current bot filter to already-archived page_view events
// in stats.ndjson (they were filtered with the old rules at consolidation time).
// Only page_view events store a UA, so only those can be re-filtered; calc/donate/
// feature events are left untouched (they were filtered at log time and carry no UA).
//
// Run when the server is idle (rewrites the whole file). A .bak copy is written first.
//   node src/scripts/refilter-bots.js [--dry-run]
"use strict";

const fs   = require("fs");
const path = require("path");
const { isBot } = require("../middleware/statsLogger");

const DATA_DIR   = path.join(__dirname, "../../../data-store");
const STATS_FILE = path.join(DATA_DIR, "stats.ndjson");
const DRY = process.argv.includes("--dry-run");

function main() {
  if (!fs.existsSync(STATS_FILE)) { console.log("[refilter-bots] no stats.ndjson — nothing to do"); return; }

  const lines = fs.readFileSync(STATS_FILE, "utf8").split("\n").filter(Boolean);
  const kept = [];
  let dropped = 0, checked = 0;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { kept.push(line); continue; }
    // Only page_view events carry a UA we can re-evaluate.
    if (e.type === "page_view" && typeof e.ua === "string") {
      checked++;
      if (isBot(e.ua)) { dropped++; continue; }
    }
    kept.push(line);
  }
  console.log(`[refilter-bots] ${lines.length} events; re-checked ${checked} page views; ${dropped} now classified as bots`);

  if (DRY) { console.log("[refilter-bots] --dry-run: not writing"); return; }
  if (dropped === 0) { console.log("[refilter-bots] nothing to remove"); return; }

  fs.copyFileSync(STATS_FILE, STATS_FILE + ".bak");
  fs.writeFileSync(STATS_FILE, kept.join("\n") + "\n");
  console.log(`[refilter-bots] wrote ${kept.length} events (backup at stats.ndjson.bak)`);
}

main();
