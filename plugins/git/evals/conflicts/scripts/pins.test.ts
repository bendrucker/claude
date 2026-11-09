import { expect, test } from "bun:test";
import { extractPins } from "./pins";

test.each<{ name: string; pattern: string; want: [string, string][] }>([
  { name: "bun lock key", pattern: '"commander@14.0.2"', want: [["commander", "14.0.2"]] },
  {
    name: "scoped bun lock key",
    pattern: '"@types/node@22.1.0"',
    want: [["@types/node", "22.1.0"]],
  },
  {
    name: "npm lock entry",
    pattern: '"node_modules/xml2js": \\{\\s*"version": "0\\.6\\.2"',
    want: [["xml2js", "0.6.2"]],
  },
  { name: "range is not a pin", pattern: '"commander": "~14.0.0"', want: [] },
])("$name", ({ pattern, want }) => {
  expect(extractPins(pattern, "case/grader.md").map((pin) => [pin.name, pin.version])).toEqual(
    want,
  );
});
