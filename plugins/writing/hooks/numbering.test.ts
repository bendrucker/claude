import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@bendrucker/claude-plugin-toolkit";
import { formatDecision } from "./io";
import { check, checkCode, checkMarkdown, hasNumberingHint } from "./numbering";

function hasSg(): boolean {
  try {
    // Check if sg is ast-grep by verifying scan command works
    execSync("sg scan --help", { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function mockWriteInput(filePath: string, content: string): PreToolUseHookInput {
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

function mockEditInput(filePath: string, newString: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: filePath, new_string: newString },
    tool_use_id: "test",
  };
}

async function getOutput(
  input: PreToolUseHookInput,
  mode: "write" | "edit" = "write",
): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await check(input, mode);
  if (!result) return null;
  return result.output.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("formatDecision", () => {
  test.each<["deny" | "ask"]>([["deny"], ["ask"]])("formats %s decision", (decision) => {
    const output = formatDecision(decision, "Test reason");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: "Test reason",
      },
    });
  });
});

// Every shape checkMarkdown or a numbering.yml rule can flag must pass the
// hint. Content that cannot match must short-circuit before the expensive
// checks.
describe("hasNumberingHint", () => {
  test.each<{ name: string; content: string; hinted: boolean }>([
    { name: "markdown numbered heading", content: "## 1. Setup\n\nBody\n", hinted: true },
    { name: "markdown Step heading", content: "# Step 1\n", hinted: true },
    { name: "markdown Phase heading, wide gap", content: "# Phase    2\n", hinted: true },
    { name: "tab after heading number", content: "## 3.\tSetup\n", hinted: true },
    { name: "code identifier step1", content: "function step1() {}\n", hinted: true },
    { name: "code identifier Phase2", content: "class Phase2:\n    pass\n", hinted: true },
    {
      name: "code identifier part3 in any language",
      content: "part3 <- function(x) x\n",
      hinted: true,
    },
    { name: "plain prose", content: "Descriptive names only.\n", hinted: false },
    { name: "version string", content: "Bump to v1.2.3\n", hinted: false },
    { name: "bare code", content: "const total = sum(items)\n", hinted: false },
  ])("$name", ({ content, hinted }) => {
    expect(hasNumberingHint(content)).toBe(hinted);
  });
});

describe("checkMarkdown", () => {
  test.each<[string, string, string | null]>([
    ['detects "# 1. Introduction"', "# 1. Introduction", "1. Introduction"],
    ['detects "## Step 2: Setup"', "## Step 2: Setup", "Step 2"],
    ['detects "### Phase 3"', "### Phase 3", "Phase 3"],
    ["allows descriptive headings", "# Introduction", null],
    ["allows headings with numbers mid-text", "# Using OAuth2 for Authentication", null],
  ])("%s", (_name, content, expected) => {
    const match = checkMarkdown(content);
    expected === null ? expect(match).toBeNull() : expect(match).toContain(expected);
  });
});

describe.skipIf(!hasSg())("checkCode (requires sg)", () => {
  test.each<[string, string, string, string | null]>([
    [
      "detects Go func step1()",
      'package main\nfunc step1() { fmt.Println("test") }',
      "go",
      "step1",
    ],
    ["detects Go func phase2()", "package main\nfunc phase2() {}", "go", "phase2"],
    [
      "allows descriptive Go function names",
      'package main\nfunc processItems() { fmt.Println("test") }',
      "go",
      null,
    ],
    [
      "detects JavaScript function step1()",
      'function step1() { console.log("test"); }',
      "js",
      "step1",
    ],
    ["detects JavaScript const part3", "const part3 = () => {};", "js", "part3"],
    [
      "allows descriptive JavaScript names",
      'function handleSubmit() { console.log("test"); }',
      "js",
      null,
    ],
    ["detects Python def step1()", "def step1():\n    pass", "py", "step1"],
    ["detects Python class Phase2", "class Phase2:\n    pass", "py", "Phase2"],
    ["allows descriptive Python names", "def process_items():\n    pass", "py", null],
    ["detects TypeScript function step1()", "function step1() {}", "ts", "step1"],
    ["detects TSX function step1()", "function step1() {}", "tsx", "step1"],
  ])("%s", async (_name, content, lang, expected) => {
    const match = await checkCode(content, lang);
    expected === null ? expect(match).toBeNull() : expect(match).toContain(expected);
  });
});

describe.skipIf(!hasSg())("checkCode uncovered languages (requires sg)", () => {
  test.each<[string]>([
    ["sh"],
    ["json"],
    ["yml"],
    ["sql"],
  ])("returns null for extension %p with no numbering.yml rules", async (ext) => {
    expect(await checkCode("function step1() {}", ext)).toBeNull();
  });
});

describe.skipIf(!hasSg())("processInput with code (requires sg)", () => {
  test.each<[string, string, string, "write" | "edit", "deny" | "ask" | null, string | null]>([
    [
      "Go: detects func step1()",
      "main.go",
      'package main\nfunc step1() { fmt.Println("test") }',
      "write",
      "deny",
      "step1",
    ],
    [
      "Go: detects func phase2()",
      "main.go",
      "package main\nfunc phase2() {}",
      "write",
      "deny",
      "phase2",
    ],
    [
      "Go: allows descriptive function names",
      "main.go",
      'package main\nfunc processItems() { fmt.Println("test") }',
      "write",
      null,
      null,
    ],
    [
      "JavaScript: detects function step1()",
      "app.js",
      'function step1() { console.log("test"); }',
      "write",
      "deny",
      null,
    ],
    ["JavaScript: detects const part3", "app.js", "const part3 = () => {};", "write", "deny", null],
    [
      "JavaScript: allows descriptive names",
      "app.js",
      'function handleSubmit() { console.log("test"); }',
      "write",
      null,
      null,
    ],
    ["Python: detects def step1()", "script.py", "def step1():\n    pass", "write", "deny", null],
    ["Python: detects class Phase2", "script.py", "class Phase2:\n    pass", "write", "deny", null],
    [
      "Python: allows descriptive names",
      "script.py",
      "def process_items():\n    pass",
      "write",
      null,
      null,
    ],
    [
      "Write tool: blocks with deny",
      "main.go",
      "package main\nfunc step1() {}",
      "write",
      "deny",
      null,
    ],
    ["Edit tool: denies like Write", "main.go", "func step1() {}", "edit", "deny", null],
    ["File type filtering: checks Go files", "main.go", "func step1() {}", "write", "deny", null],
    [
      "File type filtering: checks TypeScript files",
      "app.ts",
      "function step1() {}",
      "write",
      "deny",
      null,
    ],
    [
      "File type filtering: skips unsupported file types (JSON)",
      "config.json",
      '{"step1": "value"}',
      "write",
      null,
      null,
    ],
    [
      "Test files are NOT excluded: checks *_test.go files",
      "main_test.go",
      "func step1() {}",
      "write",
      "deny",
      null,
    ],
    [
      "Test files are NOT excluded: checks *.spec.ts files",
      "app.spec.ts",
      "function step1() {}",
      "write",
      "deny",
      null,
    ],
    [
      "Test files are NOT excluded: checks test_*.py files",
      "test_utils.py",
      "def step1():\n    pass",
      "write",
      "deny",
      null,
    ],
  ])("%s", async (_name, filePath, content, mode, expected, reasonContains) => {
    const output = await getOutput(
      mode === "write" ? mockWriteInput(filePath, content) : mockEditInput(filePath, content),
      mode,
    );
    if (expected === null) {
      expect(output).toBeNull();
      return;
    }
    expect(output?.permissionDecision).toBe(expected);
    if (reasonContains !== null) {
      expect(output?.permissionDecisionReason).toContain(reasonContains);
    }
  });
});

describe("processInput with markdown", () => {
  test.each<[string, string, string, boolean, string | null]>([
    ['detects "# 1. Introduction"', "README.md", "# 1. Introduction", true, "1. Introduction"],
    ['detects "## Step 2: Setup"', "docs.md", "## Step 2: Setup", true, "Step 2"],
    ['detects "### Phase 3"', "guide.markdown", "### Phase 3", true, "Phase 3"],
    ["allows descriptive headings", "README.md", "# Introduction", false, null],
    [
      "allows headings with numbers mid-text",
      "README.md",
      "# Using OAuth2 for Authentication",
      false,
      null,
    ],
  ])("%s", async (_name, filePath, content, flagged, reasonContains) => {
    const output = await getOutput(mockWriteInput(filePath, content), "write");
    if (!flagged) {
      expect(output).toBeNull();
      return;
    }
    expect(output).not.toHaveProperty("permissionDecision");
    if (reasonContains) {
      expect(output?.additionalContext).toContain(reasonContains);
    }
  });

  it("prefixes the edit-mode reminder", async () => {
    const output = await getOutput(mockEditInput("README.md", "# 1. Introduction"), "edit");
    expect(output?.additionalContext).toContain("This edit introduces numbered sequences.");
  });
});

describe("processInput edge cases", () => {
  it("returns null for unknown tool", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_use_id: "test",
    };
    expect(await getOutput(input, "write")).toBeNull();
  });

  it("returns null for missing content", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Write",
      tool_input: { file_path: "test.go" },
      tool_use_id: "test",
    };
    expect(await getOutput(input, "write")).toBeNull();
  });
});

describe("already-numbered files", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "numbering-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("allows Edit when the file already has numbered headings", async () => {
    const filePath = join(dir, "review.md");
    await Bun.write(filePath, "# Findings\n\n## 1. First issue\n\nDetails.\n");
    const output = await getOutput(mockEditInput(filePath, "## 2. Second issue"), "edit");
    expect(output).toBeNull();
  });

  it("reminds when Edit introduces numbering into a clean file", async () => {
    const filePath = join(dir, "clean.md");
    await Bun.write(filePath, "# Findings\n\nDetails.\n");
    const output = await getOutput(mockEditInput(filePath, "## 1. First issue"), "edit");
    expect(output?.additionalContext).toContain("numbered sequences");
  });

  it("allows non-numbered Edit to an already-numbered file", async () => {
    const filePath = join(dir, "review.md");
    await Bun.write(filePath, "# Findings\n\n## 1. First issue\n");
    const output = await getOutput(mockEditInput(filePath, "More details."), "edit");
    expect(output).toBeNull();
  });

  it("allows Write overwriting a file that already has numbered headings", async () => {
    const filePath = join(dir, "review.md");
    await Bun.write(filePath, "## 1. First issue\n");
    const output = await getOutput(
      mockWriteInput(filePath, "## 1. First issue\n\n## 2. Second issue\n"),
      "write",
    );
    expect(output).toBeNull();
  });

  it("reminds when Write creates a new numbered file", async () => {
    const filePath = join(dir, "new.md");
    const output = await getOutput(mockWriteInput(filePath, "# 1. Introduction"), "write");
    expect(output?.additionalContext).toContain("numbered sequences");
  });

  describe.skipIf(!hasSg())("code files (requires sg)", () => {
    it("allows Edit when the file already has numbered identifiers", async () => {
      const filePath = join(dir, "main.go");
      await Bun.write(filePath, "package main\nfunc step1() {}\n");
      const output = await getOutput(mockEditInput(filePath, "func step2() {}"), "edit");
      expect(output).toBeNull();
    });

    it("denies when Edit introduces numbering into a clean code file", async () => {
      const filePath = join(dir, "main.go");
      await Bun.write(filePath, "package main\nfunc processItems() {}\n");
      const output = await getOutput(mockEditInput(filePath, "func step1() {}"), "edit");
      expect(output?.permissionDecision).toBe("deny");
    });
  });
});

describe("markdown context tier", () => {
  it("reminds rather than blocks on markdown Write", async () => {
    const output = await getOutput(mockWriteInput("README.md", "# 1. Introduction"), "write");
    expect(output).not.toHaveProperty("permissionDecision");
    expect(output?.additionalContext).toContain("numbered sequences");
  });
});
