// Primitives shared by the three parsers. Every value they read comes out of a
// live page capture, so each one has to survive a page caught mid-render.

// A field the page did not supply arrives as undefined when the capture group
// went unmatched and as an empty string when it matched nothing. Both mean absent.
export function present(value: string | null | undefined): value is string {
  return value != null && value !== "";
}

/** Whole part of a formatted number: thousands-grouped, or plain when ungrouped. */
const DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;

/**
 * Refuses to end a number on a half-written separator.
 *
 * This is what keeps a capture taken mid-render from parsing. A looser
 * `\d[\d,]*` accepts the `$1,` or `$1,2` of a `$1,234` still being written, and
 * `replaceAll(",", "")` turns either into a real $1 or $12. Requiring every
 * group after a separator to be whole makes those fail instead.
 *
 * A comma that opens a list item rather than a thousands group is followed by a
 * space, as in an accessible name like `$234, cheapest price`, so that one ends
 * the number instead of rejecting it. The guard reaches partly written
 * separators only. Nothing distinguishes a page that has rendered `$1` of
 * `$1,234` from a genuine `$1`.
 */
const WHOLE = String.raw`(?![\d.])(?!,(?! ))`;

/**
 * A money amount: whole units, or exactly the two decimal places these pages
 * use for cents. Allowing a shorter tail would read the `$249.9` of a
 * half-written `$249.99` as $249.90.
 */
export const AMOUNT = `${DIGITS}(?:\\.\\d{2})?${WHOLE}`;

/** United's abbreviated mileage, as in `22.5k`. The `k` itself sits outside this. */
export const THOUSANDS = `${DIGITS}(?:\\.\\d{1,2})?${WHOLE}`;

/** Converts digits captured by {@link AMOUNT}. */
export function amount(digits: string | null | undefined): number | null {
  if (!present(digits)) return null;
  const value = Number(digits.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}
