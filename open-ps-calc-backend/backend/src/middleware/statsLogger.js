const fs = require("fs");
const path = require("path");
const readline = require("readline");

const STATS_FILE = path.join(__dirname, "../../../data-store/stats.ndjson");
const NGINX_LOG   = process.env.NGINX_LOG_PATH || "/var/log/nginx/access.log";

const BOT_PATTERN = /bot|crawler|spider|scraper|scan|check|monitor|uptime|pingdom|datadog|lighthouse|headless|puppeteer|playwright|selenium|wget|curl|facebookexternalhit|twitterbot|slurp|baiduspider|yandex|bytespider|ahrefsbot|semrushbot|dotbot|petalbot/i;
const NGINX_LINE  = /^(\S+) \S+ \S+ \[([^\]]+)\] "([^"]+)" (\d+) \S+(?:\s+"[^"]*"\s+"([^"]*)")?/;
const MONTH_NUM   = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

const geoCache = new Map();

function isBot(ua = "") { return BOT_PATTERN.test(ua); }

function isLocalIp(ip) {
  return !ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.") || ip.startsWith("192.168.") || ip.startsWith("10.");
}

function getIp(req) {
  return ((req.headers["x-forwarded-for"] || req.ip || "").split(",")[0] || "").trim();
}

function parseNginxTime(s) {
  const m = s.match(/(\d+)\/(\w+)\/(\d+):(\d+):(\d+):(\d+)/);
  if (!m) return null;
  const mo = MONTH_NUM[m[2]];
  if (mo === undefined) return null;
  return Date.UTC(+m[3], mo, +m[1], +m[4], +m[5], +m[6]);
}

// Parse nginx access log and return page-view events within [fromTs, toTs].
// Only counts GET / (the SPA root, with or without query params) with 2xx status.
async function readNginxPageViews(fromTs, toTs) {
  if (!fs.existsSync(NGINX_LOG)) return [];
  const results = [];
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(NGINX_LOG), crlfDelay: Infinity });
    for await (const line of rl) {
      const m = line.match(NGINX_LINE);
      if (!m) continue;
      const [, ip, timeStr, request, statusStr, ua = ""] = m;
      const ts = parseNginxTime(timeStr);
      if (!ts || ts < fromTs || ts > toTs) continue;
      const status = parseInt(statusStr);
      if (status < 200 || status >= 400) continue;
      if (!/^GET \/(\?[^ ]*)? HTTP/.test(request)) continue;
      if (isBot(ua)) continue;
      results.push({ ts, ip, ua: ua.slice(0, 250), type: "page_view" });
    }
  } catch (e) {
    console.warn("[stats] nginx log read error:", e?.message || e);
  }
  return results;
}

// Batch-resolve up to 100 IPs per request via ip-api.com free batch endpoint.
// Results are cached in geoCache so repeated calls are fast.
async function batchResolveGeo(ips) {
  const fresh = [...new Set(ips)].filter(ip => !geoCache.has(ip) && !isLocalIp(ip));
  if (!fresh.length) return;
  for (let i = 0; i < fresh.length; i += 100) {
    const batch = fresh.slice(i, i + 100);
    try {
      const res = await fetch("http://ip-api.com/batch?fields=status,query,country,city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      const data = await res.json();
      for (const entry of data) {
        geoCache.set(entry.query, entry.status === "success"
          ? { country: entry.country || "Unknown", city: entry.city || "" }
          : { country: "Unknown", city: "" });
      }
    } catch {}
  }
  // Mark any still-unresolved IPs as unknown so we don't retry on every request
  for (const ip of fresh) {
    if (!geoCache.has(ip)) geoCache.set(ip, { country: "Unknown", city: "" });
  }
}

async function resolveGeo(ip) {
  if (isLocalIp(ip)) return { country: "Local", city: "" };
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`);
    const data = await res.json();
    const geo = data.status === "success"
      ? { country: data.country || "Unknown", city: data.city || "" }
      : { country: "Unknown", city: "" };
    geoCache.set(ip, geo);
    return geo;
  } catch {
    const geo = { country: "Unknown", city: "" };
    geoCache.set(ip, geo);
    return geo;
  }
}

function appendEvent(event) {
  fs.appendFile(STATS_FILE, JSON.stringify(event) + "\n", () => {});
}

function logPageView(req) {
  // Page views are now sourced from nginx; this endpoint still exists as a
  // fallback (e.g. dev environments without nginx) but is not the primary source.
  const ua = req.headers["user-agent"] || "";
  if (isBot(ua)) return;
  const ip = getIp(req);
  resolveGeo(ip).then((geo) => {
    appendEvent({ ts: Date.now(), type: "page_view", ip, ...geo, ua: ua.slice(0, 250) });
  });
}

function logCalculate(req, jobId, skillId) {
  const ua = req.headers["user-agent"] || "";
  if (isBot(ua)) return;
  const ip = getIp(req);
  resolveGeo(ip).then((geo) => {
    appendEvent({ ts: Date.now(), type: "calculate", ip, ...geo, job_id: jobId ?? null, skill_id: skillId ?? null });
  });
}

module.exports = { isBot, getIp, logPageView, logCalculate, readNginxPageViews, batchResolveGeo, geoCache };
