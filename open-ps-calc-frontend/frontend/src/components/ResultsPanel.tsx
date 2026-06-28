import DamageSummary from "./DamageSummary";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
}

export default function ResultsPanel({ open, onClose, calcResult, calculating, error }: Props) {
  if (!open) return null;

  return (
    <div className="results-panel">
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
