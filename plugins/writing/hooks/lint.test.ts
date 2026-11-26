import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PostToolUseHookInput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookJSONOutput } from "./io";
import type { RunOutcome } from "./run-log";
import { isLinted } from "../detection/vale";
import { dispatch, dispatchBash, targetOf } from "./lint";
import { snapshot } from "./worktree-changes";

// Session-state files land in $TMPDIR. Redirect it so test runs do not litter
// the shared OS temp dir with per-UUID state files.
const originalTmpdir = process.env.TMPDIR;
let stateDir: string;
// Edited files live outside $TMPDIR, which the hook skips as scratch.
let docs: string;

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "dispatch-state-"));
  process.env.TMPDIR = stateDir;
  docs = mkdtempSync(join(import.meta.dirname, ".lint-test-"));
});

afterAll(async () => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  await rm(stateDir, { recursive: true, force: true });
  await rm(docs, { recursive: true, force: true });
});

const common = { transcript_path: "/tmp/test", cwd: "/Users/test/project", tool_use_id: "test" };

function message(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: crypto.randomUUID(),
    tool_name: "Bash",
    tool_input: { command },
    ...common,
  };
}

// Writes `content` to `name` under the test directory, or names an absolute path as is.
async function edited(
  name: string,
  content: string,
  overrides: Partial<PostToolUseHookInput> = {},
): Promise<PostToolUseHookInput> {
  const absolute = name.startsWith("/");
  const filePath = absolute ? name : join(docs, name);
  if (!absolute) await Bun.write(filePath, content);
  return {
    hook_event_name: "PostToolUse",
    session_id: crypto.randomUUID(),
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
    tool_response: {},
    ...common,
    ...overrides,
  };
}

// Trips several checks: a lowercase step heading and a spaced em dash.
const MULTI_VIOLATION = "# step 1: introduction\n\nThis — is bad\n";

function contextOf(output: SyncHookJSONOutput | null): string | undefined {
  const specific = output?.hookSpecificOutput;
  return specific !== undefined && "additionalContext" in specific
    ? specific.additionalContext
    : undefined;
}

describe("messages", () => {
  it("denies on an error-level alert and lists the rest beside it", async () => {
    const opener = ["Hi", "team,"].join(" ");
    const command = `gh pr create --body "${opener} the handler reads the cache, so the event skips a query. We must reach for it."`;
    const { output, log } = await dispatch(message(command));
    expect(log.outcome).toBe("deny");
    expect(log.emitted).toContain("ai-tells.ConsequenceClause");
    expect(log.emitted).toContain("Writing.Salutation");
    const specific = output?.hookSpecificOutput;
    const reason =
      specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
    expect(reason).toContain("reach");
  });

  it("never suppresses a deny", async () => {
    const input = message('gh pr create --body "This feature — which broke — is fixed"');
    const first = await dispatch(input, 1_000_000);
    const second = await dispatch(input, 1_001_000);
    expect(first.log.outcome).toBe("deny");
    expect(second.log.outcome).toBe("deny");
  });

  it("lints a body file even under a scratch directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const bodyFile = join(dir, "pr-body.md");
    await Bun.write(bodyFile, "This is a tool, not a framework.");
    const { output, log } = await dispatch(message(`gh pr create --body-file ${bodyFile}`));
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("not a framework");
    expect(log.outcome).toBe("context");
  });

  it("records no target for a tool that names no file", async () => {
    const { log } = await dispatch(message("echo hi"));
    expect(log.target).toBeUndefined();
  });
});

describe("edited files", () => {
  it("reports every alert in the saved file as PostToolUse context", async () => {
    const { output, log } = await dispatch(await edited("draft.md", MULTI_VIOLATION));
    expect(output?.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
    expect(contextOf(output)).toContain("numbers a step");
    expect(contextOf(output)).toContain("em-dash");
    const { ts, session_id, duration_ms, target, ...stable } = log;
    expect(stable).toMatchInlineSnapshot(`
      {
        "check": "ai-tells.EmDashUsage",
        "checks": [
          "Writing.StepHeading",
          "Writing.TitleCaseHeading",
          "ai-tells.EmDashUsage",
        ],
        "emitted": [
          "ai-tells.EmDashUsage",
          "Writing.StepHeading",
          "Writing.TitleCaseHeading",
        ],
        "event": "PostToolUse",
        "ext": "md",
        "outcome": "context",
        "tool": "Write",
        "tool_use_id": "test",
      }
    `);
  });

  test.each<{ name: string; file: string; content: string; flagged: boolean }>([
    { name: "a code comment", file: "args.ts", content: "// a — b\nconst x = 1;\n", flagged: true },
    { name: "a string literal", file: "label.ts", content: 'const s = "a — b";\n', flagged: false },
    {
      name: "a file Vale cannot parse",
      file: "run.sh",
      content: "# a — b\necho ok\n",
      flagged: false,
    },
  ])("lints $name by Vale's own scoping", async ({ file, content, flagged }) => {
    const { log } = await dispatch(await edited(file, content));
    expect((log.checks ?? []).includes("ai-tells.EmDashUsage")).toBe(flagged);
  });

  it("stays silent on a clean file and records an empty check list", async () => {
    const { output, log } = await dispatch(await edited("clean.md", "# Cache Layer\n\nPlain.\n"));
    expect(output).toBeNull();
    expect(log.checks).toEqual([]);
  });

  it("hashes the file path so repeat writes correlate without the path", async () => {
    const { log } = await dispatch(await edited("hashed.md", "Plain.\n"));
    expect(log.target).toBe(targetOf(join(docs, "hashed.md")));
  });

  test.each<{ name: string; toolUseId: string; logged: string | undefined }>([
    { name: "a tool call id", toolUseId: "toolu_01", logged: "toolu_01" },
    { name: "an empty id", toolUseId: "", logged: undefined },
  ])("logs $name so a run finds its transcript tool call", async ({ toolUseId, logged }) => {
    const { log } = await dispatch(
      await edited("traced.md", "Plain.\n", { tool_use_id: toolUseId }),
    );
    expect(log.tool_use_id).toBe(logged);
  });

  describe("scoped to the edit", () => {
    const BEFORE = ["# Notes", "", "We should dig into the cache.", "", "The config is fine."];

    // Lines that differ at the same index become a one-line hunk, as Claude Code reports them.
    async function edit(name: string, before: string[], after: string[]) {
      const lines = after.flatMap((line, index) =>
        line === before[index] ? [` ${line}`] : [`-${before[index]}`, `+${line}`],
      );
      return edited(name, `${after.join("\n")}\n`, {
        tool_name: "Edit",
        tool_response: {
          originalFile: `${before.join("\n")}\n`,
          structuredPatch: [{ newStart: 1, lines }],
        },
      });
    }

    test.each<{ name: string; before: string[]; after: string[]; emitted: string[] }>([
      {
        name: "an alert on a line the edit left alone",
        before: BEFORE,
        after: [...BEFORE.slice(0, 4), "The config reads one file."],
        emitted: [],
      },
      {
        name: "an alert the edit wrote",
        before: BEFORE,
        after: [...BEFORE.slice(0, 4), "Let's dig into it."],
        emitted: ["ai-tells.UnpackExplore", "Writing.DigInto"],
      },
      {
        name: "an alert the replaced line already carried",
        before: ["We should dig into the cache."],
        after: ["We should dig into the cache now."],
        emitted: [],
      },
      {
        name: "a paragraph alert the edit caused on another line",
        before: ["The migration runs cleanly.", "The team reviews each change."],
        after: ["The migration runs cleanly.", "The fixtures strip cleanly."],
        emitted: ["Writing.SoftPhrasing"],
      },
    ])("handles $name", async ({ name, before, after, emitted }) => {
      const { log } = await dispatch(await edit(`${name}.md`, before, after));
      expect(log.emitted ?? []).toEqual(emitted);
    });

    it("logs the whole file's checks and counts the alerts it left out", async () => {
      const after = [...BEFORE.slice(0, 4), "The config reads one file."];
      const { log } = await dispatch(await edit("counted.md", BEFORE, after));
      expect(log.checks).toContain("Writing.DigInto");
      expect(log.unedited_alerts).toBe(1);
    });

    it("reports every alert in a file a Write created", async () => {
      const input = await edited("created.md", `${BEFORE.join("\n")}\n`, {
        tool_response: { type: "create", originalFile: null, structuredPatch: [] },
      });
      const { log } = await dispatch(input);
      expect(log.emitted).toContain("Writing.DigInto");
      expect(log.unedited_alerts).toBeUndefined();
    });
  });

  it("logs a failed lint as an error without a check list", async () => {
    const repo = mkdtempSync(join(import.meta.dirname, ".broken-repo-"));
    try {
      await Bun.write(join(repo, ".vale.ini"), "StylesPath = missing\n");
      await Bun.write(join(repo, "notes.md"), "Plain prose here.\n");
      const { output, log } = await dispatch(await edited(join(repo, "notes.md"), ""));
      expect(output).toBeNull();
      expect(log.outcome).toBe("error");
      expect(log.vale_error).toContain("E201");
      expect(log.checks).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("repeat suppression", () => {
  const NUMBERED_ONLY = "# Step 1: Introduction\n\nPlain prose here.\n";

  it("mutes a check already reported for the same file within the window", async () => {
    const input = await edited("repeat.md", NUMBERED_ONLY);
    const first = await dispatch(input, 1_000_000);
    expect(first.log.outcome).toBe("context");
    const second = await dispatch(input, 1_060_000);
    expect(second.output).toBeNull();
    expect(second.log.suppressed).toBe(true);
    expect(second.log.check).toBe("Writing.StepHeading");
  });

  it("still reports the check in another file", async () => {
    const first = await edited("one.md", NUMBERED_ONLY);
    const other = await edited("two.md", NUMBERED_ONLY, { session_id: first.session_id });
    await dispatch(first, 1_000_000);
    expect((await dispatch(other, 1_060_000)).output).not.toBeNull();
  });

  it("fires again once the window has passed", async () => {
    const input = await edited("later.md", NUMBERED_ONLY);
    await dispatch(input, 1_000_000);
    expect((await dispatch(input, 1_000_000 + 6 * 60_000)).output).not.toBeNull();
  });
});

describe("skips", () => {
  test.each<{ name: string; filePath: string; outcome: RunOutcome }>([
    { name: "repo tmp/", filePath: "/Users/test/project/tmp/notes.md", outcome: "skipped-scratch" },
    { name: "system /tmp", filePath: "/tmp/pr-body.md", outcome: "skipped-scratch" },
    {
      name: "a job dir",
      filePath: `${process.env.HOME}/.claude/jobs/abc123/tmp/handoff.md`,
      outcome: "skipped-scratch",
    },
    { name: "plan files", filePath: `${process.env.HOME}/.claude/plans/p.md`, outcome: "silent" },
    {
      name: "memory files",
      filePath: `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`,
      outcome: "silent",
    },
  ])("skips $name", async ({ filePath, outcome }) => {
    const { output, log } = await dispatch(await edited(filePath, MULTI_VIOLATION));
    expect(output).toBeNull();
    expect(log.outcome).toBe(outcome);
  });

  it("skips plan mode before linting", async () => {
    const input = await edited("planned.md", MULTI_VIOLATION, { permission_mode: "plan" });
    const { output, log } = await dispatch(input);
    expect(output).toBeNull();
    expect(log.checks).toBeUndefined();
  });
});

describe("Bash calls", () => {
  // Repos live under the redirected TMPDIR, which the hook treats as scratch, so tests lint by extension alone.
  const lints = (path: string): Promise<boolean> => isLinted(path);

  async function repoWith(files: Record<string, string>): Promise<string> {
    const repo = await realpath(mkdtempSync(join(stateDir, "repo-")));
    const git = (...args: string[]): void => {
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    };
    git("init", "-q", "--template=");
    await Promise.all(
      Object.entries(files).map(([name, text]) => Bun.write(join(repo, name), text)),
    );
    git("add", ".");
    git("commit", "-qm", "init", "--no-gpg-sign");
    return repo;
  }

  function bash(repo: string, sessionId: string): PostToolUseHookInput {
    return {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "python3 - <<'EOF' ... EOF" },
      tool_response: {},
      ...common,
      cwd: repo,
    };
  }

  it("reports only the lines the call added to a file already dirty", async () => {
    const repo = await repoWith({ "doc.md": "# Notes\n\nPlain.\n" });
    const session = crypto.randomUUID();
    await Bun.write(join(repo, "doc.md"), "# Notes\n\nEvery row that fits no slot.\n");
    await snapshot(session, repo, lints);
    await Bun.write(
      join(repo, "doc.md"),
      "# Notes\n\nEvery row that fits no slot.\n\nThe tool names no file.\n",
    );
    const { output, logs } = await dispatchBash(bash(repo, session), 1_000_000, lints);
    expect(contextOf(output)).toContain("5:");
    expect(contextOf(output)).not.toContain("3:");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tool: "Bash",
      event: "PostToolUse",
      outcome: "context",
      target: targetOf(join(repo, "doc.md")),
      unedited_alerts: 1,
    });
  });

  it("reports every changed file in one output with a row each", async () => {
    const repo = await repoWith({ "a.md": "Plain.\n" });
    const session = crypto.randomUUID();
    await snapshot(session, repo, lints);
    await Bun.write(join(repo, "a.md"), "Plain.\n\nThe tool names no file.\n");
    await Bun.write(join(repo, "b.md"), "The step has no owner.\n");
    const { output, logs } = await dispatchBash(bash(repo, session), 1_000_000, lints);
    expect(contextOf(output)).toContain("a.md");
    expect(contextOf(output)).toContain("b.md");
    expect(logs.map((row) => row.outcome)).toEqual(["context", "context"]);
  });

  test.each<{ name: string; snapshotFirst: boolean }>([
    { name: "a call that changed nothing", snapshotFirst: true },
    { name: "a call with no snapshot", snapshotFirst: false },
  ])("logs nothing for $name", async ({ snapshotFirst }) => {
    const repo = await repoWith({ "doc.md": "Plain.\n" });
    const session = crypto.randomUUID();
    if (snapshotFirst) await snapshot(session, repo, lints);
    expect(await dispatchBash(bash(repo, session), 1_000_000, lints)).toEqual({
      output: null,
      logs: [],
    });
  });
});
