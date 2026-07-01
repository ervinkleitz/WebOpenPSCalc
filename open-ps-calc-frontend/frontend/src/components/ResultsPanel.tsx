import { forwardRef } from "react";
import DamageSummary from "./DamageSummary";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
}

const ResultsPanel = forwardRef<HTMLDivElement, Props>(
  ({ open, onClose, calcResult, calculating, error }, ref) => {
    if (!open) return null;
    return (
      <div ref={ref} className="results-panel">
        <div className="results-panel-header">
          <h2>Damage breakdown</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="results-panel-body">
          <DamageSummary calcResult={calcResult} calculating={calculating} error={error} />
        </div>
      </div>
    );
  }
);

ResultsPanel.displayName = "ResultsPanel";
export default ResultsPanel;
