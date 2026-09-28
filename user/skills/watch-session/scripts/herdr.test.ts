import { expect, test } from "bun:test";
import { errorCode } from "./herdr";

const envelope = JSON.stringify({ error: { code: "agent_not_ready" } });

test.each<{ name: string; stderr: string; expected: string | undefined }>([
  { name: "envelope alone", stderr: envelope, expected: "agent_not_ready" },
  {
    name: "envelope behind other output",
    stderr: `starting\n${envelope}\n`,
    expected: "agent_not_ready",
  },
  { name: "plain text", stderr: "herdr: no such pane", expected: undefined },
])("$name", ({ stderr, expected }) => {
  expect(errorCode(stderr)).toBe(expected);
});
