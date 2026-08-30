// Primitives shared by the three parsers. Every value they read comes out of a
// live page capture, so each one has to survive a page caught mid-render.

// A field the page did not supply arrives as undefined when the capture group
// went unmatched and as an empty string when it matched nothing. Both mean absent.
export function present(value: string | null | undefined): value is string {
  return value != null && value !== "";
}

/**
 * Source fragment matching a formatted amount: thousands-grouped or plain
 * digits, with an optional decimal tail.
 *
 * The trailing lookaheads are the point of it. A capture taken mid-render holds
 * amounts like `$1,` or `$1,2`, which a looser `\d[\d,]*` accepts and
 * `replaceAll(",", "")` then turns into a real $1 or $12. Requiring every group
 * after a separator to be whole makes a half-written amount fail to parse
 * instead of arriving downstream as a plausible price.
 *
 * A comma that opens a list item rather than a thousands group is followed by a
 * space, as in an accessible name like `$234, cheapest price`, so that one ends
 * the amount instead of rejecting it. The guard reaches partly written
 * separators only. Nothing distinguishes a page that has rendered `$1` of
 * `$1,234` from a genuine `$1`.
 */
export const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d.])(?!,(?! ))`;

/** Converts digits captured by {@link AMOUNT}. */
export function amount(digits: string | null | undefined): number | null {
  if (!present(digits)) return null;
  const value = Number(digits.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}
