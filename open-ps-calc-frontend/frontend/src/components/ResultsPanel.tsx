import { forwardRef } from "react";
import DamageSummary from "./DamageSummary";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
  forceProcs: boolean;
  onToggleForceProcs: () => void;
}

const ResultsPanel = forwardRef<HTMLDivElement, Props>(
  ({ open, onClose, calcResult, calculating, error, forceProcs, onToggleForceProcs }, ref) => {
    if (!open) return null;
    return (
      <div ref={ref} className="results-panel">
        <div className="results-panel-header">
          <h2>Damage breakdown</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="results-panel-body">
          <DamageSummary
            calcResult={calcResult}
            calculating={calculating}
            error={error}
            forceProcs={forceProcs}
            onToggleForceProcs={onToggleForceProcs}
          />
          {calcResult && !calculating && !error && (
            <div className="kofi-results-card">
              <span className="kofi-results-text">Found this useful? Help keep it running.</span>
              <a className="kofi-btn" href="https://ko-fi.com/I7A322JOTP" target="_blank" rel="noreferrer">
                🍵 Buy me a milk tea
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ResultsPanel.displayName = "ResultsPanel";
export default ResultsPanel;
