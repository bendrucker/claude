import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Failure,
  type FailureKind,
  due,
  failureKind,
  failureRecord,
  objectKey,
  parseTarget,
  recordFailure,
  STOP_INTERVAL_MS,
  sessionFiles,
  unreported,
  uploadFiles,
} from "./upload";

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

describe("uploadFiles", () => {
  async function fixture(): Promise<[string, string][]> {
    const root = mkdtempSync(join(tmpdir(), "upload-"));
    await Bun.write(join(root, "a.jsonl"), "{}\n");
    await Bun.write(join(root, "b.jsonl"), "{}\n");
    await Bun.write(join(root, "c.jsonl"), "{}\n");
    return [
      [join(root, "a.jsonl"), "a.jsonl"],
      [join(root, "b.jsonl"), "b.jsonl"],
      [join(root, "c.jsonl"), "c.jsonl"],
    ];
  }

  test("reports an HTTP error status and a thrown fetch, keeping their old sizes", async () => {
    const files = await fixture();
    const sizes: Record<string, number> = {};
    const result = await uploadFiles(
      files,
      (rel) => `https://bucket/secret-prefix/${rel}`,
      sizes,
      (url) => {
        if (url.endsWith("a.jsonl")) return Promise.resolve(new Response(null, { status: 403 }));
        if (url.endsWith("b.jsonl")) {
          return Promise.reject(
            Object.assign(new Error(`Unable to connect to ${url}`), { code: "ConnectionRefused" }),
          );
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    );
    expect(result).toEqual({
      attempted: 3,
      failures: [
        { file: "a.jsonl", status: 403 },
        { file: "b.jsonl", error: "ConnectionRefused" },
      ],
    });
    expect(Object.keys(sizes)).toEqual(files.slice(2).map(([file]) => file));
  });

  test("skips files that did not grow", async () => {
    const files = await fixture();
    const sizes = Object.fromEntries(files.map(([file]) => [file, 3]));
    const result = await uploadFiles(
      files,
      (rel) => rel,
      sizes,
      () => Promise.reject(new Error("unreachable")),
    );
    expect(result).toEqual({ attempted: 0, failures: [] });
  });
});

describe("failure events", () => {
  const failures = [
    { file: "a.jsonl", status: 403 },
    { file: "a/subagents/agent-1.jsonl", status: 403 },
    { file: "mod-events/plan.1.0.jsonl", error: "ConnectionRefused" },
  ];
  const at = new Date("2026-11-21T08:00:00.123Z");

  test("records a WARN session-upload.upload with the kind, statuses, and failed count", () => {
    expect(failureRecord("Stop", 4, failures, "abc", at)).toEqual({
      timestamp: "2026-11-21T08:00:00.123Z",
      severity_text: "WARN",
      severity_number: 13,
      event_name: "session-upload.upload",
      attributes: {
        kind: "http",
        message: "some PUTs returned an HTTP error",
        hook: "Stop",
        attempted: 4,
        failed: 3,
        statuses: [403],
        failures,
        "session.id": "abc",
      },
      resource: { "service.name": "claude-code", "claude_code.surface": "cloud" },
      scope: { name: "session-upload" },
    });
  });

  test("appends to the session's mod-events directory, where the index and the next upload find it", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "upload-")), "mod-events", "abc");
    const record = failureRecord("SessionEnd", 1, failures.slice(0, 1), "abc", at);
    await recordFailure(dir, record);
    await recordFailure(dir, record);
    expect(readdirSync(dir)).toEqual(["session-upload.2026-11-21.jsonl"]);
    expect(await Bun.file(join(dir, "session-upload.2026-11-21.jsonl")).text()).toBe(
      `${JSON.stringify(record)}\n`.repeat(2),
    );
    expect(sessionFiles(join(dir, "..", "..", "abc.jsonl"), dir).map(([, rel]) => rel)).toContain(
      "mod-events/session-upload.2026-11-21.jsonl",
    );
  });
});

describe("failureKind", () => {
  test.each<{ name: string; attempted: number; failures: Failure[]; kind: FailureKind }>([
    {
      name: "403 on every file is unsigned",
      attempted: 2,
      failures: [
        { file: "a.jsonl", status: 403 },
        { file: "b.jsonl", status: 403 },
      ],
      kind: "unsigned",
    },
    {
      name: "403 on some files is http",
      attempted: 3,
      failures: [
        { file: "a.jsonl", status: 403 },
        { file: "b.jsonl", status: 403 },
      ],
      kind: "http",
    },
    {
      name: "another status on every file is http",
      attempted: 1,
      failures: [{ file: "a.jsonl", status: 500 }],
      kind: "http",
    },
    {
      name: "thrown fetches alone are network",
      attempted: 2,
      failures: [{ file: "a.jsonl", error: "ConnectionRefused" }],
      kind: "network",
    },
  ])("$name", ({ attempted, failures, kind }) => {
    expect(failureKind(attempted, failures)).toBe(kind);
  });

  test("names the missing signature for unsigned", () => {
    const record = failureRecord("Stop", 1, [{ file: "a.jsonl", status: 403 }], "abc", new Date(0));
    expect(record).toHaveProperty(
      ["attributes", "message"],
      "every PUT returned 403: this environment has no SigV4 network secret for the upload bucket",
    );
  });
});

describe("unreported", () => {
  const unsigned = [{ file: "a.jsonl", status: 403 }];

  test.each<{
    name: string;
    failures: Failure[];
    reported: string[];
    kind: FailureKind | undefined;
  }>([
    {
      name: "a first failure reports its kind",
      failures: unsigned,
      reported: [],
      kind: "unsigned",
    },
    {
      name: "a repeat of a reported kind stays quiet",
      failures: unsigned,
      reported: ["unsigned"],
      kind: undefined,
    },
    {
      name: "a new kind reports after another",
      failures: [{ file: "a.jsonl", error: "ConnectionRefused" }],
      reported: ["unsigned"],
      kind: "network",
    },
    { name: "a clean run reports nothing", failures: [], reported: [], kind: undefined },
  ])("$name", ({ failures, reported, kind }) => {
    expect(unreported(1, failures, reported)).toBe(kind);
  });
});
