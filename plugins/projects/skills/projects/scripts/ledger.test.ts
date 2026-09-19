import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fixture, row } from "./fixture";
import { clearItem, openItems, readQueue } from "./items";
import { appendDispatch } from "./threads";

describe("cli", () => {
  const script = join(import.meta.dir, "ledger.ts");

  const runOn = async (path: string, ...args: string[]) => {
    const proc = Bun.spawn([process.execPath, script, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: path },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  };
  // An empty PATH keeps herdr and gh out of reach, so the lead state reads as
  // unknown and every pull request stays unobserved.
  const run = (...args: string[]) => runOn("/nonexistent", ...args);

  const stubs = async (scripts: Record<string, string>): Promise<string> => {
    const bin = mkdtempSync(join(tmpdir(), "ledger-bin-"));
    await Promise.all(
      Object.entries(scripts).map(async ([name, body]) => {
        await Bun.write(join(bin, name), body);
        await Bun.spawn(["chmod", "+x", join(bin, name)]).exited;
      }),
    );
    return bin;
  };

  test("status survives a herdr that answers with something other than JSON", async () => {
    const bin = await stubs({ herdr: "#!/bin/sh\necho not json\n" });
    const result = await runOn(bin, "status", "--data-dir", await fixture(new Date()));
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/lead:unknown/);
  });

  test("status prints the queue, the routing block, the threads, and JSON on request", async () => {
    const dataDir = await fixture(new Date());
    const text = await run("status", "--data-dir", dataDir);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^queue\nid\s+kind\s+age/);
    expect(text.stdout).toMatch(/\nq1\s+review\s+\S+\s+done-thing\s+record what each thread/);
    expect(text.stdout).toMatch(/\nprojects\nledger\s+Dispatch ledger.*lead:unknown\s+open:2\n/);
    expect(text.stdout).toMatch(/\nfix-thing\s+waiting-on-you\s+blocked/);
    expect(text.stdout).toMatch(/\ndone-thing\s+ready-for-review\s+done/);

    const json = await run("status", "--data-dir", dataDir, "--tag", "by=chief", "--json");
    expect(json.code).toBe(0);
    const parsed: unknown = JSON.parse(json.stdout);
    expect(parsed).toEqual({
      queue: [expect.objectContaining({ id: "q1" }), expect.objectContaining({ id: "q2" })],
      projects: [expect.objectContaining({ slug: "ledger", open: 2 })],
      threads: [expect.objectContaining({ branch: "one-off", need: "idle" })],
    });
  });

  test("status raises a done thread whose pull request gh reports still open", async () => {
    const bin = await stubs({
      gh: `#!/bin/sh\necho '{"state":"OPEN","reviewDecision":"","isDraft":false}'\n`,
    });
    const result = await runOn(bin, "status", "--data-dir", await fixture(new Date()), "--json");
    expect(result.code).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      threads: [
        expect.objectContaining({ branch: "fix-thing", need: "waiting-on-you" }),
        expect.objectContaining({
          branch: "done-thing",
          need: "ready-for-review",
          prState: { state: "open", approved: false, draft: false },
        }),
        expect.objectContaining({ branch: "one-off", need: "idle" }),
      ],
    });
  });

  test("status keeps going when gh fails", async () => {
    const bin = await stubs({ gh: "#!/bin/sh\necho boom >&2\nexit 1\n" });
    const result = await runOn(bin, "status", "--data-dir", await fixture(new Date()), "--json");
    expect(result.code).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      threads: [
        expect.objectContaining({ branch: "fix-thing", need: "waiting-on-you" }),
        expect.objectContaining({
          branch: "done-thing",
          need: "ready-for-review",
          prState: { state: "unknown", approved: false, draft: false },
        }),
        expect.objectContaining({ branch: "one-off", need: "idle" }),
      ],
    });
  });

  test("outcome appends the row and status drops the thread once its pull request lands", async () => {
    const dataDir = await fixture(new Date());
    const bin = await stubs({
      gh: `#!/bin/sh\necho '{"state":"MERGED","reviewDecision":"APPROVED","isDraft":false}'\n`,
    });
    const result = await run(
      "outcome",
      "--data-dir",
      dataDir,
      "--repo",
      "/repo",
      "--branch",
      "fix-thing",
      "--state",
      "done",
      "--pr",
      "https://example.test/pr/3",
    );
    expect(result.code).toBe(0);
    const [outcome, queued] = result.stdout.trim().split("\n");
    expect(JSON.parse(outcome!)).toMatchObject({ branch: "fix-thing", outcome: "done" });
    expect(JSON.parse(queued!)).toMatchObject({
      id: "q4",
      kind: "review",
      text: "fix the thing",
      url: "https://example.test/pr/3",
      thread: { repo: "/repo", branch: "fix-thing" },
      agent: "fix-thing",
      pane: "wZZ:p1",
      state: "open",
    });
    expect(openItems(readQueue(dataDir)).map((item) => item.id)).toEqual(["q1", "q2", "q4"]);
    const status = await runOn(bin, "status", "--data-dir", dataDir);
    expect(status.stdout).not.toMatch(/fix-thing\s+waiting-on-you/);
    expect(status.stdout).toMatch(/open:0/);
    expect(status.stdout).not.toMatch(/needs a decision/);

    // The review is the only thing still naming the branch, so clearing it
    // takes the thread out of status entirely.
    clearItem({ id: "q4", state: "acked", by: "ben" }, dataDir);
    expect((await runOn(bin, "status", "--data-dir", dataDir)).stdout).not.toMatch(/fix-thing/);
  });

  test("labels a review with the branch when the thread has no task", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ledger-untasked-"));
    appendDispatch(row({ task: "" }), dataDir);
    const result = await run(
      "outcome",
      "--data-dir",
      dataDir,
      "--repo",
      "/repo",
      "--branch",
      "fix-thing",
      "--state",
      "done",
      "--pr",
      "https://example.test/pr/3",
    );
    expect(result.code).toBe(0);
    const [, queued] = result.stdout.trim().split("\n");
    expect(JSON.parse(queued!)).toMatchObject({ kind: "review", text: "fix-thing" });
  });

  test("raises no review for a thread that came back without one", async () => {
    const dataDir = await fixture(new Date());
    const result = await run(
      "outcome",
      "--data-dir",
      dataDir,
      "--repo",
      "/repo",
      "--branch",
      "fix-thing",
      "--state",
      "abandoned",
      "--note",
      "superseded",
    );
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(openItems(readQueue(dataDir)).map((item) => item.id)).toEqual(["q1", "q2"]);
  });

  test.each<[string, string[], number, RegExp]>([
    ["no subcommand", [], 2, /ledger/],
    ["outcome without a state", ["outcome", "--branch", "x"], 2, /--branch and --state/],
    ["outcome with a bad state", ["outcome", "--branch", "x", "--state", "won"], 2, /--state/],
    [
      "outcome with a state only dispatch writes",
      ["outcome", "--branch", "x", "--state", "dispatched"],
      2,
      /--state/,
    ],
    ["status with a bad tag", ["status", "--tag", "nope"], 2, /must be <key>=<value>/],
  ])("rejects %s", async (_label, args, status, expected) => {
    const result = await run(...args);
    expect(result.code).toBe(status);
    expect(`${result.stdout}${result.stderr}`).toMatch(expected);
  });
});
