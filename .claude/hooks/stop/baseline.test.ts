import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BaselineVerifier,
  type CheckResult,
  createVerifier,
  evaluateStop,
  normalizeLine,
  parsePrekOutput,
  readState,
  resolveHeadAt,
  type StopState,
  transcriptStartTime,
  writeState,
} from "./baseline";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "stop-baseline-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const SAMPLE_OUTPUT = `Plugin tests.............................................................Passed
Plugin validation....................................(no files to check)Skipped
Settings validation......................................................Failed
- hook id: settings-validate
- exit code: 1

  user/settings.json: /sandbox: must NOT have additional properties
Marketplace completeness.................................................Failed
- hook id: marketplace-check
- exit code: 1

  Plugins missing from marketplace.json:
    bogus
`;

describe("normalizeLine", () => {
  it("strips ANSI escapes and collapses whitespace", () => {
    const esc = String.fromCharCode(27);
    expect(normalizeLine(`  ${esc}[31mfail${esc}[0m   here `)).toBe("fail here");
  });

  it("masks durations", () => {
    expect(normalizeLine("Ran 3 tests. [12.34ms]")).toBe("Ran 3 tests. [<duration>]");
    expect(normalizeLine("timed out after 5 s")).toBe("timed out after <duration>");
  });
});

describe("parsePrekOutput", () => {
  it("parses statuses, hook ids, and bodies", () => {
    const results = parsePrekOutput(SAMPLE_OUTPUT);
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["Plugin tests", "passed"],
      ["Plugin validation", "skipped"],
      ["Settings validation", "failed"],
      ["Marketplace completeness", "failed"],
    ]);

    expect(results[2]).toMatchObject({
      id: "settings-validate",
      raw: "user/settings.json: /sandbox: must NOT have additional properties",
      lines: ["user/settings.json: /sandbox: must NOT have additional properties"],
    });

    expect(results[3]).toMatchObject({
      id: "marketplace-check",
      lines: ["Plugins missing from marketplace.json:", "bogus"],
    });
  });

  it("returns empty for unparseable output", () => {
    expect(parsePrekOutput("error: something exploded")).toEqual([]);
  });
});

function check(
  name: string,
  status: CheckResult["status"],
  lines: string[] = [],
  id = name,
): CheckResult {
  return { name, id, status, lines, raw: lines.join("\n") };
}

function verdictOf(failed: boolean): BaselineVerifier {
  return async (checks) => new Map(checks.map((c) => [c.name, { failed, lines: c.lines }]));
}

const noVerdict: BaselineVerifier = async () => new Map();

const mustNotVerify: BaselineVerifier = () => {
  throw new Error("verify must not be called for already-baselined checks");
};

describe("evaluateStop", () => {
  const failure = () => check("Settings validation", "failed", ["user/settings.json: bad"]);

  it("notices a pre-existing failure once without blocking", async () => {
    const state: StopState = { checks: {} };

    const first = await evaluateStop(state, [failure()], verdictOf(true));
    expect(first?.decision).toBeUndefined();
    expect(first?.systemMessage).toContain("Pre-existing check failure");
    expect(first?.systemMessage).toContain("Settings validation");

    const second = await evaluateStop(state, [failure()], mustNotVerify);
    expect(second).toBeNull();
  });

  it("blocks a failure that passes at the baseline", async () => {
    const state: StopState = { checks: {} };
    const output = await evaluateStop(state, [failure()], verdictOf(false));
    expect(output?.decision).toBe("block");
    expect(output?.reason).toContain("user/settings.json: bad");
  });

  it("blocks when the baseline cannot be verified", async () => {
    const state: StopState = { checks: {} };
    const output = await evaluateStop(state, [failure()], noVerdict);
    expect(output?.decision).toBe("block");
  });

  it("blocks a pre-existing failure that the session fixed and re-broke", async () => {
    const state: StopState = { checks: {} };

    const noticed = await evaluateStop(state, [failure()], verdictOf(true));
    expect(noticed?.systemMessage).toBeDefined();

    const fixed = await evaluateStop(
      state,
      [check("Settings validation", "passed")],
      mustNotVerify,
    );
    expect(fixed).toBeNull();
    expect(state.checks["Settings validation"]?.failed).toBe(false);

    const rebroken = await evaluateStop(state, [failure()], mustNotVerify);
    expect(rebroken?.decision).toBe("block");
  });

  it("blocks a silent failure when the baseline failure had output", async () => {
    const state: StopState = { checks: {} };
    await evaluateStop(state, [failure()], verdictOf(true));

    const silent = check("Settings validation", "failed", []);
    const output = await evaluateStop(state, [silent], mustNotVerify);
    expect(output?.decision).toBe("block");
  });

  it("treats a silent failure as pre-existing when the baseline was also silent", async () => {
    const state: StopState = { checks: {} };
    const silent = check("Settings validation", "failed", []);
    const output = await evaluateStop(state, [silent], verdictOf(true));
    expect(output?.decision).toBeUndefined();
    expect(output?.systemMessage).toContain("Pre-existing");
  });

  it("blocks when a pre-existing failure grows new output lines", async () => {
    const state: StopState = { checks: {} };
    await evaluateStop(state, [failure()], verdictOf(true));

    const grown = check("Settings validation", "failed", [
      "user/settings.json: bad",
      ".claude/settings.json: also bad",
    ]);
    const output = await evaluateStop(state, [grown], mustNotVerify);
    expect(output?.decision).toBe("block");
  });

  it("blocks on the new failure while noting the pre-existing one", async () => {
    const state: StopState = { checks: {} };
    await evaluateStop(state, [failure()], verdictOf(true));

    const fresh = check("Hook tests", "failed", ["(fail) stop hook > blocks"], "hook-test");
    const output = await evaluateStop(state, [failure(), fresh], verdictOf(false));
    expect(output?.decision).toBe("block");
    expect(output?.reason).toContain("Hook tests (hook-test)");
    expect(output?.reason).toContain("(fail) stop hook > blocks");
    expect(output?.reason).toContain("Pre-existing failures");
    expect(output?.reason).toContain("Settings validation");
  });

  it("returns null when everything passes", async () => {
    const state: StopState = { checks: {} };
    const output = await evaluateStop(
      state,
      [check("Settings validation", "passed")],
      mustNotVerify,
    );
    expect(output).toBeNull();
  });
});

describe("state persistence", () => {
  it("round-trips state and tolerates a corrupt file", async () => {
    const path = join(tempDir, "state.json");
    const state: StopState = {
      checks: { "Settings validation": { failed: true, lines: ["x"] } },
    };
    await writeState(path, state);
    expect(await readState(path)).toEqual(state);

    await Bun.write(path, "not json");
    expect(await readState(path)).toEqual({ checks: {} });

    expect(await readState(join(tempDir, "missing.json"))).toEqual({ checks: {} });
  });
});

describe("transcriptStartTime", () => {
  it("returns the first timestamped entry", async () => {
    const path = join(tempDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({ type: "mode", mode: "normal" }),
      JSON.stringify({ type: "user", timestamp: "2026-07-01T10:00:00.000Z" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-01T10:05:00.000Z" }),
    ];
    await Bun.write(path, lines.join("\n"));
    expect(await transcriptStartTime(path)).toEqual(new Date("2026-07-01T10:00:00.000Z"));
  });

  it("returns null for a missing transcript", async () => {
    expect(await transcriptStartTime(join(tempDir, "nope.jsonl"))).toBeNull();
  });
});

async function git(cwd: string, args: string[], date?: string): Promise<string> {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: date ?? "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: date ?? "2026-01-01T00:00:00Z",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const proc = Bun.spawn(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${code}: ${await new Response(proc.stderr).text()}`,
    );
  }
  return stdout.trim();
}

async function createRepo(): Promise<{ repo: string; first: string; second: string }> {
  const repo = await mkdtemp(join(tempDir, "repo-"));
  await git(repo, ["init", "-q"]);
  await Bun.write(join(repo, "a.txt"), "baseline\n");
  await git(repo, ["add", "a.txt"], "2026-01-01T00:00:00Z");
  await git(repo, ["commit", "-q", "-m", "first"], "2026-01-01T00:00:00Z");
  const first = await git(repo, ["rev-parse", "HEAD"]);

  await Bun.write(join(repo, "b.txt"), "added later\n");
  await git(repo, ["add", "b.txt"], "2026-01-03T00:00:00Z");
  await git(repo, ["commit", "-q", "-m", "second"], "2026-01-03T00:00:00Z");
  const second = await git(repo, ["rev-parse", "HEAD"]);

  return { repo, first, second };
}

describe("resolveHeadAt", () => {
  it("resolves the commit HEAD pointed at when the session started", async () => {
    const { repo, first, second } = await createRepo();
    expect(await resolveHeadAt(repo, new Date("2026-01-02T00:00:00Z"))).toBe(first);
    expect(await resolveHeadAt(repo, new Date("2026-01-04T00:00:00Z"))).toBe(second);
  });

  it("dates a checkout of an old commit by when HEAD moved there", async () => {
    const { repo, first, second } = await createRepo();
    await git(repo, ["checkout", "-q", first], "2026-01-05T00:00:00Z");

    expect(await resolveHeadAt(repo, new Date("2026-01-04T00:00:00Z"))).toBe(second);
    expect(await resolveHeadAt(repo, new Date("2026-01-06T00:00:00Z"))).toBe(first);
  });

  it("returns null when the session predates the reflog", async () => {
    const { repo } = await createRepo();
    expect(await resolveHeadAt(repo, new Date("2020-01-01T00:00:00Z"))).toBeNull();
  });

  it("returns null outside a git repository", async () => {
    const dir = await mkdtemp(join(tempDir, "not-a-repo-"));
    expect(await resolveHeadAt(dir, new Date())).toBeNull();
  });
});

describe("createVerifier", () => {
  it("runs checks in a worktree at the session baseline and cleans up", async () => {
    const { repo, second } = await createRepo();

    const transcript = join(tempDir, "verifier-transcript.jsonl");
    await Bun.write(
      transcript,
      JSON.stringify({ type: "user", timestamp: "2026-01-02T00:00:00Z" }),
    );

    let seen: { worktree: string; ids: string[]; files: string[]; hadLater: boolean } | undefined;
    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["a.txt", "b.txt"],
      runChecks: async (worktree, ids, files) => {
        seen = {
          worktree,
          ids,
          files,
          hadLater: await Bun.file(join(worktree, "b.txt")).exists(),
        };
        return [
          "Settings validation......................................................Failed",
          "- hook id: settings-validate",
          "- exit code: 1",
          "",
          "  user/settings.json: bad",
          "",
        ].join("\n");
      },
    });

    const verdicts = await verify([
      check("Settings validation", "failed", [], "settings-validate"),
    ]);

    expect(seen).toBeDefined();
    expect(seen?.ids).toEqual(["settings-validate"]);
    expect(seen?.files).toEqual(["a.txt"]);
    expect(seen?.hadLater).toBe(false);
    expect(verdicts.get("Settings validation")).toEqual({
      failed: true,
      lines: ["user/settings.json: bad"],
    });

    expect(seen ? await Bun.file(join(seen.worktree, "a.txt")).exists() : true).toBe(false);
    expect(await resolveHeadAt(repo, new Date("2026-01-04T00:00:00Z"))).toBe(second);
  });

  it("rewrites the worktree path to the session cwd in check output", async () => {
    const { repo } = await createRepo();
    const transcript = join(tempDir, "mask-transcript.jsonl");
    await Bun.write(
      transcript,
      JSON.stringify({ type: "user", timestamp: "2026-01-02T00:00:00Z" }),
    );

    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["a.txt"],
      runChecks: async (worktree) =>
        [
          "Settings validation......................................................Failed",
          "- hook id: settings-validate",
          `  ${join(worktree, "a.txt")}: bad`,
        ].join("\n"),
    });

    const verdicts = await verify([
      check("Settings validation", "failed", [], "settings-validate"),
    ]);
    expect(verdicts.get("Settings validation")?.lines).toEqual([`${join(repo, "a.txt")}: bad`]);
  });

  it("skips checks without a parsed hook id", async () => {
    const { repo } = await createRepo();
    const transcript = join(tempDir, "no-id-transcript.jsonl");
    await Bun.write(
      transcript,
      JSON.stringify({ type: "user", timestamp: "2026-01-02T00:00:00Z" }),
    );

    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["a.txt"],
      runChecks: async () => {
        throw new Error("must not run checks without hook ids");
      },
    });

    const anonymous: CheckResult = {
      name: "Settings validation",
      status: "failed",
      lines: [],
      raw: "",
    };
    expect((await verify([anonymous])).size).toBe(0);
  });

  it("removes worktrees leaked by an earlier verification", async () => {
    const { repo } = await createRepo();
    const stale = join(repo, "tmp", "stop-baseline-stale");
    await git(repo, ["worktree", "add", "--detach", stale]);
    expect(await Bun.file(join(stale, "a.txt")).exists()).toBe(true);

    const transcript = join(tempDir, "stale-transcript.jsonl");
    await Bun.write(
      transcript,
      JSON.stringify({ type: "user", timestamp: "2026-01-02T00:00:00Z" }),
    );

    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["a.txt"],
      runChecks: async () => "",
    });
    await verify([check("Settings validation", "failed", [], "settings-validate")]);

    expect(await Bun.file(join(stale, "a.txt")).exists()).toBe(false);
  });

  it("returns no verdicts when the transcript has no timestamp", async () => {
    const { repo } = await createRepo();
    const transcript = join(tempDir, "empty-transcript.jsonl");
    await Bun.write(transcript, JSON.stringify({ type: "mode" }));

    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["a.txt"],
      runChecks: async () => {
        throw new Error("must not run checks without a baseline");
      },
    });

    expect((await verify([check("Settings validation", "failed")])).size).toBe(0);
  });

  it("returns no verdicts when no session file exists at the baseline", async () => {
    const { repo } = await createRepo();
    const transcript = join(tempDir, "new-files-transcript.jsonl");
    await Bun.write(
      transcript,
      JSON.stringify({ type: "user", timestamp: "2026-01-02T00:00:00Z" }),
    );

    const verify = createVerifier({
      cwd: repo,
      transcriptPath: transcript,
      files: ["b.txt"],
      runChecks: async () => {
        throw new Error("must not run checks on files missing from the baseline");
      },
    });

    expect((await verify([check("Settings validation", "failed")])).size).toBe(0);
  });
});
