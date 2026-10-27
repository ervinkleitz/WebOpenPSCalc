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

  // Monster mode only — a custom target has no HP to divide by, and then every
  // one of these is null and the stat simply isn't shown.
  const hasRange = !metrics.isInstaKill && metrics.hitsBest != null && metrics.hitsWorst != null;
  const killValue = hasRange
    ? (metrics.hitsBest === metrics.hitsWorst
        // One number when the damage roll cannot change the answer. "2–2 hits to
        // kill" is noise, and on a phone it is noise in the space the number needs.
        ? `${metrics.hitsBest}`
        : `${metrics.hitsBest}–${metrics.hitsWorst}`)
    : metrics.hitsToKill != null ? `${metrics.hitsToKill}` : null;
  // "1 hits to kill" is the kind of thing that makes a tool look unfinished, and a
  // Poring dies in one, so this is the common case rather than an edge one.
  const unit = metrics.noRateHit || metrics.isInstaKill ? "cast" : "hit";
  const killLabel = killValue == null ? null
    : `${unit}${killValue === "1" ? "" : "s"} to kill`;

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
        {/* First in the row, and NOT --wide, so it survives on a phone: asked for by
            the maintainer 2026-10-26 as "the stat I care about the most". The numbers
            are the results panel's own (summaryMetrics), not a second calculation, so
            the two cannot disagree — and the wording follows the panel: a range of
            hits normally, a single count of CASTS for a skill with no repeat rate or
            an instant-kill roll. */}
        {killLabel && (
          <span className="damage-bar-stat">
            <b>{killValue}</b> {killLabel}
          </span>
        )}
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
