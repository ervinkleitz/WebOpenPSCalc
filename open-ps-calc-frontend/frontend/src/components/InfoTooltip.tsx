import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function InfoTooltip({ children }: Props) {
  return (
    <span className="info-tooltip" tabIndex={0} aria-label="About this calculator">
      <span className="info-tooltip-icon" aria-hidden="true">i</span>
      <span className="info-tooltip-bubble">{children}</span>
    </span>
  );
}
