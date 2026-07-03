import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
const { logPageView, readNginxPageViews, batchResolveGeo, geoCache } = require("../middleware/statsLogger");
const { loader } = require("../engine/dataLoader");

const router = Router();
const STATS_FILE   = path.join(__dirname, "../../../data-store/stats.ndjson");
const CURSOR_FILE  = path.join(__dirname, "../../../data-store/consolidation-cursor.json");
const STATS_PASSWORD = process.env.STATS_PASSWORD;

// Returns the timestamp up to which nginx logs have been consolidated into
// NDJSON. Returns 0 if consolidation has never run.
function readCursor(): number {
  try {
    const raw = fs.readFileSync(CURSOR_FILE, "utf8");
    return JSON.parse(raw).lastConsolidatedTs || 0;
  } catch { return 0; }
}

function checkPassword(req: Request, res: Response): boolean {
  if (!STATS_PASSWORD) return true;
  const pw = (req.headers["x-stats-password"] as string) || (req.query.password as string);
  if (pw === STATS_PASSWORD) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

// Read NDJSON event log and return events in [fromTs, toTs].
function readNdjsonEvents(fromTs: number, toTs: number): any[] {
  if (!fs.existsSync(STATS_FILE)) return [];
  const lines = fs.readFileSync(STATS_FILE, "utf8").split("\n").filter(Boolean);
  const events: any[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.ts >= fromTs && e.ts <= toTs) events.push(e);
    } catch {}
  }
  return events;
}

router.post("/ping", (req: Request, res: Response) => {
  logPageView(req);
  res.json({ ok: true });
});

router.get("/data", async (req: Request, res: Response) => {
  if (!checkPassword(req, res)) return;

  const now = Date.now();
  const daysParam = req.query.days as string;
  const fromParam = req.query.from as string;
  const toParam   = req.query.to   as string;

  let fromTs: number;
  let toTs: number = toParam ? Number(toParam) : now;

  if (fromParam) {
    fromTs = Number(fromParam);
  } else {
    const days = daysParam === "0" ? 0 : (parseInt(daysParam) || 7);
    fromTs = days === 0 ? 0 : now - days * 86_400_000;
  }

  // Cursor splits page view sources:
  //   [0, cursor)      → already consolidated into NDJSON (skip nginx for this range)
  //   [cursor, toTs]   → live nginx logs (not yet consolidated)
  // When cursor is 0, fall back to reading nginx for the full range (pre-consolidation).
  const cursor = readCursor();
  const nginxFrom = Math.max(fromTs, cursor);       // nginx only needed for recent gap
  const needNginx = nginxFrom <= toTs;

  const [nginxViews, ndjsonEvents] = await Promise.all([
    needNginx ? readNginxPageViews(nginxFrom, toTs) : Promise.resolve([]),
    Promise.resolve(readNdjsonEvents(fromTs, toTs)),
  ]);

  // Attach geo to recent nginx views (batch-resolve IPs not yet in cache).
  await batchResolveGeo(nginxViews.map((e: any) => e.ip));
  const recentViews = nginxViews.map((e: any) => ({
    ...e,
    ...(geoCache.get(e.ip) || { country: "Unknown", city: "" }),
  }));

  // Archived page_views from NDJSON (already geo-enriched by consolidate.js).
  // Only include events before the cursor to avoid double-counting.
  const archivedViews = cursor > 0
    ? ndjsonEvents.filter((e: any) => e.type === "page_view" && e.ts < cursor)
    : [];

  const calcEvents = ndjsonEvents.filter((e: any) => e.type === "calculate");

  const allEvents = [...archivedViews, ...recentViews, ...calcEvents];

  const uniqueIps     = new Set<string>();
  const byDay: Record<string, { date: string; views: number; calcs: number }> = {};
  const jobCounts:    Record<number, number> = {};
  const skillCounts:  Record<number, number> = {};
  const countryCounts: Record<string, number> = {};
  let totalViews = 0, totalCalcs = 0;

  for (const e of allEvents) {
    if (e.ip) uniqueIps.add(e.ip);
    const day = new Date(e.ts).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, views: 0, calcs: 0 };
    const country = e.country || "Unknown";
    countryCounts[country] = (countryCounts[country] || 0) + 1;

    if (e.type === "page_view") {
      totalViews++;
      byDay[day].views++;
    } else if (e.type === "calculate") {
      totalCalcs++;
      byDay[day].calcs++;
      if (e.job_id != null) jobCounts[e.job_id] = (jobCounts[e.job_id] || 0) + 1;
      if (e.skill_id != null && e.skill_id !== 0) skillCounts[e.skill_id] = (skillCounts[e.skill_id] || 0) + 1;
    }
  }

  // Fill missing days in range (skip for all-time to avoid huge arrays).
  const filledDays: { date: string; views: number; calcs: number }[] = [];
  if (fromTs > 0) {
    let cur = new Date(fromTs);
    cur.setUTCHours(0, 0, 0, 0);
    const end = new Date(toTs);
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      filledDays.push(byDay[d] || { date: d, views: 0, calcs: 0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else {
    filledDays.push(...Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)));
  }

  // Enrich job and skill names from the data loader.
  const allJobs: { id: number; name: string }[] = loader.getAllJobs ? loader.getAllJobs() : [];
  const jobNameMap: Record<number, string> = {};
  for (const j of allJobs) jobNameMap[j.id] = j.name;

  const topJobs = Object.entries(jobCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10)
    .map(([id, count]) => ({ job_id: Number(id), name: jobNameMap[Number(id)] || `Job ${id}`, count }));

  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10)
    .map(([id, count]) => {
      try {
        const sk = loader.getSkill ? loader.getSkill(Number(id)) : null;
        return { skill_id: Number(id), name: sk?.description || sk?.name || `Skill ${id}`, count };
      } catch {
        return { skill_id: Number(id), name: `Skill ${id}`, count };
      }
    });

  const countries = Object.entries(countryCounts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 25)
    .map(([country, count]) => ({ country, count }));

  res.json({
    total_views:  totalViews,
    total_calcs:  totalCalcs,
    unique_ips:   uniqueIps.size,
    by_day:       filledDays,
    top_jobs:     topJobs,
    top_skills:   topSkills,
    countries,
    from_ts:      fromTs,
    to_ts:        toTs,
    nginx_available: fs.existsSync(process.env.NGINX_LOG_PATH || "/var/log/nginx/access.log"),
    consolidated_through: cursor > 0 ? new Date(cursor).toISOString() : null,
  });
});

export default router;
