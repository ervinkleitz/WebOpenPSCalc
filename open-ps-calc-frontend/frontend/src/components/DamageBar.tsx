import { useEffect, useRef, useState } from "react";
import type { CompareMetrics } from "./CompareView";

// The number, kept on screen.
//
// Before this, the figure a visitor came for existed only inside the results panel,
// which is rendered above a page 2–4 screens tall — so the loop a damage calculator
// is actually used for ("swap the card, see what it does") was: edit, scroll up,
// read, scroll back. Measured on production 2026-10-17: nothing on the first screen
// carried a damage number at all.
//
// Anchored to the BOTTOM of the viewport rather than under the topbar. The topbar is
// already `position: sticky; top: 0` with a height that changes with the viewport, so
// a second sticky strip underneath it would have to track that height; the bottom
// edge needs no such arithmetic, it is the same pattern the tooltip sheet already
// uses on narrow screens, and on a phone it puts the number in the thumb zone.

interface Props {
  metrics: CompareMetrics | null;
  targetName: string | null;
  refreshing: boolean;
  onOpenDetails: () => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function DamageBar({ metrics, targetName, refreshing, onOpenDetails }: Props) {
  // The delta is the actual answer to "is this card better", so it is worth more
  // than the absolute number it decorates. Held against the last DIFFERENT average,
  // not the last render, or an edit that changes nothing would clear it.
  const [delta, setDelta] = useState<number | null>(null);
  const prevAvg = useRef<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avg = metrics?.avg ?? null;
  useEffect(() => {
    if (avg == null) { prevAvg.current = null; return; }
    const was = prevAvg.current;
    prevAvg.current = avg;
    if (was == null || was === avg) return;
    setDelta(avg - was);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setDelta(null), 6000);
  }, [avg]);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  if (!metrics) return null;

  const pct = delta != null && metrics.avg - delta !== 0
    ? (delta / (metrics.avg - delta)) * 100
    : null;

  return (
    <div className={`damage-bar${refreshing ? " damage-bar--refreshing" : ""}`} role="status" aria-live="polite">
      <div className="damage-bar-main">
        <span className="damage-bar-label">{metrics.label}</span>
        <strong className="damage-bar-range">
          {fmt(metrics.min)}–{fmt(metrics.max)}
        </strong>
        {delta != null && (
          // Rendered off `delta`, which is cleared on a timer, so it is a flash
          // rather than a permanent badge that stops meaning anything.
          <span className={`damage-bar-delta ${delta > 0 ? "is-up" : "is-down"}`}>
            {delta > 0 ? "+" : "−"}{fmt(Math.abs(delta))}
            {pct != null && Math.abs(pct) >= 0.1 ? ` (${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%)` : ""}
          </span>
        )}
      </div>
      <div className="damage-bar-side">
        {metrics.dps != null && (
          <span className="damage-bar-stat"><b>{fmt(metrics.dps)}</b> DPS</span>
        )}
        {metrics.ttk != null && (
          <span className="damage-bar-stat damage-bar-stat--wide">
            kills in <b>{metrics.ttk < 10 ? metrics.ttk.toFixed(1) : fmt(metrics.ttk)}s</b>
          </span>
        )}
        {targetName && (
          <span className="damage-bar-stat damage-bar-stat--wide">vs {targetName}</span>
        )}
        <button className="damage-bar-details" onClick={onOpenDetails}>Details</button>
      </div>
    </div>
  );
}
