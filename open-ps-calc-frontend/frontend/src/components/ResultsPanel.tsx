import { useEffect, useRef } from "react";
import DamageSummary from "./DamageSummary";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
  calcTrigger: number;
}

export default function ResultsPanel({ open, onClose, calcResult, calculating, error, calcTrigger }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [calcTrigger]);

  if (!open) return null;

  return (
    <div className="results-panel" ref={ref}>
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
