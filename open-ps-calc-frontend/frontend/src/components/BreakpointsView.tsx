// On-demand stat breakpoints for the current build: how much more AGI/DEX to
// reach the next ASPD milestone, DEX to instant-cast the selected skill, and
// HIT/DEX to reach 95%/100% hit vs the selected monster. Computed server-side by
// re-running the real status/timing/hit code with the stat bumped (see
// routes/calculate.ts POST /breakpoints), so the numbers match the calculator.
// Auto-refreshes (debounced) whenever the build / skill / target changes.
import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import type { Breakpoints } from "../types";

const DEBOUNCE_MS = 450;

export function BreakpointsView({ payload }: { payload: unknown | null }) {
  const [bp, setBp] = useState<Breakpoints | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const reqId = useRef(0);

  useEffect(() => {
    if (!payload) return;
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.breakpoints(payload);
        if (reqId.current === id) { setBp(r.breakpoints); setErr(""); }
      } catch (e: any) {
        if (reqId.current === id) setErr(String(e?.message || e));
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [payload]);

  return (
    <div className="bp">
      <div className="bp-head">
        <span className="bp-title">Breakpoints</span>
        {loading && <span className="bp-sub">updating…</span>}
      </div>
      {err && !bp && <div className="bp-err">{err}</div>}
      {bp && <BreakpointsBody bp={bp} />}
    </div>
  );
}

function BreakpointsBody({ bp }: { bp: Breakpoints }) {
  const { aspd, cast, hit } = bp;
  return (
    <div className="bp-body">
      <div className="bp-row">
        <span className="bp-k">ASPD</span>
        <span className="bp-v">
          <b>{aspd.current.toFixed(1)}</b>
          {aspd.agi.length ? (
            <> — {aspd.agi.map((b) => `+${b.plus} AGI → ${b.aspd}`).join(" · ")}</>
          ) : (
            <span className="bp-sub"> — at cap</span>
          )}
          {aspd.dex.length ? <span className="bp-sub"> · or {aspd.dex.map((b) => `+${b.plus} DEX → ${b.aspd}`).join(" · ")}</span> : null}
        </span>
      </div>

      {cast && (
        <div className="bp-row">
          <span className="bp-k">Cast</span>
          <span className="bp-v">
            <b>{(cast.current_ms / 1000).toFixed(2)}s</b>{" "}
            {cast.instant_plus_dex == null
              ? <span className="bp-sub">— instant cast not reachable</span>
              : cast.instant_plus_dex === 0
                ? <span className="bp-sub">— already instant</span>
                : <>— instant cast at <b>+{cast.instant_plus_dex} DEX</b></>}
          </span>
        </div>
      )}

      {hit && (
        <div className="bp-row">
          <span className="bp-k">Hit</span>
          <span className="bp-v">
            <b>{hit.current_pct}%</b>
            {hit.current_pct >= 100 ? (
              <span className="bp-sub"> — always hits</span>
            ) : (
              <>
                {" — "}
                {hit.to95 ? `95% at +${hit.to95} HIT` : "95% ✓"}
                {" · "}
                {hit.to100 ? `100% at +${hit.to100} HIT` : "100% ✓"}
                <span className="bp-sub"> (1 DEX = 1 HIT)</span>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
