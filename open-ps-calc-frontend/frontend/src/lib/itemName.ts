/**
 * itemName.ts — render an equipped item the way the game's client writes it.
 *
 * A player reads "+7 Double Boned Bloody Gladius" off their inventory; the editor used
 * to show "Gladius +7" with the cards listed separately underneath, so the two were
 * hard to match up at a glance. This builds the card half of that name.
 *
 * The REFINE is deliberately not here. It sits in the +N control immediately to the
 * left of the name in the editor, which reads as the same "+7 ..." line while staying
 * editable — putting it in both places printed it twice.
 *
 * THE ALGORITHM IS THE CLIENT'S, not an approximation of it. Transcribed from
 * roBrowser's DB/DBManager.js getItemName(), which is an open reimplementation of the
 * official client:
 *
 *   1. refine goes FIRST, as "+N " — here that is the +N control, not this string.
 *   2. walk the card slots in order; each card contributes one word.
 *   3. identical words collapse into one, counted: 2 -> "Double", 3 -> "Triple",
 *      4 -> "Quadruple". The collapse is by WORD, not by card id, which matters
 *      because different cards can share a word.
 *   4. words appear in the order their FIRST copy was found, not sorted.
 *
 * Two deliberate departures, both because this is an editor and not an inventory:
 *
 *   - The client stops at the first empty card slot, because in-game cards fill in
 *     order and a gap cannot exist. Here you can put a card in slot 2 and leave slot 1
 *     empty, so empty slots are SKIPPED instead; stopping would silently drop a card
 *     the build is actually being calculated with.
 *   - A word is only dropped for a card we have no entry for (every PS custom), which
 *     is what the client does with an unknown card too.
 *
 * Suffix cards ("of Champion") are a thing the client handles through a second table
 * and roBrowser does not implement at all. They are handled here, because ignoring
 * the table does not merely lose a word — it renders "of Champion Gladius".
 */

/** The parts of an item record this needs. Anything else on the record is ignored. */
export interface NameableItem {
  name: string;
  /** The word this card lends to its host, if it is a card the client names. */
  card_name?: string | null;
  /** True when that word follows the item name instead of preceding it. */
  card_name_after?: boolean;
}

const COUNT_WORD = ["", "Double ", "Triple ", "Quadruple "];

/** Collapse repeats into counted words, preserving first-appearance order. */
function collapse(words: string[]): string[] {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const w of words) {
    if (!count.has(w)) order.push(w);
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  // A fifth copy cannot happen — four slots is the hard maximum — but clamping beats
  // rendering "undefined Bloody" if one ever does.
  return order.map((w) => COUNT_WORD[Math.min(count.get(w)!, 4) - 1] + w);
}

/**
 * Build the display name.
 *
 * @param item   the host item, or null while its record is still loading
 * @param cards  the slotted cards in slot order; nulls are empty slots
 * @param fallback shown when the host's record has not arrived yet
 */
export function displayItemName(
  item: NameableItem | null | undefined,
  cards: (NameableItem | null | undefined)[],
  fallback: string,
): string {
  const base = item?.name ?? fallback;

  const before: string[] = [];
  const after: string[] = [];
  for (const card of cards) {
    const word = card?.card_name;
    if (!word) continue;
    (card.card_name_after ? after : before).push(word);
  }

  // Join with a space, not "": a count word carries its own trailing space ("Double ")
  // but the card word does not, so concatenating ran two cards together as
  // "Double BonedBloodyGladius".
  const pre = collapse(before).join(" ");
  const post = collapse(after).join(" ");

  return `${pre ? pre + " " : ""}${base}${post ? " " + post : ""}`;
}
