import { forwardRef } from "react";
import DamageSummary from "./DamageSummary";
import CompareView, { summaryMetrics, type ComparePin } from "./CompareView";
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
  onClearPins: () => void;
}

const ResultsPanel = forwardRef<HTMLDivElement, Props>(
  ({ open, onClose, calcResult, calculating, error, forceProcs, onToggleForceProcs, pins, onPin, onRemovePin, onLoadPin, onClearPins }, ref) => {
    if (!open) return null;
    const live = summaryMetrics(calcResult);
    return (
      <div ref={ref} className="results-panel">
        <div className="results-panel-header">
          <h2>Damage breakdown</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="results-panel-body">
          {(live || pins.length > 0) && (
            <CompareView live={live} pins={pins} canPin={!!live} onPin={onPin} onRemove={onRemovePin} onLoad={onLoadPin} onClear={onClearPins} />
          )}
          {live && (
            <div className="results-flow-divider">
              <span>{pins.length > 0 ? "Current build" : "Full breakdown"}</span>
            </div>
          )}
          <DamageSummary
            calcResult={calcResult}
            calculating={calculating}
            error={error}
            forceProcs={forceProcs}
            onToggleForceProcs={onToggleForceProcs}
          />
          {calcResult && !calculating && !error && (
            <div className="kofi-results-card">
              <span className="kofi-results-text">This calc runs on milk tea —</span>
              <a className="kofi-results-link" href="https://ko-fi.com/I7A322JOTP" target="_blank" rel="noreferrer" onClick={() => statsApi.trackDonateClick("results")}>buy me one 🍵</a>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ResultsPanel.displayName = "ResultsPanel";
export default ResultsPanel;
