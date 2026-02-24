import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { formatDecision } from "./markdown";
import { checkCode, checkMarkdown, processInput } from "./numbering";

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
  mode: "write" | "edit" | "external" = "write",
): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(input, mode);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("formatDecision", () => {
  it("formats deny decision", async () => {
    const output = formatDecision("deny", "Test reason");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Test reason",
      },
    });
  });

  it("formats ask decision", async () => {
    const output = formatDecision("ask", "Test reason");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Test reason",
      },
    });
  });
});

describe("checkMarkdown", () => {
  it('detects "# 1. Introduction"', async () => {
    const match = checkMarkdown("# 1. Introduction");
    expect(match).toContain("1. Introduction");
  });

  it('detects "## Step 2: Setup"', async () => {
    const match = checkMarkdown("## Step 2: Setup");
    expect(match).toContain("Step 2");
  });

  it('detects "### Phase 3"', async () => {
    const match = checkMarkdown("### Phase 3");
    expect(match).toContain("Phase 3");
  });

  it("allows descriptive headings", async () => {
    const match = checkMarkdown("# Introduction");
    expect(match).toBeNull();
  });

  it("allows headings with numbers mid-text", async () => {
    const match = checkMarkdown("# Using OAuth2 for Authentication");
    expect(match).toBeNull();
  });
});

describe.skipIf(!hasSg())("checkCode (requires sg)", () => {
  it("detects Go func step1()", async () => {
    const match = checkCode('package main\nfunc step1() { fmt.Println("test") }', "go");
    expect(match).toContain("step1");
  });

  it("detects Go func phase2()", async () => {
    const match = checkCode("package main\nfunc phase2() {}", "go");
    expect(match).toContain("phase2");
  });

  it("allows descriptive Go function names", async () => {
    const match = checkCode('package main\nfunc processItems() { fmt.Println("test") }', "go");
    expect(match).toBeNull();
  });

  it("detects JavaScript function step1()", async () => {
    const match = checkCode('function step1() { console.log("test"); }', "js");
    expect(match).toContain("step1");
  });

  it("detects JavaScript const part3", async () => {
    const match = checkCode("const part3 = () => {};", "js");
    expect(match).toContain("part3");
  });

  it("allows descriptive JavaScript names", async () => {
    const match = checkCode('function handleSubmit() { console.log("test"); }', "js");
    expect(match).toBeNull();
  });

  it("detects Python def step1()", async () => {
    const match = checkCode("def step1():\n    pass", "py");
    expect(match).toContain("step1");
  });

  it("detects Python class Phase2", async () => {
    const match = checkCode("class Phase2:\n    pass", "py");
    expect(match).toContain("Phase2");
  });

  it("allows descriptive Python names", async () => {
    const match = checkCode("def process_items():\n    pass", "py");
    expect(match).toBeNull();
  });

  it("detects TypeScript function step1()", async () => {
    const match = checkCode("function step1() {}", "ts");
    expect(match).toContain("step1");
  });
});

describe.skipIf(!hasSg())("processInput with code (requires sg)", () => {
  describe("Go numbered identifiers", () => {
    it("detects func step1()", async () => {
      const output = await getOutput(
        mockWriteInput("main.go", 'package main\nfunc step1() { fmt.Println("test") }'),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("step1");
    });

    it("detects func phase2()", async () => {
      const output = await getOutput(
        mockWriteInput("main.go", "package main\nfunc phase2() {}"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("phase2");
    });

    it("allows descriptive function names", async () => {
      const output = await getOutput(
        mockWriteInput("main.go", 'package main\nfunc processItems() { fmt.Println("test") }'),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("JavaScript numbered identifiers", () => {
    it("detects function step1()", async () => {
      const output = await getOutput(
        mockWriteInput("app.js", 'function step1() { console.log("test"); }'),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects const part3", async () => {
      const output = await getOutput(mockWriteInput("app.js", "const part3 = () => {};"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", async () => {
      const output = await getOutput(
        mockWriteInput("app.js", 'function handleSubmit() { console.log("test"); }'),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("Python numbered identifiers", () => {
    it("detects def step1()", async () => {
      const output = await getOutput(
        mockWriteInput("script.py", "def step1():\n    pass"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects class Phase2", async () => {
      const output = await getOutput(
        mockWriteInput("script.py", "class Phase2:\n    pass"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", async () => {
      const output = await getOutput(
        mockWriteInput("script.py", "def process_items():\n    pass"),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("Write vs Edit mode", () => {
    it("blocks Write tool with deny", async () => {
      const output = await getOutput(
        mockWriteInput("main.go", "package main\nfunc step1() {}"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("asks for Edit tool instead of deny", async () => {
      const output = await getOutput(mockEditInput("main.go", "func step1() {}"), "edit");
      expect(output?.permissionDecision).toBe("ask");
    });
  });

  describe("File type filtering", () => {
    it("checks Go files", async () => {
      const output = await getOutput(mockWriteInput("main.go", "func step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks TypeScript files", async () => {
      const output = await getOutput(mockWriteInput("app.ts", "function step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("skips unsupported file types (JSON)", async () => {
      const output = await getOutput(mockWriteInput("config.json", '{"step1": "value"}'), "write");
      expect(output).toBeNull();
    });
  });

  describe("Test files are NOT excluded", () => {
    it("checks *_test.go files", async () => {
      const output = await getOutput(mockWriteInput("main_test.go", "func step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks *.spec.ts files", async () => {
      const output = await getOutput(mockWriteInput("app.spec.ts", "function step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks test_*.py files", async () => {
      const output = await getOutput(
        mockWriteInput("test_utils.py", "def step1():\n    pass"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });
  });
});

describe("processInput with markdown", () => {
  it('detects "# 1. Introduction"', async () => {
    const output = await getOutput(mockWriteInput("README.md", "# 1. Introduction"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("1. Introduction");
  });

  it('detects "## Step 2: Setup"', async () => {
    const output = await getOutput(mockWriteInput("docs.md", "## Step 2: Setup"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Step 2");
  });

  it('detects "### Phase 3"', async () => {
    const output = await getOutput(mockWriteInput("guide.markdown", "### Phase 3"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Phase 3");
  });

  it("allows descriptive headings", async () => {
    const output = await getOutput(mockWriteInput("README.md", "# Introduction"), "write");
    expect(output).toBeNull();
  });

  it("allows headings with numbers mid-text", async () => {
    const output = await getOutput(
      mockWriteInput("README.md", "# Using OAuth2 for Authentication"),
      "write",
    );
    expect(output).toBeNull();
  });
});

describe("processInput with external mode", () => {
  it("detects numbered heading from MCP body", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "## Step 1: Setup\nContent here" },
      tool_use_id: "test",
    };
    const output = await getOutput(input, "external");
    expect(output?.permissionDecision).toBe("ask");
  });

  it("allows clean MCP body", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "## Summary\nClean content" },
      tool_use_id: "test",
    };
    const output = await getOutput(input, "external");
    expect(output).toBeNull();
  });

  it("uses ask instead of deny for external mode", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "# 1. First Step" },
      tool_use_id: "test",
    };
    const output = await getOutput(input, "external");
    expect(output?.permissionDecision).toBe("ask");
  });
});

describe("processInput edge cases", () => {
  it("returns null for Bash tool in write mode", async () => {
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
