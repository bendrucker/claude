import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localFiles, plan, s3Location, uploadStaleness } from "./pull";

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

test("keys local mod events as the bucket does", async () => {
  const host = mkdtempSync(join(tmpdir(), "pull-"));
  await Bun.write(join(host, "projects", "cse_1", "a.jsonl"), "12");
  await Bun.write(join(host, "mod-events", "cse_1", "plan.1.0.jsonl"), "123");
  expect(localFiles(join(host, "projects"), join(host, "mod-events"))).toEqual(
    new Map([
      ["cse_1/a.jsonl", 2],
      ["cse_1/mod-events/plan.1.0.jsonl", 3],
    ]),
  );
});

test("reads a host with no mod events", () => {
  const host = mkdtempSync(join(tmpdir(), "pull-"));
  expect(localFiles(join(host, "projects"), join(host, "mod-events"))).toEqual(new Map());
});

test("s3Location splits the bucket from a slash-terminated prefix", () => {
  expect(s3Location("s3://bucket/sessions/raw/cloud/")).toEqual({
    bucket: "bucket",
    prefix: "sessions/raw/cloud/",
  });
  expect(s3Location("s3://bucket/")).toEqual({ bucket: "bucket", prefix: "" });
  expect(s3Location("/Users/me/.claude/projects")).toBeUndefined();
});

test("uploadStaleness keys on the newest object, not the oldest", () => {
  const objects = [
    { key: "cse_old/a.jsonl", size: 1, lastModified: DAY },
    { key: "cse_new/a.jsonl", size: 1, lastModified: 8 * DAY },
  ];
  expect(uploadStaleness(objects, 10 * DAY, 3)).toEqual({ newest: 8 * DAY, stale: false });
  expect(uploadStaleness(objects, 11 * DAY + 1, 3)).toEqual({ newest: 8 * DAY, stale: true });
});

test("uploadStaleness holds a host at exactly the threshold fresh", () => {
  const objects = [{ key: "cse/a.jsonl", size: 1, lastModified: DAY }];
  expect(uploadStaleness(objects, 4 * DAY, 3).stale).toBe(false);
});

test("uploadStaleness flags a prefix that never received an upload", () => {
  expect(uploadStaleness([], 10 * DAY, 3)).toEqual({ newest: undefined, stale: true });
});
