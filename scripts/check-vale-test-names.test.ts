import { expect, test } from "bun:test";
import { restates, violations } from "./check-vale-test-names";

test.each<{ name: string; input: string; expected: boolean }>([
  {
    name: "flags The cache fills up, so the old entries get evicted.",
    input: "The cache fills up, so the old entries get evicted.\n",
    expected: true,
  },
  {
    name: "allows So the next step",
    input: "So the next step is to fix the test.",
    expected: true,
  },
  { name: "flags please", input: "Please read the file first.", expected: true },
  { name: "keeping as-is", input: "keeping as-is", expected: true },
  { name: "flags It’s wired up", input: "It’s wired up, no config is required.", expected: true },
  { name: "flags a hedge", input: "We could maybe try it.", expected: false },
  { name: "allows a count after a comparator", input: "Fail at >= 3 of 5.", expected: false },
  { name: "flags fills the cache", input: "The cache fills up.", expected: false },
  { name: "flags", input: "flags", expected: false },
  { name: "flags the pass", input: "The passage is long.", expected: false },
])("$name", ({ name, input, expected }) => {
  expect(restates(name, input)).toBe(expected);
});

test("reports path and name per restating case", () => {
  const rule = {
    tests: [
      { name: "flags Both pass on main.", input: "Both pass on main." },
      { name: "flags a suite verdict", input: "CI is green." },
    ],
  };
  expect(violations("plugins/writing/styles/Writing/X.yml", rule)).toEqual([
    "plugins/writing/styles/Writing/X.yml:flags Both pass on main.",
  ]);
});

test("a rule without tests has no violations", () => {
  expect(violations("X.yml", {})).toEqual([]);
});
