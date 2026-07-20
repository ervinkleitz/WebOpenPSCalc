import { useState, ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  highlight?: boolean;
  // Reorder controls — injected by PanelDeck. When reorderable is set, small
  // up/down arrows appear in the header (they don't toggle the collapse).
  reorderable?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export default function Panel({
  eyebrow, title, children, defaultOpen = true, collapsible = true, highlight = false,
  reorderable = false, canMoveUp = false, canMoveDown = false, onMoveUp, onMoveDown,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;

  return (
    <div className={`panel${highlight ? " panel-highlight" : ""}`}>
      <h2
        className={collapsible ? "panel-header" : undefined}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? isOpen : undefined}
      >
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <span className="panel-title">{title}</span>
        {reorderable && (
          <span className="panel-reorder" onClick={(e) => e.stopPropagation()} title={`Reorder — move the ${title} section`}>
            <button
              type="button" className="panel-reorder-btn"
              disabled={!canMoveUp}
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
              title={`Move the ${title} section up`} aria-label={`Move ${title} section up`}
            >▲</button>
            <button
              type="button" className="panel-reorder-btn"
              disabled={!canMoveDown}
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
              title={`Move the ${title} section down`} aria-label={`Move ${title} section down`}
            >▼</button>
          </span>
        )}
        {collapsible && <span className={`panel-chevron${isOpen ? " open" : ""}`}>▾</span>}
      </h2>
      {isOpen && <div className="panel-content">{children}</div>}
    </div>
  );
}
