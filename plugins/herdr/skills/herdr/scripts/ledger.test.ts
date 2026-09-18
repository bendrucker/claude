import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  appendDispatch,
  appendOutcome,
  buildStatus,
  capture,
  type DispatchLedgerRow,
  formatAge,
  formatStatus,
  latestRows,
  ledgerPath,
  openThreads,
  parseProject,
  parseTags,
  primaryRoot,
  projectsDir,
  readLedger,
  readProjects,
} from "./ledger";

const NOW = new Date("2026-09-18T12:00:00.000Z");

const row = (overrides: Partial<DispatchLedgerRow>): DispatchLedgerRow => ({
  ts: "2026-09-18T09:00:00.000Z",
  task: "do the thing",
  repo: "/repo",
  branch: "fix-thing",
  path: "/worktrees/repo/fix-thing",
  workspace: "wZZ",
  pane: "wZZ:p1",
  agent: "fix-thing",
  session: "sess-1",
  outcome: "dispatched",
  ...overrides,
});

const PROJECT = `---
name: Ledger routing
description: Dispatch ledger, project routing, and the chief and lead sessions that read it
repo: /repo
tracker: https://example.test/projects/ledger
---

Standing instructions for every thread.
`;

async function fixture(): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), "ledger-"));
  const rows = [
    row({ branch: "done-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({ branch: "fix-thing", tags: { project: "ledger", by: "lead-ledger" } }),
    row({ branch: "one-off", agent: "one-off", pane: "wA:p1", tags: { by: "chief" } }),
    row({ branch: "lost", agent: null, outcome: "orphaned" }),
    row({
      ts: "2026-09-18T10:00:00.000Z",
      branch: "done-thing",
      outcome: "done",
      pr: "https://example.test/pr/1",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
    row({
      ts: "2026-09-18T11:30:00.000Z",
      branch: "fix-thing",
      outcome: "blocked",
      note: "needs a decision",
      tags: { project: "ledger", by: "lead-ledger" },
    }),
  ];
  for (const entry of rows) appendDispatch(entry, dataDir);
  mkdirSync(join(projectsDir(dataDir), "ledger"), { recursive: true });
  mkdirSync(join(projectsDir(dataDir), "broken"), { recursive: true });
  await Bun.write(join(projectsDir(dataDir), "ledger", "project.md"), PROJECT);
  await Bun.write(join(projectsDir(dataDir), "broken", "project.md"), "no frontmatter here\n");
  return dataDir;
}

describe("parseTags", () => {
  test("reads repeated key=value pairs, last value winning", () => {
    expect(parseTags(["project=ledger", "by=chief", "by=lead-ledger"])).toEqual({
      project: "ledger",
      by: "lead-ledger",
    });
  });

  test("keeps an = inside the value", () => {
    expect(parseTags(["note=a=b"])).toEqual({ note: "a=b" });
  });

  test.each([["novalue"], ["=x"], ["Key=x"], ["k="]])("rejects %s", (value) => {
    expect(() => parseTags([value])).toThrow(/must be <key>=<value>/);
  });
});

describe("readLedger", () => {
  test("skips lines that are not rows and reports each one", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ledger-"));
    const good = row({});
    await Bun.write(
      ledgerPath(dataDir),
      `${JSON.stringify(good)}\nnot json\n{"ts":"x"}\n\n${JSON.stringify(good)}\n`,
    );
    const warnings: string[] = [];
    const rows = await readLedger(dataDir, (message) => warnings.push(message));
    expect(rows).toEqual([good, good]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/:2: not JSON/);
    expect(warnings[1]).toMatch(/:3: /);
  });

  test("is empty without a file", async () => {
    expect(await readLedger(mkdtempSync(join(tmpdir(), "ledger-")))).toEqual([]);
  });
});

describe("folding", () => {
  test("keeps the latest row per thread in first-seen order", async () => {
    const latest = latestRows(await readLedger(await fixture()));
    expect(latest.map((entry) => [entry.branch, entry.outcome])).toEqual([
      ["done-thing", "done"],
      ["fix-thing", "blocked"],
      ["one-off", "dispatched"],
      ["lost", "orphaned"],
    ]);
  });

  test("opens only dispatched and blocked threads, filtered by every tag", async () => {
    const rows = await readLedger(await fixture());
    expect(openThreads(rows).map((entry) => entry.branch)).toEqual(["fix-thing", "one-off"]);
    expect(openThreads(rows, { project: "ledger" }).map((entry) => entry.branch)).toEqual([
      "fix-thing",
    ]);
    expect(openThreads(rows, { by: "chief" }).map((entry) => entry.branch)).toEqual(["one-off"]);
    expect(openThreads(rows, { project: "ledger", by: "chief" })).toEqual([]);
  });
});

describe("appendOutcome", () => {
  test("copies the thread's identifiers onto the outcome row", async () => {
    const dataDir = await fixture();
    const written = await appendOutcome(
      { repo: "/repo", branch: "one-off", state: "done", pr: "https://example.test/pr/2" },
      dataDir,
      () => NOW,
    );
    expect(written).toEqual(
      row({
        ts: NOW.toISOString(),
        branch: "one-off",
        agent: "one-off",
        pane: "wA:p1",
        outcome: "done",
        pr: "https://example.test/pr/2",
        tags: { by: "chief" },
      }),
    );
    const rows = await readLedger(dataDir);
    expect(rows.at(-1)).toEqual(written);
    expect(openThreads(rows).map((entry) => entry.branch)).toEqual(["fix-thing"]);
  });

  test("drops the previous note and keeps the pr", async () => {
    const dataDir = await fixture();
    const done = await appendOutcome(
      { repo: "/repo", branch: "fix-thing", state: "done", pr: "https://example.test/pr/3" },
      dataDir,
    );
    expect(done.note).toBeUndefined();
    const blocked = await appendOutcome(
      { repo: "/repo", branch: "fix-thing", state: "blocked", note: "reopened" },
      dataDir,
    );
    expect(blocked).toMatchObject({ note: "reopened", pr: "https://example.test/pr/3" });
  });

  test("refuses a thread the ledger never saw", async () => {
    let message = "";
    try {
      await appendOutcome({ repo: "/repo", branch: "nope", state: "done" }, await fixture());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/no dispatch of nope in \/repo/);
  });

  test("rejects a tag value too long to sit in a column", () => {
    expect(() => parseTags([`project=${"x".repeat(201)}`])).toThrow(/at most 200 characters/);
    expect(parseTags([`project=${"x".repeat(200)}`]).project).toHaveLength(200);
  });

  test("refuses more tags than a routing key set needs", () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `k${i}=v`);
    expect(parseTags(tags(8))).toHaveProperty("k7", "v");
    expect(() => parseTags(tags(9))).toThrow(/at most 8 tags, given 9/);
  });

  test("refuses a note too long to keep a row's ceiling", async () => {
    const dataDir = await fixture();
    const outcome = (note: string) =>
      appendOutcome({ repo: "/repo", branch: "fix-thing", state: "blocked", note }, dataDir);
    let message = "";
    try {
      await outcome("w".repeat(501));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/at most 500 characters, given 501/);
    const blocked = await outcome("w".repeat(500));
    expect(blocked.note).toHaveLength(500);
    expect(JSON.stringify(blocked).length).toBeLessThan(1_500);
  });
});

describe("projects", () => {
  test("reads the frontmatter and leaves the body alone", () => {
    expect(parseProject("ledger", PROJECT)).toEqual({
      slug: "ledger",
      name: "Ledger routing",
      description: "Dispatch ledger, project routing, and the chief and lead sessions that read it",
      repo: "/repo",
      tracker: "https://example.test/projects/ledger",
    });
  });

  test("lists project.md files by slug and reports the ones it cannot read", async () => {
    const warnings: string[] = [];
    const projects = await readProjects(await fixture(), (message) => warnings.push(message));
    expect(projects.map((project) => project.slug)).toEqual(["ledger"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/broken\/project\.md: .*no frontmatter/);
  });

  test("is empty without a projects directory", async () => {
    expect(await readProjects(mkdtempSync(join(tmpdir(), "ledger-")))).toEqual([]);
  });

  test.each([["Ledger"], ["a".repeat(28)], ["1st"]])("rejects the slug %s", (slug) => {
    expect(() => parseProject(slug, PROJECT)).toThrow(/to name a lead-/);
  });

  test("reports what an empty frontmatter block is missing", () => {
    expect(() => parseProject("ledger", "---\n---\n\nBody.\n")).toThrow(/name/);
  });

  test("keeps a rule inside a block scalar out of the fence", () => {
    const text = "---\nname: N\ndescription: |\n  one\n  ---\n  two\n---\n\nBody.\n";
    expect(parseProject("ledger", text).description).toBe("one\n---\ntwo\n");
  });
});

describe("capture", () => {
  test("gives up on a command that outruns its deadline", async () => {
    const started = Date.now();
    expect(await capture(["sleep", "30"], 100)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("primaryRoot", () => {
  test("folds a linked worktree and a subdirectory onto the main worktree", async () => {
    const main = mkdtempSync(join(tmpdir(), "ledger-repo-"));
    const git = (...args: string[]) => Bun.spawn(["git", "-C", main, ...args]).exited;
    await git("init", "-q");
    await git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    mkdirSync(join(main, "sub"));
    const linked = join(main, "sub", "linked");
    await git("worktree", "add", "-q", linked, "-b", "linked");
    const root = await primaryRoot(main);
    expect(root).not.toBe(linked);
    expect(await primaryRoot(linked)).toBe(root);
    expect(await primaryRoot(join(main, "sub"))).toBe(root);
  });

  test("returns a path git does not know as given", async () => {
    expect(await primaryRoot("/nonexistent/repo")).toBe("/nonexistent/repo");
  });
});

describe("status", () => {
  test("renders the routing block and the open threads", async () => {
    const dataDir = await fixture();
    const status = buildStatus(
      await readProjects(dataDir),
      await readLedger(dataDir),
      {},
      new Set(["lead-ledger", "one-off"]),
    );
    expect(status.projects).toMatchObject([{ slug: "ledger", lead: "live", open: 1 }]);
    expect(formatStatus(status, NOW)).toMatchSnapshot();
  });

  test("marks the lead unknown when herdr cannot answer, and the blocks empty when they are", () => {
    const none: DispatchLedgerRow[] = [];
    const status = buildStatus([{ slug: "p", name: "P", description: "d" }], none, {}, null);
    expect(status.projects[0]?.lead).toBe("unknown");
    expect(formatStatus(status, NOW)).toMatchSnapshot();
    expect(formatStatus(buildStatus([], none, {}, null), NOW)).toBe(
      "projects\nno projects\n\nthreads\nno open threads\n",
    );
  });

  test("keeps every item on one line when a field carries newlines", () => {
    const status = buildStatus(
      [{ slug: "p", name: "P", description: "first line\nsecond  line\n" }],
      [row({ pr: "https://example.com/pr/1\nstray" })],
      {},
      null,
    );
    const lines = formatStatus(status, NOW).trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("first line second line");
    expect(lines[5]).toContain("https://example.com/pr/1 stray");
  });
});

describe("formatAge", () => {
  test.each([
    ["2026-09-18T11:59:30.000Z", "0m"],
    ["2026-09-18T11:15:00.000Z", "45m"],
    ["2026-09-18T09:00:00.000Z", "3h"],
    ["2026-09-16T13:00:00.000Z", "47h"],
    ["2026-09-16T11:00:00.000Z", "2d"],
    ["2026-09-18T13:00:00.000Z", "0m"],
    ["yesterday", "?"],
  ])("%s reads as %s", (ts, expected) => {
    expect(formatAge(ts, NOW)).toBe(expected);
  });
});

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
  // An empty PATH keeps herdr out of reach, so the lead state reads as unknown.
  const run = (...args: string[]) => runOn("/nonexistent", ...args);

  test("status survives a herdr that answers with something other than JSON", async () => {
    const bin = mkdtempSync(join(tmpdir(), "ledger-bin-"));
    await Bun.write(join(bin, "herdr"), "#!/bin/sh\necho not json\n");
    await Bun.spawn(["chmod", "+x", join(bin, "herdr")]).exited;
    const result = await runOn(bin, "status", "--data-dir", await fixture());
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/lead:unknown/);
  });

  test("status prints the routing block, the threads, and JSON on request", async () => {
    const dataDir = await fixture();
    const text = await run("status", "--data-dir", dataDir);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^projects\nledger\s+Dispatch ledger.*lead:unknown\s+open:1\n/);
    expect(text.stdout).toMatch(/\nfix-thing\s+blocked/);
    expect(text.stdout).not.toMatch(/done-thing/);

    const json = await run("status", "--data-dir", dataDir, "--tag", "by=chief", "--json");
    expect(json.code).toBe(0);
    const parsed: unknown = JSON.parse(json.stdout);
    expect(parsed).toEqual({
      projects: [expect.objectContaining({ slug: "ledger", open: 1 })],
      threads: [expect.objectContaining({ branch: "one-off" })],
    });
  });

  test("outcome appends the row and status drops the thread", async () => {
    const dataDir = await fixture();
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
    expect(JSON.parse(result.stdout)).toMatchObject({ branch: "fix-thing", outcome: "done" });
    const status = await run("status", "--data-dir", dataDir);
    expect(status.stdout).not.toMatch(/fix-thing/);
    expect(status.stdout).toMatch(/open:0/);
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
