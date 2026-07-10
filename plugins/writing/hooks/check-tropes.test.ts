import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { check, collectText } from "./check-tropes";

async function processInput(input: PreToolUseHookInput): Promise<SyncHookJSONOutput | null> {
  return (await check(input))?.output ?? null;
}

function mockWrite(content: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Write",
    tool_input: { file_path: "test.md", content },
    tool_use_id: "test",
  };
}

function mockEdit(newString: string, oldString?: string): PreToolUseHookInput {
  const toolInput: Record<string, unknown> = {
    file_path: "test.md",
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

function mockMultiEdit(
  edits: Array<{ old_string?: string; new_string: string }>,
): PreToolUseHookInput {
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

describe("wordlist files", () => {
  const wordlistPath = "/Users/test/plugins/writing/wordlists/vocabulary.txt";

  test.each<[string, string, string]>([
    [
      "skips Write to wordlist file containing flagged vocabulary",
      "Write",
      "delve\ntapestry\nbolstered\n",
    ],
    ["skips Edit to wordlist file", "Edit", "delve\nadded entry\n"],
  ])("%s", async (_name, tool, content) => {
    const input = tool === "Write" ? mockWrite(content) : mockEdit(content);
    (input.tool_input as Record<string, unknown>).file_path = wordlistPath;
    expect(await processInput(input)).toBeNull();
  });

  it("does not skip non-wordlist .txt files", async () => {
    const input = mockWrite("delve into the data is the way forward.");
    (input.tool_input as Record<string, unknown>).file_path = "/tmp/notes.txt";
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });
});

describe("connector density file scoping", () => {
  const denseText =
    "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed. The parser rejects malformed input; it returns an error. The server validates each field. The client sends a token. The job runs nightly.";

  it("flags connector density in markdown files", async () => {
    const input = mockWrite(denseText);
    const result = await processInput(input);
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("skips connector density in shell scripts", async () => {
    const input = mockWrite(denseText);
    (input.tool_input as Record<string, unknown>).file_path = "deploy.sh";
    expect(await processInput(input)).toBeNull();
  });

  it("skips connector density in TypeScript files", async () => {
    const input = mockWrite(denseText);
    (input.tool_input as Record<string, unknown>).file_path = "index.ts";
    expect(await processInput(input)).toBeNull();
  });
});

describe("Write/Edit", () => {
  it("returns reminder for Write with spaced em dash", async () => {
    const result = await processInput(mockWrite("This \u2014 is bad"));
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    const ctx = (result?.hookSpecificOutput as { additionalContext: string }).additionalContext;
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
    const input = mockWrite("Title \u2014 already here in the existing file.\nAdded line.\n");
    (input.tool_input as Record<string, unknown>).file_path = file;
    const result = await processInput(input);
    await rm(dir, { recursive: true, force: true });
    expect(result).toBeNull();
  });

  it("flags Write that adds a new em dash beyond what file had", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trope-diff-"));
    const file = join(dir, "doc.md");
    await Bun.write(file, "Title \u2014 already here.\n");
    const input = mockWrite("Title \u2014 already here.\nNow another \u2014 line.\n");
    (input.tool_input as Record<string, unknown>).file_path = file;
    const result = await processInput(input);
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
    const input = mockEdit(newString, oldString);
    (input.tool_input as Record<string, unknown>).file_path = "index.ts";
    return input;
  }

  it("flags a code-file edit introducing a spliced comment", async () => {
    const result = await processInput(
      codeEdit("// keep sorted; callers rely on order\nconst x = 1;", "const x = 1;"),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
    const ctx = (result?.hookSpecificOutput as { additionalContext: string }).additionalContext;
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

  it("ignores commented-out code in a code file", async () => {
    expect(
      await processInput(codeEdit("// foo(); bar()\nconst x = 1;", "const x = 1;")),
    ).toBeNull();
  });

  it("ignores splices in code outside comments", async () => {
    expect(
      await processInput(codeEdit('const label = "cold start; warm later";', "const label = 1;")),
    ).toBeNull();
  });

  it("flags two splices in a short prose file", async () => {
    const result = await processInput(
      mockWrite(
        "The cache starts cold; the first request fills it. The retry logic backs off; later attempts succeed.",
      ),
    );
    expect(result?.hookSpecificOutput).toHaveProperty("additionalContext");
  });

  it("stays silent on a single semicolon in prose", async () => {
    expect(
      await processInput(mockWrite("The cache starts cold; the first request fills it.")),
    ).toBeNull();
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
    await Bun.write(file, "We must delve into the issue");
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

  it("returns null for non-text Bash commands", async () => {
    expect(await processInput(mockBash("git push origin main"))).toBeNull();
  });
});
