import { useState, ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  highlight?: boolean;
}

export default function Panel({ eyebrow, title, children, defaultOpen = true, collapsible = true, highlight = false }: PanelProps) {
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
        {collapsible && <span className={`panel-chevron${isOpen ? " open" : ""}`}>▾</span>}
      </h2>
      {isOpen && <div className="panel-content">{children}</div>}
    </div>
  );
}
