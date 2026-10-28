import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { check, collectText, isProse, MCP_PROSE_GUARD, pathCandidates } from "./check-tropes";
import { toolInputOf } from "./io";
import { report } from "./report";

async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  const target = { toolName: input.tool_name, filePath: toolInputOf(input).file_path };
  return report(await check(input), target)?.output ?? null;
}

function contextOf(output: SyncHookJSONOutput | null): string | undefined {
  const specific = output?.hookSpecificOutput;
  return specific?.hookEventName === "PreToolUse" ? specific.additionalContext : undefined;
}

function denialOf(output: SyncHookJSONOutput | null): {
  decision: string | undefined;
  reason: string | undefined;
} {
  const specific = output?.hookSpecificOutput;
  if (specific?.hookEventName !== "PreToolUse") return { decision: undefined, reason: undefined };
  return { decision: specific.permissionDecision, reason: specific.permissionDecisionReason };
}

function mockWrite(content: string, filePath = "test.md"): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
    tool_use_id: "test",
  };
}

function mockEdit(
  newString: string,
  oldString?: string,
  filePath = "test.md",
): PreToolUseHookInput {
  const toolInput: Record<string, unknown> = {
    file_path: filePath,
    new_string: newString,
  };
  if (oldString !== undefined) toolInput.old_string = oldString;
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: toolInput,
    tool_use_id: "test",
  };
}

function mockMultiEdit(edits: { old_string?: string; new_string: string }[]): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "MultiEdit",
    tool_input: { file_path: "test.md", edits },
    tool_use_id: "test",
  };
}

function mockBash(command: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

function mockMcp(tool_name: string, tool_input: Record<string, unknown>): PreToolUseHookInput {
  return { ...mockBash(""), tool_name, tool_input };
}

describe("Vale rule files", () => {
  const rulePath = "/Users/test/plugins/writing/styles/Writing/ReachingFor.yml";

  test.each<[string, string, string]>([
    [
      "skips Write to a rule file containing flagged vocabulary",
      "Write",
      "tokens:\n  - delve\n  - tapestry\n",
    ],
    ["skips Edit to a rule file", "Edit", "  - delve\n  - bolstered\n"],
  ])("%s", async (_name, tool, content) => {
    const input =
      tool === "Write" ? mockWrite(content, rulePath) : mockEdit(content, undefined, rulePath);
    expect(await processInput(input)).toBeNull();
  });

  it("does not skip other .txt files", async () => {
    const result = await processInput(
      mockWrite("This is a tool, not a framework.", "/tmp/notes.txt"),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });
});

describe("Write/Edit", () => {
  it("returns reminder for Write with spaced em dash", async () => {
    const result = await processInput(mockWrite("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    const ctx = contextOf(result);
    expect(ctx).toContain("follow-up Edit");
  });

  it("returns reminder for Edit with spaced em dash", async () => {
    const result = await processInput(mockEdit("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("ignores flagged content in Edit old_string", async () => {
    const input = mockEdit(
      "clean replacement text here",
      "old content with \u2014 spaced em dash inside",
    );
    expect(await processInput(input)).toBeNull();
  });

  it("returns reminder when old_string is clean but new_string has em dash", async () => {
    const input = mockEdit("This \u2014 is bad", "clean original text here");
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("returns context for promotional language", async () => {
    const result = await processInput(mockWrite("A groundbreaking approach"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("returns null for clean text", async () => {
    expect(await processInput(mockWrite("Clean prose here."))).toBeNull();
  });

  it("returns null for empty content", async () => {
    expect(await processInput(mockWrite(""))).toBeNull();
  });
});

describe("diff-aware filtering", () => {
  it("ignores Edit that preserves a pre-existing em dash", async () => {
    const input = mockEdit(
      "Title \u2014 kept verbatim, with extra detail added.",
      "Title \u2014 kept verbatim.",
    );
    expect(await processInput(input)).toBeNull();
  });

  it("flags Edit that adds a second em dash beyond what old_string had", async () => {
    const input = mockEdit(
      "Title \u2014 kept, and now another \u2014 added phrase.",
      "Title \u2014 kept verbatim.",
    );
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("ignores MultiEdit that preserves pre-existing AI vocabulary", async () => {
    const input = mockMultiEdit([
      {
        old_string: "We delve into the intricacies of the system.",
        new_string: "We delve into the intricacies of the new system, with examples.",
      },
    ]);
    expect(await processInput(input)).toBeNull();
  });

  it("ignores Write that preserves an em dash already in the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-diff-"));
    const file = join(dir, "doc.md");
    await Bun.write(file, "Title \u2014 already here in the existing file.\n");
    const result = await processInput(
      mockWrite("Title \u2014 already here in the existing file.\nAdded line.\n", file),
    );
    await rm(dir, { recursive: true, force: true });
    expect(result).toBeNull();
  });

  it("flags Write that adds a new em dash beyond what file had", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-diff-"));
    const file = join(dir, "doc.md");
    await Bun.write(file, "Title \u2014 already here.\n");
    const result = await processInput(
      mockWrite("Title \u2014 already here.\nNow another \u2014 line.\n", file),
    );
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("skips text with no active tropes in file Edit", async () => {
    const input = mockEdit("Excellent. Let me proceed.\nNext line.", "Next line.");
    expect(await processInput(input)).toBeNull();
  });
});

describe("semicolon splices", () => {
  function codeEdit(newString: string, oldString: string): PreToolUseHookInput {
    return mockEdit(newString, oldString, "index.ts");
  }

  it("flags a code-file edit introducing a spliced comment", async () => {
    const result = await processInput(
      codeEdit("// keep sorted; callers rely on order\nconst x = 1;", "const x = 1;"),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    const ctx = contextOf(result);
    expect(ctx).toContain("semicolon");
  });

  it("ignores a pre-existing spliced comment untouched by the edit", async () => {
    const result = await processInput(
      codeEdit(
        "// keep sorted; callers rely on order\nconst x = 2;",
        "// keep sorted; callers rely on order\nconst x = 1;",
      ),
    );
    expect(result).toBeNull();
  });

  test.each<{ name: string; edit: [string, string]; quote: string | undefined }>([
    {
      name: "flags and quotes a splice edited into a script block",
      edit: ["// wait for fonts", "// keep sorted; callers rely on order"],
      quote: "sorted; callers",
    },
    {
      name: "ignores a pre-existing splice elsewhere in the file",
      edit: ["const ready = 1;", "const ready = 2;"],
      quote: undefined,
    },
  ])("$name", async ({ edit: [oldString, newString], quote }) => {
    const file = join(mkdtempSync(join(tmpdir(), "trope-html-")), "page.html");
    await Bun.write(
      file,
      [
        "<!-- The page loads fast; the fonts arrive later. -->",
        "<script>",
        "// wait for fonts",
        "const ready = 1;",
        "</script>",
      ].join("\n"),
    );
    const result = await processInput(mockEdit(newString, oldString, file));
    expect(contextOf(result)?.match(/'([^']*)' joins two clauses/)?.[1]).toBe(quote);
  });

  it("ignores existing comments when an edit shortens an overlong line", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "trope-long-")), "app.js");
    const long = `const blob = "${"x".repeat(3_000)}";`;
    await Bun.write(file, `// The cache warms slowly; then it saturates.\n${long}\n`);
    expect(await processInput(mockEdit('const blob = "";', long, file))).toBeNull();
  });
});

describe("MultiEdit", () => {
  it("returns null when all old_string values are flagged but new_string values are clean", async () => {
    const input = mockMultiEdit([
      { old_string: "text with \u2014 em dash", new_string: "clean replacement text here" },
      { old_string: "delve into the codebase", new_string: "look at the code carefully" },
    ]);
    expect(await processInput(input)).toBeNull();
  });

  it("returns reminder when any new_string contains a spaced em dash", async () => {
    const input = mockMultiEdit([
      { old_string: "clean original text here", new_string: "clean replacement text here" },
      { old_string: "more clean original content", new_string: "bad \u2014 replacement here" },
    ]);
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("returns null for fully clean MultiEdit", async () => {
    const input = mockMultiEdit([
      { old_string: "original content here", new_string: "replacement content here" },
    ]);
    expect(await processInput(input)).toBeNull();
  });
});
describe("pathCandidates", () => {
  test.each([
    ["tmp/body.md", ["tmp/body.md"]],
    ["$TMPDIR/body.md", ["/tmp/body.md", "/tmp/claude-501/body.md"]],
    ["${TMPDIR}/body.md", ["/tmp/body.md", "/tmp/claude-501/body.md"]],
    ["$HOME/body.md", ["/home/me/body.md"]],
  ])("expands %s", (path, expected) => {
    expect(pathCandidates(path, { TMPDIR: "/tmp", HOME: "/home/me" }, 501)).toEqual(expected);
  });
});

describe("collectText", () => {
  describe("Bash commands", () => {
    let dir: string;
    let tmpFile: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "trope-test-"));
      tmpFile = join(dir, "body.md");
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("reads --body-file content", async () => {
      await Bun.write(tmpFile, "Body content here");
      const texts = await collectText(mockBash(`gh pr create --body-file ${tmpFile}`));
      expect(texts).toContain("Body content here");
    });

    it("reads --body-file= content", async () => {
      await Bun.write(tmpFile, "Body content");
      const texts = await collectText(mockBash(`gh pr create --body-file=${tmpFile}`));
      expect(texts).toContain("Body content");
    });

    it("expands a shell variable in the --body-file path", async () => {
      await Bun.write(tmpFile, "Expanded body");
      process.env.TROPE_TEST_DIR = dir;
      try {
        const texts = await collectText(
          mockBash('gh pr create --body-file "$TROPE_TEST_DIR/body.md"'),
        );
        expect(texts).toContain("Expanded body");
      } finally {
        delete process.env.TROPE_TEST_DIR;
      }
    });

    it("extracts inline --body", async () => {
      const texts = await collectText(mockBash('gh issue create --body "Issue description"'));
      expect(texts).toContain("Issue description");
    });

    it("extracts inline --title", async () => {
      const texts = await collectText(mockBash('gh issue create --title "My title"'));
      expect(texts).toContain("My title");
    });

    it("reads gh api -F body=@file content", async () => {
      await Bun.write(tmpFile, "Reply body");
      const texts = await collectText(
        mockBash(`gh api repos/x/issues/1/comments -F body=@${tmpFile}`),
      );
      expect(texts).toContain("Reply body");
    });

    it("reads glab api --field description=@file content", async () => {
      await Bun.write(tmpFile, "MR description");
      const texts = await collectText(
        mockBash(`glab api projects/x/merge_requests --field description=@${tmpFile}`),
      );
      expect(texts).toContain("MR description");
    });

    it("reads shell-quoted field file paths", async () => {
      await Bun.write(tmpFile, "Quoted body");
      const texts = await collectText(mockBash(`gh api repos/x/y/issues -F 'body=@${tmpFile}'`));
      expect(texts).toContain("Quoted body");
    });

    it("reads git commit -F message files", async () => {
      await Bun.write(tmpFile, "Commit message body");
      const texts = await collectText(mockBash(`git commit -F ${tmpFile}`));
      expect(texts).toContain("Commit message body");
    });

    it("reads git tag --file message files", async () => {
      await Bun.write(tmpFile, "Tag annotation");
      const texts = await collectText(mockBash(`git tag -a v1.0.0 --file ${tmpFile}`));
      expect(texts).toContain("Tag annotation");
    });

    it("ignores bare -F outside git commands", async () => {
      const texts = await collectText(mockBash("curl -F upload=/tmp/data.bin https://x"));
      expect(texts).toHaveLength(0);
    });

    it("ignores field flags with inline values", async () => {
      const texts = await collectText(mockBash("gh api repos/x -F state=closed"));
      expect(texts).toHaveLength(0);
    });

    it("ignores stdin field files", async () => {
      const texts = await collectText(mockBash("gh api repos/x -F body=@-"));
      expect(texts).toHaveLength(0);
    });

    it("returns empty for commands without text args", async () => {
      const texts = await collectText(mockBash("git status"));
      expect(texts).toHaveLength(0);
    });
  });
});

describe("Bash processInput", () => {
  it("denies Bash inline arg with spaced em dash", async () => {
    const result = await processInput(
      mockBash(
        'gh pr create --body "This feature \u2014 which was added last week \u2014 is broken"',
      ),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("permissionDecision", "deny");
  });

  it("flags Bash body-file with AI vocabulary as context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "This is a tool, not a framework.");
    const result = await processInput(mockBash(`gh pr create --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    expect(result?.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("does not deny Bash commands containing flagged tokens as literals", async () => {
    const result = await processInput(mockBash('gh pr create --title "Rename underscore field"'));
    if (result) {
      expect(result.hookSpecificOutput).not.toHaveProperty("permissionDecision");
    }
  });

  it("flags a review comment that opens with a vocative", async () => {
    const result = await processInput(
      mockBash(
        `glab mr note 871 --message "Dana, this fires for the entire run rather than the changed files."`,
      ),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("flags a body-file comment that opens with a greeting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-test-"));
    const file = join(dir, "body.md");
    await Bun.write(file, "Hi Dana,\n\nThe retry loop swallows the error.\n");
    const result = await processInput(mockBash(`gh pr review --body-file ${file}`));
    await rm(dir, { recursive: true, force: true });
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("denies an MR body that negates the noun", async () => {
    const result = await processInput(
      mockBash(
        `glab mr create --description "The handler reads the cache, so the event costs no extra query."`,
      ),
    );
    const denial = denialOf(result);
    expect(denial.decision).toBe("deny");
    expect(denial.reason).toContain("Writing.NoNegation");
  });

  it("returns null for non-text Bash commands", async () => {
    expect(await processInput(mockBash("git push origin main"))).toBeNull();
  });
});

describe("MCP calls", () => {
  it("denies a GitHub PR body that negates the noun", async () => {
    const result = await processInput(
      mockMcp("mcp__github__create_pull_request", {
        owner: "o",
        repo: "r",
        title: "Cache the lookup",
        body: "The handler reads the cache, so the event costs no extra query.",
      }),
    );
    const denial = denialOf(result);
    expect(denial.decision).toBe("deny");
    expect(denial.reason).toContain("Writing.NoNegation");
  });

  it("denies a thread reply that negates the noun", async () => {
    const result = await processInput(
      mockMcp("mcp__hearthbot__post_message", { text: "The sweep ran, and I filed nothing." }),
    );
    expect(denialOf(result).decision).toBe("deny");
  });

  it("reads prose at any depth and under any field name", async () => {
    const texts = await collectText(
      mockMcp("mcp__any__tool", {
        question: "Ship the fix?",
        options: [{ label: "Ship", consequence: "The PR merges and adds no tests." }],
        recommended: 0,
      }),
    );
    expect(texts).toEqual(["The PR merges and adds no tests."]);
  });

  it("leaves a query that negates the noun alone", async () => {
    expect(
      await processInput(mockMcp("mcp__github__search_code", { query: "costs no extra" })),
    ).toBeNull();
  });
});

describe("isProse", () => {
  it.each([
    "The sweep ran overnight and found two stale entries.",
    "Done. The handler now reads the cache before it calls the API.",
    "| a | b |\n\nThe table above lists every run that timed out.",
    "The plugin comes out of the list under `enabledPlugins`.",
  ])("reads %p as prose", (text) => {
    expect(isProse(text)).toBe(true);
  });

  it.each([
    "SELECT id FROM runs WHERE state = 'done';",
    "negation hook latency",
    '{"type": "none", "value": "x"}',
    "/Users/ben/tmp/negation-escapes/cand.jsonl",
    "Run `bun test plugins/writing/hooks/check-tropes.test.ts --timeout 15000`.",
  ])("reads %p as not prose", (text) => {
    expect(isProse(text)).toBe(false);
  });
});

describe("isProse properties", () => {
  const word = gs.text({ alphabet: "abcdefghijklmnopqrstuvwxyz", minSize: 1, maxSize: 12 });
  const capitalized = word.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const number = gs.integers({ minValue: 0, maxValue: 100_000 }).map(String);
  const terminator = gs.sampledFrom([".", "!", "?", ":"]);
  const separator = gs.sampledFrom([" ", "  ", "\t", " \t "]);
  const sentence = gs.composite((tc) => {
    const words = tc.draw(
      gs.arrays(gs.oneOf(word, word, word, number), { minSize: 3, maxSize: 30 }),
    );
    let text = tc.draw(capitalized);
    for (const w of words) text += tc.draw(separator) + w;
    return text + tc.draw(terminator);
  });
  const noise = gs.text({
    alphabet: "aZ09 _-./:;,'\"`*#>|()[]{}=<>!?$@~\t\n\\é’—",
    maxSize: 200,
  });

  test("a capitalized run of words ending in a terminator is prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      if (!isProse(text)) throw new Error(`not prose: ${JSON.stringify(text)}`);
    });
  });

  test("markdown list, quote, heading, and emphasis wrappers keep prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const [open, close] = tc.draw(
        gs.sampledFrom([
          ["- ", ""],
          ["* ", ""],
          ["1. ", ""],
          ["> ", ""],
          ["## ", ""],
          ["**", "**"],
          ["_", "_"],
          ["(", ")"],
          ['"', '"'],
        ]),
      );
      const wrapped = open + text + close;
      if (!isProse(wrapped)) throw new Error(`not prose: ${JSON.stringify(wrapped)}`);
    });
  });

  test("a trailing code span before the terminator keeps prose", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const code = tc.draw(gs.text({ alphabet: "abc-_./ ={}$", minSize: 1, maxSize: 40 }));
      const spanned = `${text.slice(0, -1)} \`${code}\`${text.slice(-1)}`;
      if (!isProse(spanned)) throw new Error(`not prose: ${JSON.stringify(spanned)}`);
    });
  });

  test("a line of anything else never hides a prose line", () => {
    hegel.test((tc) => {
      const text = tc.draw(sentence);
      const other = tc.draw(noise);
      for (const joined of [`${text}\n${other}`, `${other}\n${text}`]) {
        if (!isProse(joined)) throw new Error(`not prose: ${JSON.stringify(joined)}`);
      }
    });
  });

  test("text without three separated tokens is never prose", () => {
    hegel.test((tc) => {
      const parts = tc.draw(
        gs.arrays(gs.text({ alphabet: "aZ09_-./:'\"*#()!?é’", maxSize: 40 }), { maxSize: 3 }),
      );
      const text = parts.join(tc.draw(separator));
      if (isProse(text)) throw new Error(`prose: ${JSON.stringify(text)}`);
    });
  });

  test("JSON, SQL, and shell commands are never prose", () => {
    hegel.test((tc) => {
      const ident = gs.fromRegex("[a-z_][a-z0-9_]{0,15}");
      const value = gs.oneOf(ident, number, gs.booleans().map(String));
      const text = tc.draw(
        gs.oneOf(
          gs
            .arrays(gs.tuples(ident, value), { maxSize: 8 })
            .map((kv) => JSON.stringify(Object.fromEntries(kv), null, 2)),
          gs
            .tuples(gs.arrays(ident, { minSize: 1, maxSize: 6 }), ident, ident, value)
            .map(
              ([cols, table, col, v]) =>
                `SELECT ${cols.join(", ")} FROM ${table} WHERE ${col} = '${v}' ORDER BY ${col} LIMIT 10;`,
            ),
          gs
            .tuples(ident, gs.arrays(gs.tuples(ident, value), { maxSize: 6 }))
            .map(
              ([cmd, flags]) =>
                `${cmd} ${flags.map(([f, v]) => `--${f}=${v}`).join(" ")} ./src/${cmd}.ts`,
            ),
        ),
      );
      if (isProse(text)) throw new Error(`prose: ${JSON.stringify(text)}`);
    });
  });

  test("the hooks.json grep matches every call that holds prose", () => {
    const guard = new RegExp(MCP_PROSE_GUARD);
    hegel.test(
      (tc) => {
        const parts = tc.draw(gs.arrays(gs.oneOf(sentence, noise), { minSize: 1, maxSize: 4 }));
        const text = parts.join(tc.draw(gs.sampledFrom(["", " ", "\n", "`"])));
        const stdin = JSON.stringify({ tool_name: "mcp__x__y", tool_input: { body: text } });
        if (isProse(text) && !guard.test(stdin)) throw new Error(`guard skips prose: ${stdin}`);
      },
      { testCases: 1000 },
    );
  });
});
