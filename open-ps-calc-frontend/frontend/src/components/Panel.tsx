import { useState, ReactNode } from "react";

interface PanelProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  highlight?: boolean;
  /**
   * Stable name for this panel, emitted as `data-panel`. The editor pins each panel
   * to a column with it (see "COLUMN PINNING" in styles.css). Deliberately NOT
   * nth-child: Pet only exists on Payon Stories and the manual-target panel only in
   * custom-target mode, so position is not a reliable identifier.
   */
  id?: string;
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
  eyebrow, title, children, defaultOpen = true, collapsible = true, highlight = false, summary, id,
}: PanelProps) {
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    const stored = readState()[title];
    return typeof stored === "boolean" ? stored : defaultOpen;
  });

  // Written ONLY when the player toggles the panel, never on mount.
  //
  // This started as an effect keyed on `open`, which also fired on first render and
  // so wrote the DEFAULT as though it were a decision. That quietly broke the one
  // panel whose default is dynamic: "Start from a template" opens itself on an empty
  // build, the effect recorded that as a preference, and from then on it stayed open
  // over a finished build forever — a menu for a choice already made, which is
  // exactly what defaultOpen was computed to avoid. A remembered state has to come
  // from a click.
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      const all = readState();
      all[title] = next;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage unavailable — the panel still works, it just forgets */ }
  };

  const isOpen = !collapsible || open;

  return (
    <div className={`panel${highlight ? " panel-highlight" : ""}`} data-panel={id}>
      <h2
        className={collapsible ? "panel-header" : undefined}
        onClick={collapsible ? toggle : undefined}
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
