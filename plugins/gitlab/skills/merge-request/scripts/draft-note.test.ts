import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  type Entry,
  type ReviewOptions,
  type Run,
  type RunResult,
  approveArgs,
  createArgs,
  publishArgs,
  runReview,
  validateEntry,
  validateOptions,
} from "./draft-note";

const ok: RunResult = { ok: true, stdout: "1", stderr: "" };
const fail: RunResult = { ok: false, stdout: "", stderr: "boom" };

function options(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return { iid: "7", submit: false, approve: false, requestChanges: false, ...overrides };
}

describe("createArgs", () => {
  test.each<{ name: string; entry: Entry; args: string[] }>([
    {
      name: "a general note has no position flags",
      entry: { body: "x" },
      args: ["mr", "note", "draft", "create", "7"],
    },
    {
      name: "a new-side line",
      entry: { body: "x", file: "a.ts", line: 42 },
      args: ["mr", "note", "draft", "create", "7", "--file", "a.ts", "--line", "42"],
    },
    {
      name: "a line range",
      entry: { body: "x", file: "a.ts", line: "10:15" },
      args: ["mr", "note", "draft", "create", "7", "--file", "a.ts", "--line", "10:15"],
    },
    {
      name: "an old-side line",
      entry: { body: "x", file: "a.ts", oldLine: 3 },
      args: ["mr", "note", "draft", "create", "7", "--file", "a.ts", "--old-line", "3"],
    },
    {
      name: "a reply without resolve stays native",
      entry: { body: "x", replyTo: "abc12345" },
      args: ["mr", "note", "draft", "create", "7", "--reply", "abc12345"],
    },
  ])("$name", ({ entry, args }) => {
    expect(createArgs("7", entry)).toEqual(args);
  });

  test("passes -R through to native create", () => {
    expect(createArgs("7", { body: "x" }, "g/p").slice(-2)).toEqual(["-R", "g/p"]);
  });

  test("a resolving reply uses REST with the discussion id and resolve flag", () => {
    expect(createArgs("7", { body: "done", replyTo: "full", resolve: true }, "g/p")).toEqual([
      "api",
      "projects/g%2Fp/merge_requests/7/draft_notes",
      "-X",
      "POST",
      "-f",
      "note=done",
      "-f",
      "in_reply_to_discussion_id=full",
      "-f",
      "resolve_discussion=true",
    ]);
  });
});

describe("publishArgs and approveArgs", () => {
  test("publish confirms, carries the summary, and sets the reviewer state", () => {
    expect(
      publishArgs(options({ summary: "Blockers", requestChanges: true, repo: "g/p" })),
    ).toEqual([
      "mr",
      "note",
      "draft",
      "publish",
      "7",
      "--yes",
      "-m",
      "Blockers",
      "--reviewer-state",
      "requested_changes",
      "-R",
      "g/p",
    ]);
  });

  test("approve pins the sha when given", () => {
    expect(approveArgs(options({ sha: "abc" }))).toEqual(["mr", "approve", "7", "--sha", "abc"]);
  });
});

describe("validateOptions", () => {
  const base = { iid: "7", submit: true, approve: false, requestChanges: false };

  test.each<{ name: string; overrides: Partial<typeof base> & Record<string, unknown> }>([
    { name: "a non-numeric iid", overrides: { iid: "x" } },
    { name: "approve with request-changes", overrides: { approve: true, requestChanges: true } },
    { name: "approve without submit", overrides: { submit: false, approve: true } },
    { name: "a summary without submit", overrides: { submit: false, summary: "s" } },
    { name: "summary with summary-file", overrides: { summary: "s", summaryFile: "f" } },
  ])("rejects $name", ({ overrides }) => {
    expect(validateOptions({ ...base, ...overrides })).not.toBeNull();
  });

  test("accepts a submit with approve and a summary", () => {
    expect(validateOptions({ ...base, approve: true, summary: "s" })).toBeNull();
  });
});

describe("validateEntry", () => {
  test.each<{ name: string; entry: Entry }>([
    { name: "resolve without replyTo", entry: { body: "x", resolve: true } },
    { name: "line without file", entry: { body: "x", line: 3 } },
    { name: "file with replyTo", entry: { body: "x", file: "a", replyTo: "r" } },
    { name: "line with oldLine", entry: { body: "x", file: "a", line: 1, oldLine: 2 } },
    {
      name: "a resolving reply to an id prefix",
      entry: { body: "x", replyTo: "abc12345", resolve: true },
    },
  ])("rejects $name", ({ entry }) => {
    expect(validateEntry(entry)).not.toBeNull();
  });

  test("accepts a resolving reply to a full id", () => {
    expect(validateEntry({ body: "x", replyTo: "a".repeat(40), resolve: true })).toBeNull();
  });
});

describe("runReview", () => {
  const entries: Entry[] = [{ body: "one", file: "a.ts", line: 1 }, { body: "two" }];

  test("sends each body on stdin and does not publish without --submit", async () => {
    const run = mock<Run>(() => Promise.resolve(ok));

    expect(await runReview(entries, options(), run)).toBe(0);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map((call) => call[1])).toEqual(["one", "two"]);
  });

  test("a failed entry skips publish and approve and exits 1", async () => {
    const run = mock<Run>((args) => Promise.resolve(args.includes("--file") ? fail : ok));

    const code = await runReview(entries, options({ submit: true, approve: true }), run);

    expect(code).toBe(1);
    expect(run.mock.calls.map((call) => call[0][0])).toEqual(["mr", "mr"]);
    expect(run.mock.calls.some((call) => call[0].includes("publish"))).toBe(false);
    expect(run.mock.calls.some((call) => call[0].includes("approve"))).toBe(false);
  });

  test("continues past a failure so every entry is attempted", async () => {
    const run = mock<Run>(() => Promise.resolve(fail));

    await runReview(entries, options(), run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  test("publishes then approves, in that order", async () => {
    const run = mock<Run>(() => Promise.resolve(ok));

    const code = await runReview(entries, options({ submit: true, approve: true }), run);

    expect(code).toBe(0);
    const verbs = run.mock.calls.map((call) => call[0].slice(0, 4).join(" "));
    expect(verbs.slice(-2)).toEqual(["mr note draft publish", "mr approve 7"]);
  });

  test("a failed publish skips approve and exits 1", async () => {
    const run = mock<Run>((args) => Promise.resolve(args.includes("publish") ? fail : ok));

    expect(await runReview(entries, options({ submit: true, approve: true }), run)).toBe(1);
    expect(run.mock.calls.some((call) => call[0].includes("approve"))).toBe(false);
  });

  test("a resolving reply sends no stdin", async () => {
    const run = mock<Run>(() => Promise.resolve(ok));

    await runReview([{ body: "done", replyTo: "full", resolve: true }], options(), run);

    expect(run.mock.calls[0]?.[1]).toBeUndefined();
  });
});

describe("cli", () => {
  test("accepts the documented review subcommand", () => {
    const proc = Bun.spawnSync(["bun", join(import.meta.dir, "draft-note.ts"), "review", "7"]);
    expect(proc.stderr.toString().trim()).toBe("--input is required");
  });
});
