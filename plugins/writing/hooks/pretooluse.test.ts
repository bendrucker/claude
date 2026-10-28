import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookJSONOutput } from "./io";
import { dispatch, targetOf } from "./pretooluse";

// Session-state files land in $TMPDIR. Redirect it so test runs do not litter
// the shared OS temp dir with per-UUID state files.
const originalTmpdir = process.env.TMPDIR;
let stateDir: string;

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "dispatch-state-"));
  process.env.TMPDIR = stateDir;
});

afterAll(async () => {
  if (originalTmpdir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = originalTmpdir;
  }
  await rm(stateDir, { recursive: true, force: true });
});

function mockInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: Partial<PreToolUseHookInput> = {},
): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: crypto.randomUUID(),
    transcript_path: "/tmp/test",
    cwd: "/Users/test/project",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test",
    ...overrides,
  };
}

// Trips several checks at context tier: a lowercase step heading and a spaced em dash.
const MULTI_VIOLATION = "# step 1: introduction\n\nThis — is bad\n";

function contextOf(output: SyncHookJSONOutput | null): string | undefined {
  const specific = output?.hookSpecificOutput;
  return specific?.hookEventName === "PreToolUse" ? specific.additionalContext : undefined;
}

describe("every finding in one output", () => {
  it("lists advisory findings inside a structural deny", async () => {
    const command = 'gh pr create --body "Hi team, this matches nothing. We must reach for it."';
    const { output, log } = await dispatch(mockInput("Bash", { command }));
    expect(log.outcome).toBe("deny");
    expect(log.emitted).toContain("Writing.NoNegation");
    expect(log.emitted).toContain("Writing.Salutation");
    const specific = output?.hookSpecificOutput;
    const reason =
      specific?.hookEventName === "PreToolUse" ? specific.permissionDecisionReason : undefined;
    expect(reason).toContain("reach");
  });

  it("reports every check's findings in a single injection", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: MULTI_VIOLATION }),
    );
    expect(contextOf(output)).toContain("numbers a step");
    expect(contextOf(output)).toContain("AP title case");
    expect(contextOf(output)).toContain("em dash");
    const { ts, session_id, duration_ms, ...stable } = log;
    expect(typeof duration_ms).toBe("number");
    expect(stable).toMatchInlineSnapshot(`
      {
        "check": "Writing.StepHeading",
        "checks": [
          "Writing.StepHeading",
          "Writing.TitleCaseHeading",
          "Writing.SpacedEmDash",
          "ai-tells.EmDashUsage",
        ],
        "emitted": [
          "Writing.StepHeading",
          "Writing.TitleCaseHeading",
          "Writing.SpacedEmDash",
          "ai-tells.EmDashUsage",
        ],
        "ext": "md",
        "outcome": "context",
        "target": "4ece0350c8d2e88b",
        "tool": "Write",
      }
    `);
  });

  it.each<{ name: string; file_path: string; content: string; flagged: boolean }>([
    {
      name: "a shell string",
      file_path: "scripts/run.sh",
      content: 'echo "a — b"\n',
      flagged: false,
    },
    {
      name: "a shell comment",
      file_path: "scripts/run.sh",
      content: "# a — b\necho ok\n",
      flagged: true,
    },
    { name: "a YAML value", file_path: "conf/app.yaml", content: "title: a — b\n", flagged: false },
  ])("lints only the comments of $name", async ({ file_path, content, flagged }) => {
    const { log } = await dispatch(mockInput("Write", { file_path, content }));
    expect((log.checks ?? []).includes("Writing.SpacedEmDash")).toBe(flagged);
  });

  it("reports a lone finding as its check", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: "This — is bad\n" }),
    );
    expect(contextOf(output)).toContain("em dash");
    expect(log.check).toBe("Writing.SpacedEmDash");
  });
});

describe("code files", () => {
  it("flags the same trope in a comment, quoting the match", async () => {
    const { output } = await dispatch(
      mockInput("Write", {
        file_path: "src/args.ts",
        content: "// All 8 tests pass\nconst x = 1;\n",
      }),
    );
    expect(contextOf(output)).toContain("'All 8 tests pass'");
  });
});

describe("session-scoped repeat suppression", () => {
  // Step heading only: title-cased, no other findings.
  const NUMBERED_ONLY = "# Step 1: Introduction\n\nPlain prose here.\n";

  it("suppresses a repeat of the same check within the window", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: NUMBERED_ONLY },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    const first = await dispatch(input, now);
    expect(first.output).not.toBeNull();
    expect(first.log.outcome).toBe("context");

    const second = await dispatch(input, now + 60_000);
    expect(second.output).toBeNull();
    expect(second.log.outcome).toBe("silent");
    expect(second.log.suppressed).toBe(true);
    expect(second.log.check).toBe("Writing.StepHeading");
  });

  it("mutes only the checks that fired recently", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: MULTI_VIOLATION },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    await dispatch(input, now);
    const second = await dispatch(input, now + 60_000);
    expect(second.log.outcome).toBe("context");
    expect(second.log.emitted).toEqual(["Writing.SpacedEmDash"]);
    expect(second.log.suppressed_checks).toEqual([
      "Writing.StepHeading",
      "Writing.TitleCaseHeading",
      "ai-tells.EmDashUsage",
    ]);
  });

  it("fires again once the window has passed", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: NUMBERED_ONLY },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    await dispatch(input, now);
    const later = await dispatch(input, now + 6 * 60_000);
    expect(later.output).not.toBeNull();
    expect(later.log.check).toBe("Writing.StepHeading");
  });

  it("does not suppress across sessions", async () => {
    const content = { file_path: "docs/draft.md", content: NUMBERED_ONLY };
    const now = 1_000_000;

    await dispatch(mockInput("Write", content), now);
    const other = await dispatch(mockInput("Write", content), now + 60_000);
    expect(other.output).not.toBeNull();
  });

  it("never suppresses deny-tier decisions", async () => {
    const sessionId = crypto.randomUUID();
    const command = 'gh pr create --body "This feature — which broke — is fixed"';
    const input = mockInput("Bash", { command }, { session_id: sessionId });
    const now = 1_000_000;

    const first = await dispatch(input, now);
    const second = await dispatch(input, now + 1_000);
    expect(first.log.outcome).toBe("deny");
    expect(second.log.outcome).toBe("deny");
    expect(second.output).not.toBeNull();
  });

  it("never suppresses deny-origin fix-it reminders on file ops", async () => {
    const sessionId = crypto.randomUUID();
    const input = mockInput(
      "Write",
      { file_path: "docs/draft.md", content: "This — is bad\n" },
      { session_id: sessionId },
    );
    const now = 1_000_000;

    const first = await dispatch(input, now);
    const second = await dispatch(input, now + 60_000);
    expect(contextOf(first.output)).toContain("follow-up Edit");
    expect(contextOf(second.output)).toContain("follow-up Edit");
    expect(second.log.outcome).toBe("context");
  });
});

describe("scratch paths", () => {
  test.each<{ name: string; filePath: string }>([
    { name: "repo tmp/", filePath: "tmp/notes.md" },
    { name: "system /tmp", filePath: "/tmp/pr-body.md" },
    { name: "job dir", filePath: `${process.env.HOME}/.claude/jobs/abc123/tmp/handoff.md` },
  ])("skips all checkers for $name", async ({ filePath }) => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: filePath, content: MULTI_VIOLATION }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("skipped-scratch");
  });

  it("still scans scratch content at the Bash egress surface", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const bodyFile = join(dir, "pr-body.md");
    await Bun.write(bodyFile, "This is a tool, not a framework.");
    const { output, log } = await dispatch(
      mockInput("Bash", { command: `gh pr create --body-file ${bodyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("not a framework");
    expect(log.outcome).toBe("context");
  });

  it("scans gh api field-file egress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-egress-"));
    const replyFile = join(dir, "reply.md");
    await Bun.write(replyFile, "This is a tool, not a framework.");
    const { output } = await dispatch(
      mockInput("Bash", { command: `gh api repos/x/issues/1/comments -F body=@${replyFile}` }),
    );
    await rm(dir, { recursive: true, force: true });
    expect(contextOf(output)).toContain("not a framework");
  });
});

describe("accept-and-flag logging", () => {
  const clean = { file_path: "docs/draft.md", content: "# Cache Layer\n\nPlain.\n" };

  it("records every check the checkers found, not only the tier winner", async () => {
    const { log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: MULTI_VIOLATION }),
    );
    expect(log.checks?.length).toBeGreaterThan(1);
    expect(log.checks).toContain(log.check);
  });

  it("records an empty check list when the checkers found nothing", async () => {
    const { log } = await dispatch(mockInput("Write", clean));
    expect(log.checks).toEqual([]);
  });

  it("logs a failed lint as an error without a check list", async () => {
    const repo = mkdtempSync(join(import.meta.dirname, ".broken-repo-"));
    try {
      await Bun.write(join(repo, ".vale.ini"), "StylesPath = missing\n");
      const { output, log } = await dispatch(
        mockInput("Write", { file_path: join(repo, "notes.md"), content: "Plain prose here.\n" }),
      );
      expect(output).toBeNull();
      expect(log.outcome).toBe("error");
      expect(log.vale_error).toContain("E201");
      expect(log.checks).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("omits the check list on a run that returned before the checkers", async () => {
    const { log } = await dispatch(mockInput("Write", clean, { permission_mode: "plan" }));
    expect(log.checks).toBeUndefined();
  });

  it("hashes the file path so repeat writes correlate without the path", async () => {
    const { log } = await dispatch(mockInput("Write", clean));
    expect(log.target).toBe(targetOf("docs/draft.md"));
    expect(log.target).not.toContain("draft");
  });

  it("records no target for a tool that names no file", async () => {
    const { log } = await dispatch(mockInput("Bash", { command: "echo hi" }));
    expect(log.target).toBeUndefined();
  });
});

describe("shared skips", () => {
  const violating = { file_path: "docs/draft.md", content: MULTI_VIOLATION };

  it("skips plan mode entirely", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", violating, { permission_mode: "plan" }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("silent");
  });

  it("skips plan files", async () => {
    const { output } = await dispatch(
      mockInput("Write", { ...violating, file_path: `${process.env.HOME}/.claude/plans/p.md` }),
    );
    expect(output).toBeNull();
  });

  it("skips memory files", async () => {
    const { output } = await dispatch(
      mockInput("Write", {
        ...violating,
        file_path: `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`,
      }),
    );
    expect(output).toBeNull();
  });

  it("stays silent on clean prose", async () => {
    const { output, log } = await dispatch(
      mockInput("Write", { file_path: "docs/draft.md", content: "# Cache Layer\n\nPlain.\n" }),
    );
    expect(output).toBeNull();
    expect(log.outcome).toBe("silent");
  });
});

describe("deferred dependencies", () => {
  // A fresh process, since this file's other imports already hold Shiki.
  function loadedAfter(input: PreToolUseHookInput): string[] {
    const script = `
      const { dispatch } = await import(${JSON.stringify(join(import.meta.dir, "pretooluse.ts"))});
      await dispatch(${JSON.stringify(input)});
      console.log(JSON.stringify(Object.keys(require.cache)));
    `;
    const run = Bun.spawnSync([process.execPath, "-e", script], {
      env: { ...process.env, TMPDIR: stateDir },
    });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString());
    const keys: unknown = JSON.parse(run.stdout.toString());
    if (!Array.isArray(keys)) throw new Error(run.stdout.toString());
    const loaded = keys.flatMap((key) =>
      typeof key === "string" && key.includes("node_modules/shiki/dist/index") ? ["shiki"] : [],
    );
    return [...new Set(loaded)];
  }

  test.each([
    ["prose without an indefinite", "Write", { file_path: "docs/a.md", content: "Plain.\n" }, []],
    [
      "prose with an indefinite",
      "Write",
      { file_path: "docs/a.md", content: "It adds nothing.\n" },
      [],
    ],
    [
      "a Vale-native code edit",
      "Edit",
      { file_path: "src/a.ts", old_string: "1", new_string: "2" },
      [],
    ],
    [
      "a code edit Vale cannot read",
      "Edit",
      { file_path: "src/a.rs", old_string: "1", new_string: "2" },
      ["shiki"],
    ],
  ])("%s", (_name, tool, toolInput, expected) => {
    expect(loadedAfter(mockInput(tool, toolInput))).toEqual(expected);
  });
});
