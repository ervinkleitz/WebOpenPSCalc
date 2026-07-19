#!/usr/bin/env node
// Absorbs nginx access log page views into stats.ndjson so history is
// preserved beyond log rotation.  Run once for initial backfill; a daily
// cron keeps it current.  Uses a cursor file to avoid re-processing.
"use strict";

const fs   = require("fs");
const path = require("path");
const { readNginxPageViews } = require("../middleware/statsLogger");

const DATA_DIR   = path.join(__dirname, "../../../data-store");
const STATS_FILE = path.join(DATA_DIR, "stats.ndjson");
const CURSOR_FILE = path.join(DATA_DIR, "consolidation-cursor.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Batch geo-resolve IPs with rate limiting (ip-api.com free: 45 req/min).
async function resolveGeo(ips) {
  const unique = [...new Set(ips.filter(Boolean))];
  const cache = new Map();
  const total = Math.ceil(unique.length / 100);
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    if (i > 0) await sleep(1400); // ~42 req/min
    try {
      const res = await fetch("http://ip-api.com/batch?fields=status,query,country,regionName,city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      const data = await res.json();
      for (const entry of data) {
        cache.set(entry.query, entry.status === "success"
          ? { country: entry.country || "Unknown", region: entry.regionName || "Unknown", city: entry.city || "" }
          : { country: "Unknown", region: "Unknown", city: "" });
      }
    } catch (e) {
      console.warn("[consolidate] geo batch failed:", e?.message);
    }
    for (const ip of batch) {
      if (!cache.has(ip)) cache.set(ip, { country: "Unknown", region: "Unknown", city: "" });
    }
    const done = Math.ceil((i + 100) / 100);
    if (total > 1) process.stdout.write(`\r[consolidate] geo ${Math.min(done, total)}/${total} batches`);
  }
  if (total > 1) process.stdout.write("\n");
  return cache;
}

async function main() {
  // Read cursor (0 = never consolidated → full backfill).
  let cursor = 0;
  try {
    cursor = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")).lastConsolidatedTs || 0;
  } catch {}

  // Consolidate up to the start of today (UTC midnight) so we only absorb
  // complete days and avoid partial-day overlap with live nginx reads.
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);
  const toTs = todayMidnight.getTime();

  if (cursor >= toTs) {
    console.log("[consolidate] already up to date");
    return;
  }

  const mode = cursor === 0 ? "backfill" : "incremental";
  console.log(`[consolidate] ${mode}: ${new Date(cursor).toISOString()} → ${new Date(toTs).toISOString()}`);

  const events = await readNginxPageViews(cursor, toTs);
  console.log(`[consolidate] ${events.length} page view events found`);

  if (events.length > 0) {
    const geoMap = await resolveGeo(events.map((e) => e.ip));
    const lines = events
      .map((e) => {
        const geo = geoMap.get(e.ip) || { country: "Unknown", region: "Unknown", city: "" };
        return JSON.stringify({ ts: e.ts, type: "page_view", ip: e.ip, ua: e.ua, ...geo, source: "nginx_archive" });
      })
      .join("\n") + "\n";

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(STATS_FILE, lines);
    console.log(`[consolidate] appended ${events.length} events to stats.ndjson`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({
    lastConsolidatedTs: toTs,
    updatedAt: new Date().toISOString(),
  }));
  console.log(`[consolidate] cursor → ${new Date(toTs).toISOString()}`);
}

main().catch((e) => { console.error("[consolidate]", e); process.exit(1); });
