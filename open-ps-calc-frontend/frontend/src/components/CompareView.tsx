import type { ReactNode } from "react";

// Build-vs-build comparison. Pin the current computed result as a snapshot, then
// tweak the editor and compare the live build against each pinned one. Metrics come
// straight off the calc result the backend already returns.

export interface CompareMetrics {
  label: string;        // the output being compared: skill name or "Normal attack"
  dps: number | null;   // effective DPS (null when the skill has no valid DPS)
  avg: number;          // average damage per hit
  min: number;
  max: number;
  ttk: number | null;   // time to kill (seconds), monster mode only
  critChance: number;   // %
  aspd: number;
}

// Snapshot of everything needed to (a) show the comparison and (b) restore the build.
export interface ComparePin {
  id: string;
  name: string;
  metrics: CompareMetrics;
  snapshot: unknown; // opaque build state, handed back to BuildEditor on "Load"
}

// Pull the headline metrics out of a raw calcResult. Shared by BuildEditor (live
// build) and the pin capture, so both read exactly the same numbers.
export function summaryMetrics(cr: any): CompareMetrics | null {
  if (!cr) return null;
  const usingSkill = cr.skill && cr.selected_skill && cr.selected_skill.id !== 0;
  const branch = usingSkill ? cr.skill : cr.normal_attack;
  const res = branch?.result;
  if (!res || !res.normal) return null;
  const dps = res.dps_valid ? res.dps : null;
  const effDps = dps != null ? dps + (cr.poison_dot_per_sec || 0) : null;
  const ttk = effDps != null && effDps > 0 && cr.target_hp ? cr.target_hp / effDps : null;
  return {
    label: usingSkill ? (cr.selected_skill.label || "Skill") : "Normal attack",
    dps,
    avg: res.normal.avg_damage ?? 0,
    min: res.normal.min_damage ?? 0,
    max: res.normal.max_damage ?? 0,
    ttk,
    critChance: res.crit_chance ?? 0,
    aspd: branch.status?.aspd ?? 0,
  };
}

const fmt = (n: number | null, dp = 0) =>
  n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

interface Row {
  key: keyof CompareMetrics;
  label: string;
  higherIsBetter: boolean;
  render: (m: CompareMetrics) => string;
}

const ROWS: Row[] = [
  { key: "dps", label: "DPS", higherIsBetter: true, render: (m) => fmt(m.dps, 1) },
  { key: "avg", label: "Damage / hit", higherIsBetter: true, render: (m) => `${fmt(m.avg)}  (${fmt(m.min)}–${fmt(m.max)})` },
  { key: "ttk", label: "Time to kill", higherIsBetter: false, render: (m) => (m.ttk == null ? "—" : `${fmt(m.ttk, 2)}s`) },
  { key: "critChance", label: "Crit chance", higherIsBetter: true, render: (m) => `${fmt(m.critChance, 1)}%` },
  { key: "aspd", label: "ASPD", higherIsBetter: true, render: (m) => fmt(m.aspd, 1) },
];

function num(m: CompareMetrics, k: keyof CompareMetrics): number | null {
  const v = m[k];
  return typeof v === "number" ? v : null;
}

// best (min or max) numeric value across the columns for a row, for highlighting
function bestValue(cols: CompareMetrics[], row: Row): number | null {
  const vals = cols.map((m) => num(m, row.key)).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return row.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
}

interface Props {
  live: CompareMetrics | null;
  pins: ComparePin[];
  canPin: boolean;
  onPin: () => void;
  onRemove: (id: string) => void;
  onLoad: (pin: ComparePin) => void;
}

export default function CompareView({ live, pins, canPin, onPin, onRemove, onLoad }: Props) {
  const columns: { key: string; header: ReactNode; metrics: CompareMetrics; isLive?: boolean }[] = [
    ...pins.map((p) => ({
      key: p.id,
      metrics: p.metrics,
      header: (
        <div className="cmp-col-head">
          <div className="cmp-col-name" title={p.name}>{p.name}</div>
          <div className="cmp-col-sub">{p.metrics.label}</div>
          <div className="cmp-col-actions">
            <button className="cmp-btn-mini" onClick={() => onLoad(p)} title="Load this build back into the editor">Load</button>
            <button className="cmp-btn-mini cmp-btn-x" onClick={() => onRemove(p.id)} title="Remove">✕</button>
          </div>
        </div>
      ),
    })),
    ...(live
      ? [{
          key: "__live", isLive: true, metrics: live,
          header: (
            <div className="cmp-col-head cmp-col-head--live">
              <div className="cmp-col-name">Current</div>
              <div className="cmp-col-sub">{live.label}</div>
              <div className="cmp-col-actions">
                <button className="cmp-btn-mini" onClick={onPin} disabled={!canPin} title="Save the current build as a comparison column">📌 Pin</button>
              </div>
            </div>
          ),
        }]
      : []),
  ];

  const allMetrics = columns.map((c) => c.metrics);

  return (
    <div className="compare-view">
      <div className="compare-head">
        <h3>Compare builds</h3>
        <button className="cmp-pin-btn" onClick={onPin} disabled={!canPin}>📌 Pin current build</button>
      </div>
      {pins.length === 0 ? (
        <p className="compare-empty">
          Compute a build, then click <strong>Pin</strong> to keep it here. Tweak your gear, cards,
          stats or skill and pin again — each pinned build becomes a column so you can see which wins.
        </p>
      ) : (
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="cmp-metric-col"></th>
                {columns.map((c) => (
                  <th key={c.key} className={c.isLive ? "cmp-live-col" : ""}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const best = bestValue(allMetrics, row);
                return (
                  <tr key={row.key}>
                    <td className="cmp-metric-label">{row.label}</td>
                    {columns.map((c) => {
                      const v = num(c.metrics, row.key);
                      const isBest = best != null && v != null && Math.abs(v - best) < 1e-6 && columns.length > 1;
                      const liveVal = live ? num(live, row.key) : null;
                      const showDelta = !c.isLive && liveVal != null && v != null && liveVal !== 0;
                      let deltaEl = null;
                      if (showDelta) {
                        const pct = ((v! - liveVal!) / Math.abs(liveVal!)) * 100;
                        const better = row.higherIsBetter ? pct > 0 : pct < 0;
                        deltaEl = (
                          <span className={`cmp-delta ${better ? "cmp-delta--up" : pct === 0 ? "" : "cmp-delta--down"}`}>
                            {pct >= 0 ? "+" : ""}{pct.toFixed(0)}% vs current
                          </span>
                        );
                      }
                      return (
                        <td key={c.key} className={`${c.isLive ? "cmp-live-col" : ""} ${isBest ? "cmp-best" : ""}`}>
                          <span className="cmp-val">{row.render(c.metrics)}</span>
                          {deltaEl}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
