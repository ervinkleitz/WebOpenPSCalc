import { useEffect, useState, ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  highlight?: boolean;
  /**
   * What this panel holds, shown in the header while it is CLOSED. The point of a
   * collapsed panel is that you can still tell whether you have set anything in it,
   * so a summary has to name what is there ("Blessing 10 · Inc AGI 10 · +2 more")
   * rather than count it. Omit it and the header just closes, which is right for a
   * panel whose contents are not summarisable in a few words.
   */
  summary?: ReactNode;
}

/**
 * A panel remembers whether you left it open.
 *
 * The editor is eleven panels tall and every visit reset all of them, so anyone who
 * had closed the ones they do not use — a Wizard has no interest in Forge or Ammo —
 * paid that cost again on the next page load. The state is per panel and per browser,
 * keyed by title so it survives the panels being reordered or renumbered.
 *
 * `defaultOpen` is the state for a panel this browser has never been told about; once
 * the player has opened or closed it by hand, their choice wins. That ordering matters
 * for the template panel, which opens itself only on an empty build: a player who
 * closes it should not have it spring open again the next time they start fresh.
 */
const KEY = "opscalc.panels";

const readState = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

export default function Panel({
  eyebrow, title, children, defaultOpen = true, collapsible = true, highlight = false, summary,
}: PanelProps) {
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    const stored = readState()[title];
    return typeof stored === "boolean" ? stored : defaultOpen;
  });

  // Written on change rather than on every render, and tolerant of storage being
  // unavailable (private windows, blocked site data) — the panel still works, it
  // just forgets.
  useEffect(() => {
    if (!collapsible) return;
    try {
      const all = readState();
      if (all[title] === open) return;
      all[title] = open;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage unavailable — the panel simply will not remember */ }
  }, [open, title, collapsible]);

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
        {/* Only while closed: open, the panel says it all itself, and a summary
            beside the title would just be the same facts twice. */}
        {collapsible && !isOpen && summary && <span className="panel-summary">{summary}</span>}
        {collapsible && <span className={`panel-chevron${isOpen ? " open" : ""}`}>▾</span>}
      </h2>
      {isOpen && <div className="panel-content">{children}</div>}
    </div>
  );
}
