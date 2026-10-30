import "dotenv/config";
import express from "express";
import cors from "cors";
import dataRoutes from "./routes/data";
import calculateRoutes from "./routes/calculate";
import statsRoutes from "./routes/stats";
import shareRoutes from "./routes/share";
const { logCalculate } = require("./middleware/statsLogger");

const app = express();

// The app and the API are served from ONE origin in both environments — Vite
// proxies /api to the backend in dev, nginx proxies it in production — so no
// browser this project controls ever makes a cross-origin API call. Bare
// `cors()` answered every origin with `Access-Control-Allow-Origin: *`, which
// bought our own pages nothing and bought everyone else a free backend: any
// site could point a front end at this one and serve our engine as its own.
//
// This is NOT a defence against scripts, and must not be mistaken for one. A
// request with no Origin header — curl, another server, anything that isn't a
// browser — is not a cross-origin request and is allowed through exactly as
// before. The only thing this stops is OTHER WEBSITES' browser code reading
// our responses.
//
// Override with ALLOWED_ORIGINS (comma-separated) to add a staging host. The
// dev server needs no entry here precisely because it proxies.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  || "https://openpscalc.com,https://www.openpscalc.com")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    cb(null, ALLOWED_ORIGINS.includes(origin));
  },
}));
app.use(express.json({ limit: "1mb" }));

// Stats routes are outside the API key gate and use their own password.
// Mounted twice: /stats (legacy) and /api/e — the latter is a blocker-resistant
// path (content/ad blockers commonly drop requests to URLs containing "stats").
// Both are placed BEFORE the /api key gate below, so the beacons stay ungated.
app.use("/stats", statsRoutes);
app.use("/api/e", statsRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Shared-secret gate: only requests carrying the matching X-API-Key header
// reach the routes below. Note this is NOT real authentication — the key
// lives in the frontend's public JS bundle, so anyone who loads the page
// (or opens devtools) can read it. It exists to keep the API from being
// casually hit by tools/scripts that never load the frontend at all, not to
// cryptographically prove the caller is "really" this frontend.
// If API_KEY is unset, the gate is a no-op (keeps local dev frictionless).
const API_KEY = process.env.API_KEY;
app.use("/api", (req, res, next) => {
  if (!API_KEY) return next();
  if (req.header("x-api-key") === API_KEY) return next();
  res.status(401).json({ error: "Unauthorized" });
});

app.use("/api/data", dataRoutes);
app.use("/api/calculate", calculateRoutes);
app.use("/api/share", shareRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Open PS Calc backend listening on http://localhost:${PORT}`);
});
