import { describe, expect, test } from "bun:test";

import { AMOUNT, amount } from "./page-text";

// A page read mid-render hands the parsers a half-written number. The risk is
// not a parse failure but a plausible one: `$1,` losing its separator and
// arriving downstream as a real $1 fare.

const ANYWHERE = new RegExp(String.raw`\$(${AMOUNT})`);

function price(text: string): number | null {
  return amount(ANYWHERE.exec(text)?.[1]);
}

describe("AMOUNT", () => {
  const CASES: [string, number | null][] = [
    ["$5", 5],
    ["$234", 234],
    ["$1,234", 1234],
    ["$1,234,567", 1234567],
    // United writes taxes with cents and miles with a fractional thousand.
    ["$5.60", 5.6],
    // Ungrouped four-digit amounts appear where the page omits the separator.
    ["$22500", 22500],
    // Truncated mid-format. Each of these parsed as a real fare before.
    ["$1,", null],
    ["$1,2", null],
    ["$1,23", null],
    ["$12,34", null],
    ["$5.", null],
    // A cents field caught one digit in would otherwise read as $249.90.
    ["$249.9", null],
    ["$", null],
    ["$,", null],
  ];

  test.each(CASES)("%s parses as %p", (text, expected) => {
    expect(price(text)).toBe(expected);
  });

  test("a comma opening a list item ends the amount rather than voiding it", () => {
    // Grid cells carry their tier and dates in the same accessible name, so the
    // separator that follows a legitimate price is a comma and a space.
    expect(price('button "$234, cheapest price, Nov 8 to Nov 13"')).toBe(234);
    expect(price('button "$1,234, cheapest price"')).toBe(1234);
  });
});

describe("amount", () => {
  test("absent input stays absent rather than becoming zero", () => {
    // `Number("")` is 0, which is what made an unparsed price read as a real one.
    expect(amount(undefined)).toBeNull();
    expect(amount(null)).toBeNull();
    expect(amount("")).toBeNull();
  });
});
