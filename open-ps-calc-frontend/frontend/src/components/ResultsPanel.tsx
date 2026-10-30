import { forwardRef, useState } from "react";
import DamageSummary from "./DamageSummary";
import CompareView, { summaryMetrics, type ComparePin } from "./CompareView";
import SurvivabilityView from "./SurvivabilityView";
import { statsApi } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
  forceProcs: boolean;
  onToggleForceProcs: () => void;
  pins: ComparePin[];
  onPin: () => void;
  onRemovePin: (id: string) => void;
  onLoadPin: (pin: ComparePin) => void;
  tuAttempt?: number;
  onTuAttempt?: (n: number) => void;
  onClearPins: () => void;
  onOpenTip: () => void;
}

const ResultsPanel = forwardRef<HTMLDivElement, Props>(
  ({ open, onClose, calcResult, calculating, error, forceProcs, onToggleForceProcs, pins, onPin, onRemovePin, onLoadPin, onClearPins, onOpenTip, tuAttempt, onTuAttempt }, ref) => {
    // Comparison starts folded away. It used to open the panel with a block of
    // instructions above the build you had just calculated, so the first thing you
    // read was how to use a feature you had not asked for.
    const [compareOpen, setCompareOpen] = useState(false);
    if (!open) return null;
    const live = summaryMetrics(calcResult);
    return (
      <div ref={ref} className="results-panel">
        <div className="results-panel-header">
          <h2>Damage breakdown</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="results-panel-body">
          {/* Handed to DamageSummary rather than rendered after it, so it can sit
              BESIDE the step table on a wide screen. The two read as one answer:
              what you do to it, and what it does back. */}
          <DamageSummary
            calcResult={calcResult}
            calculating={calculating}
            error={error}
            forceProcs={forceProcs}
            onToggleForceProcs={onToggleForceProcs}
            tuAttempt={tuAttempt}
            onTuAttempt={onTuAttempt}
            aside={!calculating && !error ? (
              calcResult?.incoming ? (
                <SurvivabilityView incoming={calcResult.incoming} />
              ) : calcResult?.incoming_note ? (
                /* No incoming lines, but we know why — say it rather than rendering
                   nothing. A silently missing panel is what made copying a monster
                   into a custom target feel broken. */
                <div className="surv-empty">
                  <span className="surv-empty-title">Survivability</span>
                  <span className="surv-empty-msg">{calcResult.incoming_note}</span>
                </div>
              ) : null
            ) : null}
            actions={(live || pins.length > 0) && !calculating && !error ? (
              <>
                <button className="cmp-pin-btn" onClick={onPin} disabled={!live}>Pin build</button>
                <button
                  className="ds-compare-toggle"
                  aria-expanded={compareOpen}
                  onClick={() => setCompareOpen((o) => !o)}
                >
                  Compare builds ({pins.length})
                  <span className="ds-compare-caret" aria-hidden="true">{compareOpen ? "⌃" : "⌄"}</span>
                </button>
              </>
            ) : null}
          />
          {compareOpen && (live || pins.length > 0) && (
            <CompareView live={live} pins={pins} canPin={!!live} hidePin onPin={onPin} onRemove={onRemovePin} onLoad={onLoadPin} onClear={onClearPins} />
          )}
          {calcResult && !calculating && !error && (
            <div className="support-card">
              <span className="support-card-emoji">🍵</span>
              <div className="support-card-msg">
                <span className="support-card-head">Enjoying the calc?</span>
                <span className="support-card-sub">A free fan project for the Payon Stories community — chip in to help cover hosting costs and keep it running.</span>
              </div>
              <button
                className="support-card-cta"
                onClick={() => { statsApi.trackDonateClick("results"); onOpenTip(); }}
              >
                Chip in
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ResultsPanel.displayName = "ResultsPanel";
export default ResultsPanel;
