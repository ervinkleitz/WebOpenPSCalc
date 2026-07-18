// "What should I upgrade next?" — on demand, asks the backend to re-run the
// engine with each candidate change (a stat bump, one more refine per refineable
// equipped piece) and ranks them by DPS gain. On-demand (not auto) because each
// request runs a dozen-plus full calculations. Needs a skill/target that produces
// real DPS; support skills / no target yield an empty list.
import { useState } from "react";
import { api } from "../api/client";
import type { UpgradeAdvisor } from "../types";

export function UpgradeAdvisorView({ payload }: { payload: unknown | null }) {
  const [adv, setAdv] = useState<UpgradeAdvisor | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ran, setRan] = useState(false);

  async function run() {
    if (!payload) return;
    setLoading(true); setErr(""); setRan(true);
    try {
      const r = await api.upgradeAdvisor(payload);
      setAdv(r.advisor);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const top = adv?.suggestions ?? [];
  const maxPct = top.length ? Math.max(...top.map((s) => s.dps_pct)) : 1;

  return (
    <div className="adv">
      <button className="adv-run" onClick={run} disabled={loading || !payload}>
        {loading ? "Analyzing…" : ran ? "Re-check upgrades" : "What should I upgrade?"}
      </button>
      {err && <div className="adv-err">{err}</div>}
      {ran && !loading && !err && (
        top.length === 0 ? (
          <div className="adv-empty">No DPS gains found — pick a damaging skill and a target, then try again.</div>
        ) : (
          <ul className="adv-list">
            {top.map((s, i) => (
              <li className="adv-row" key={`${s.label}-${i}`}>
                <span className="adv-k">{s.label}</span>
                <span className="adv-bar-wrap">
                  <span className="adv-bar" style={{ width: `${Math.max(4, (s.dps_pct / maxPct) * 100)}%` }} />
                </span>
                <span className="adv-v">+{s.dps_pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
