#!/usr/bin/env node
// One-off: add a `region` (state/province) to existing stats.ndjson events that
// were written before region resolution existed. Re-resolves each event's stored
// IP via ip-api.com (respecting the free 45 req/min limit) and rewrites the file.
//
// Run when the server is idle (it rewrites the whole file; concurrent appends
// during the run would be lost). A .bak copy is written first.
//   node src/scripts/backfill-regions.js [--dry-run]
"use strict";

const fs   = require("fs");
const path = require("path");

const DATA_DIR   = path.join(__dirname, "../../../data-store");
const STATS_FILE = path.join(DATA_DIR, "stats.ndjson");

const DRY = process.argv.includes("--dry-run");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isLocalIp(ip) {
  return !ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.") || ip.startsWith("192.168.") || ip.startsWith("10.");
}

// query → regionName, batched 100 at a time with rate limiting.
async function resolveRegions(ips) {
  const unique = [...new Set(ips.filter((ip) => ip && !isLocalIp(ip)))];
  const out = new Map();
  const total = Math.ceil(unique.length / 100);
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    if (i > 0) await sleep(1400); // ~42 req/min
    try {
      const res = await fetch("http://ip-api.com/batch?fields=status,query,regionName", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      const data = await res.json();
      for (const e of data) out.set(e.query, e.status === "success" ? (e.regionName || "Unknown") : "Unknown");
    } catch (err) {
      console.warn("[backfill-regions] batch failed:", err && err.message);
    }
    for (const ip of batch) if (!out.has(ip)) out.set(ip, "Unknown");
    if (total > 1) process.stdout.write(`\r[backfill-regions] ${Math.min(i / 100 + 1, total)}/${total} batches`);
  }
  if (total > 1) process.stdout.write("\n");
  return out;
}

async function main() {
  if (!fs.existsSync(STATS_FILE)) { console.log("[backfill-regions] no stats.ndjson — nothing to do"); return; }

  const lines = fs.readFileSync(STATS_FILE, "utf8").split("\n").filter(Boolean);
  const events = [];
  for (const line of lines) { try { events.push(JSON.parse(line)); } catch {} }

  const needIps = events.filter((e) => e.region == null && e.ip && !isLocalIp(e.ip)).map((e) => e.ip);
  const already = events.filter((e) => e.region != null).length;
  console.log(`[backfill-regions] ${events.length} events; ${already} already have a region; ${new Set(needIps).size} unique IPs to resolve`);

  const regionMap = needIps.length ? await resolveRegions(needIps) : new Map();

  let filled = 0;
  for (const e of events) {
    if (e.region != null) continue;
    if (!e.ip || isLocalIp(e.ip)) { e.region = "Local"; continue; }
    e.region = regionMap.get(e.ip) || "Unknown";
    if (e.region !== "Unknown") filled++;
  }
  console.log(`[backfill-regions] filled ${filled} events with a real region`);

  if (DRY) { console.log("[backfill-regions] --dry-run: not writing"); return; }

  fs.copyFileSync(STATS_FILE, STATS_FILE + ".bak");
  fs.writeFileSync(STATS_FILE, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  console.log(`[backfill-regions] wrote ${events.length} events (backup at stats.ndjson.bak)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
