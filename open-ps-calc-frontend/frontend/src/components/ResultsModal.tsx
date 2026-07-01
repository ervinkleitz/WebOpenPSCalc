import { useEffect } from "react";
import DamageSummary from "./DamageSummary";

interface Props {
  open: boolean;
  onClose: () => void;
  calcResult: any;
  calculating: boolean;
  error: string;
  forceProcs?: boolean;
  onToggleForceProcs?: () => void;
}

export default function ResultsModal({ open, onClose, calcResult, calculating, error, forceProcs = false, onToggleForceProcs = () => {} }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card results-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Damage breakdown</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <DamageSummary calcResult={calcResult} calculating={calculating} error={error} forceProcs={forceProcs} onToggleForceProcs={onToggleForceProcs} />
        </div>
      </div>
    </div>
  );
}
