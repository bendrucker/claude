import { expect, test } from "bun:test";
import { plan } from "./pull";

const DAY = 86_400_000;

test("keeps a session by its newest upload and fetches only what grew", () => {
  const objects = [
    { key: "cse_old/a.jsonl", size: 10, lastModified: DAY },
    { key: "cse_live/a.jsonl", size: 10, lastModified: DAY },
    { key: "cse_live/a/subagents/agent-1.jsonl", size: 5, lastModified: 9 * DAY },
    { key: "cse_done/a.jsonl", size: 7, lastModified: 9 * DAY },
  ];
  const local = new Map([
    ["cse_old/a.jsonl", 10],
    ["cse_live/a.jsonl", 10],
    ["cse_done/a.jsonl", 7],
  ]);
  expect(plan(objects, local, ["cse_old", "cse_live", "cse_done", "cse_gone"], 5 * DAY)).toEqual({
    fetch: ["cse_live"],
    drop: ["cse_old", "cse_gone"],
  });
});

test("fetches a new session and drops nothing when the bucket is empty of locals", () => {
  const objects = [{ key: "cse_new/a.jsonl", size: 3, lastModified: 9 * DAY }];
  expect(plan(objects, new Map(), [], 5 * DAY)).toEqual({ fetch: ["cse_new"], drop: [] });
});
