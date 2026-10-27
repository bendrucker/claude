import { describe, expect, it } from "bun:test";
import { itemsAfter } from "./counted-lead-in";

describe("itemsAfter", () => {
  it.each<{ rest: string; items: number }>([
    { rest: "\n\n- a\n- b\n\n- c\n\nAfter the list.", items: 3 },
    { rest: "\n1. a\n   continued\n2. b\n   - nested\n3. c", items: 3 },
    { rest: "\n\n| Arm | Wall |\n| --- | ---: |\n| a | 1 |\n| b | 2 |", items: 2 },
    { rest: " a, b, and c.", items: 3 },
    { rest: " a, b and c. Then more.", items: 3 },
    { rest: " Clay, Webster, and Calhoun, the compromise held.", items: 3 },
    { rest: "     ,     , and     .", items: 3 },
    { rest: " a (b, c), and d.", items: 2 },
    { rest: " the cache never warms.", items: 1 },
    { rest: "\n\nA paragraph follows.", items: 0 },
  ])("$rest -> $items", ({ rest, items }) => {
    expect(itemsAfter(rest)).toBe(items);
  });
});
