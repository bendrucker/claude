import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { due, objectKey, parseTarget, STOP_INTERVAL_MS, sessionFiles } from "./upload";

describe("parseTarget", () => {
  test("uses the regional endpoint when a region is set", () => {
    expect(parseTarget("s3://bucket/transcripts/cloud/", "us-east-1")).toEqual({
      base: "https://bucket.s3.us-east-1.amazonaws.com",
      prefix: "transcripts/cloud",
    });
  });

  test("falls back to the global endpoint and an empty prefix", () => {
    expect(parseTarget("s3://bucket", undefined)).toEqual({
      base: "https://bucket.s3.amazonaws.com",
      prefix: "",
    });
  });

  test("rejects a non-s3 URL", () => {
    expect(parseTarget("https://bucket.s3.amazonaws.com/x", undefined)).toBeUndefined();
  });
});

describe("sessionFiles", () => {
  test("includes the subagents directory beside the transcript", async () => {
    const root = mkdtempSync(join(tmpdir(), "upload-"));
    const transcript = join(root, "abc.jsonl");
    await Bun.write(transcript, "{}\n");
    mkdirSync(join(root, "abc", "subagents"), { recursive: true });
    await Bun.write(join(root, "abc", "subagents", "agent-1.jsonl"), "{}\n");
    await Bun.write(join(root, "abc", "subagents", "agent-1.meta.json"), "{}");
    expect(sessionFiles(transcript)).toEqual([
      [transcript, "abc.jsonl"],
      [join(root, "abc", "subagents", "agent-1.jsonl"), "abc/subagents/agent-1.jsonl"],
    ]);
  });

  test("is just the transcript when there are no subagents", () => {
    const root = mkdtempSync(join(tmpdir(), "upload-"));
    expect(sessionFiles(join(root, "abc.jsonl"))).toEqual([[join(root, "abc.jsonl"), "abc.jsonl"]]);
  });

  test("keys the session's mod events under mod-events/", async () => {
    const root = mkdtempSync(join(tmpdir(), "upload-"));
    const events = join(root, "mod-events", "abc");
    await Bun.write(join(events, "plan.1.0.jsonl"), "{}\n");
    expect(sessionFiles(join(root, "abc.jsonl"), events)).toEqual([
      [join(root, "abc.jsonl"), "abc.jsonl"],
      [join(events, "plan.1.0.jsonl"), "mod-events/plan.1.0.jsonl"],
    ]);
  });

  test("skips a missing mod-events directory", () => {
    const root = mkdtempSync(join(tmpdir(), "upload-"));
    expect(sessionFiles(join(root, "abc.jsonl"), join(root, "none"))).toHaveLength(1);
  });
});

test("objectKey nests files under the session", () => {
  const target = { base: "https://b", prefix: "transcripts/cloud" };
  expect(objectKey(target, "cse_1", "abc/subagents/agent-1.jsonl")).toBe(
    "transcripts/cloud/cse_1/abc/subagents/agent-1.jsonl",
  );
});

test("due throttles Stop and never SessionEnd", () => {
  expect(due("Stop", 0, STOP_INTERVAL_MS)).toBe(true);
  expect(due("Stop", 1, STOP_INTERVAL_MS)).toBe(false);
  expect(due("SessionEnd", 1, STOP_INTERVAL_MS)).toBe(true);
});
