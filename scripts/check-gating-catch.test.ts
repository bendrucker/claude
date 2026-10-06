import { expect, test } from "bun:test";
import { uncaught } from "./check-gating-catch";

const hook = (name: string, hasCatch: boolean) => ({
  module: "../mod/register.ts",
  hook: name,
  hasCatch,
});

test.each<{
  name: string;
  contents: Parameters<typeof uncaught>[0]["contents"];
  expected: string[];
}>([
  { name: "no hooks module", contents: [{}], expected: [] },
  {
    name: "every hook caught",
    contents: [{ gatingHooks: [hook("tool.call", true)] }],
    expected: [],
  },
  {
    name: "one uncaught among caught",
    contents: [{ gatingHooks: [hook("tool.check", true), hook("tool.call{tool=Bash}", false)] }],
    expected: ["../mod/register.ts: tool.call{tool=Bash}"],
  },
])("$name", ({ contents, expected }) => {
  expect(uncaught({ contents })).toEqual(expected);
});
