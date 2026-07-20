import { ReactElement, cloneElement, isValidElement } from "react";

export interface PanelDeckItem {
  id: string;
  /** The <Panel> element, or null when the panel is not shown for this build. */
  node: ReactElement<Record<string, unknown>> | null;
}

interface PanelDeckProps {
  /** User-preferred panel id order (may include ids not currently visible). */
  order: string[];
  items: PanelDeckItem[];
  /** Swap the given panel with its nearest visible neighbour in `dir` (-1 up, +1 down). */
  onMove: (id: string, dir: -1 | 1) => void;
}

/**
 * Renders build-editor panels in the user's chosen order and injects up/down
 * reorder controls into each panel's header. Panels whose node is null (hidden
 * for the current build, e.g. Pet on non-PS servers) are skipped; any present
 * panel missing from `order` is appended so nothing ever disappears.
 */
export default function PanelDeck({ order, items, onMove }: PanelDeckProps) {
  const present = items.filter((it) => isValidElement(it.node));
  const byId = new Map(present.map((it) => [it.id, it]));

  const orderedIds = order.filter((id) => byId.has(id));
  for (const it of present) {
    if (!orderedIds.includes(it.id)) orderedIds.push(it.id);
  }

  const last = orderedIds.length - 1;
  return (
    <>
      {orderedIds.map((id, idx) =>
        cloneElement(byId.get(id)!.node as ReactElement<Record<string, unknown>>, {
          key: id,
          reorderable: true,
          canMoveUp: idx > 0,
          canMoveDown: idx < last,
          onMoveUp: () => onMove(id, -1),
          onMoveDown: () => onMove(id, 1),
        })
      )}
    </>
  );
}
