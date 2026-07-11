import type { ReactNode } from "react";
import InfoTooltip from "./InfoTooltip";

// Build-vs-build comparison. Pin the current computed result as a snapshot, then
// tweak the editor and compare the live build against each pinned one. Metrics come
// straight off the calc result the backend already returns.

export interface CompareMetrics {
  label: string;        // the output being compared: skill name or "Normal attack"
  dps: number | null;   // effective DPS (null when the skill has no valid DPS)
  avg: number;          // average damage per hit
  min: number;
  max: number;
  hitsToKill: number | null; // avg hits/casts to kill, monster mode only
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
  const avg = res.normal.avg_damage ?? 0;
  const hitsToKill = cr.target_hp && avg > 0 ? Math.ceil(cr.target_hp / avg) : null;
  return {
    label: usingSkill ? (cr.selected_skill.label || "Skill") : "Normal attack",
    dps,
    avg,
    min: res.normal.min_damage ?? 0,
    max: res.normal.max_damage ?? 0,
    hitsToKill,
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
  { key: "avg", label: "Damage / hit", higherIsBetter: true, render: (m) => `${fmt(m.avg)}` },
  { key: "hitsToKill", label: "Hits to kill", higherIsBetter: false, render: (m) => (m.hitsToKill == null ? "—" : fmt(m.hitsToKill)) },
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
  onClear: () => void;
}

export default function CompareView({ live, pins, canPin, onPin, onRemove, onLoad, onClear }: Props) {
  const columns = [
    ...pins.map((p) => ({ key: p.id, metrics: p.metrics, name: p.name, sub: p.metrics.label, isLive: false, pin: p as ComparePin | null })),
    ...(live ? [{ key: "__live", metrics: live, name: "Current", sub: live.label, isLive: true, pin: null as ComparePin | null }] : []),
  ];
  const allMetrics = columns.map((c) => c.metrics);
  const dpsVals = columns.map((c) => c.metrics.dps).filter((v): v is number => v != null);
  const barMax = dpsVals.length ? Math.max(...dpsVals) : 0;
  const bestDpsKey = columns.length > 1 && barMax > 0 ? columns.find((c) => c.metrics.dps === barMax)?.key : undefined;

  return (
    <div className="compare-view">
      <div className="compare-head">
        <h3>
          Compare builds
          <InfoTooltip>
            <strong>Compare builds</strong>
            Pin a computed build to save it as a column, then tweak your gear, cards, stats or skill
            and pin again — each pin sits beside your Current build.
            <div className="tooltip-row"><span>Compares</span><span>DPS · dmg / hit · hits &amp; time to kill · crit · ASPD</span></div>
            <div className="tooltip-row"><span>Reading it</span><span>best per row in green · ▲/▼ delta vs Current</span></div>
            <div className="tooltip-row"><span>Buttons</span><span>Load = reload into editor · ✕ = remove</span></div>
          </InfoTooltip>
        </h3>
        {pins.length > 0 && <span className="compare-count">{pins.length} pinned</span>}
        <button className="cmp-pin-btn" onClick={onPin} disabled={!canPin}>Pin current</button>
        {pins.length > 0 && (
          <button className="cmp-clear-btn" onClick={onClear} title="Remove all pinned builds">Clear all</button>
        )}
      </div>

      {pins.length === 0 ? (
        <p className="compare-empty">
          Click <strong>Pin</strong> to save this build, then tweak your gear, cards or stats and
          pin again — each becomes a column so you can see which wins.
        </p>
      ) : (
        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="cmp-metric-col" />
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`${c.isLive ? "cmp-col--live" : ""} ${c.key === bestDpsKey ? "cmp-col--winner" : ""}`}
                  >
                    <div className="cmp-col-head">
                      {c.key === bestDpsKey && <span className="cmp-winner-tag">Top DPS</span>}
                      <div className="cmp-col-name" title={c.name}>{c.name}</div>
                      <div className="cmp-col-sub">{c.sub}</div>
                      <div className="cmp-col-actions">
                        {c.isLive ? (
                          <button className="cmp-btn-mini cmp-btn-pin" onClick={onPin} disabled={!canPin} title="Save the current build as a column">Pin</button>
                        ) : (
                          <>
                            <button className="cmp-btn-mini" onClick={() => onLoad(c.pin!)} title="Load this build into the editor">Load</button>
                            <button className="cmp-btn-mini cmp-btn-x" onClick={() => onRemove(c.key)} title="Remove">✕</button>
                          </>
                        )}
                      </div>
                    </div>
                  </th>
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
                      const showDelta = !c.isLive && liveVal != null && v != null && liveVal !== 0 && Math.abs(v - liveVal) > 1e-6;
                      let delta: ReactNode = null;
                      if (showDelta) {
                        const pct = ((v! - liveVal!) / Math.abs(liveVal!)) * 100;
                        const better = row.higherIsBetter ? pct > 0 : pct < 0;
                        delta = (
                          <span className={`cmp-delta ${better ? "cmp-delta--up" : "cmp-delta--down"}`} title="vs current build">
                            {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
                          </span>
                        );
                      }
                      return (
                        <td key={c.key} className={`${c.isLive ? "cmp-col--live" : ""} ${isBest ? "cmp-best" : ""}`}>
                          <div className="cmp-cell">
                            <span className="cmp-val">{row.render(c.metrics)}</span>
                            {row.key === "avg" && (
                              <span className="cmp-val-range">{fmt(c.metrics.min)}–{fmt(c.metrics.max)}</span>
                            )}
                            {row.key === "dps" && v != null && barMax > 0 && (
                              <span className="cmp-bar">
                                <span className={`cmp-bar-fill ${isBest ? "cmp-bar-fill--best" : ""}`} style={{ width: `${Math.max(6, (v / barMax) * 100)}%` }} />
                              </span>
                            )}
                            {delta}
                          </div>
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
