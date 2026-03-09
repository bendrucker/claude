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

function mockMcpInput(toolName: string, toolInput: Record<string, unknown>): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "test",
  };
}

async function getOutput(input: PreToolUseHookInput): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(input);
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
      );
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("step1");
    });

    it("detects func phase2()", async () => {
      const output = await getOutput(mockWriteInput("main.go", "package main\nfunc phase2() {}"));
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("phase2");
    });

    it("allows descriptive function names", async () => {
      const output = await getOutput(
        mockWriteInput("main.go", 'package main\nfunc processItems() { fmt.Println("test") }'),
      );
      expect(output).toBeNull();
    });
  });

  describe("JavaScript numbered identifiers", () => {
    it("detects function step1()", async () => {
      const output = await getOutput(
        mockWriteInput("app.js", 'function step1() { console.log("test"); }'),
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects const part3", async () => {
      const output = await getOutput(mockWriteInput("app.js", "const part3 = () => {};"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", async () => {
      const output = await getOutput(
        mockWriteInput("app.js", 'function handleSubmit() { console.log("test"); }'),
      );
      expect(output).toBeNull();
    });
  });

  describe("Python numbered identifiers", () => {
    it("detects def step1()", async () => {
      const output = await getOutput(mockWriteInput("script.py", "def step1():\n    pass"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects class Phase2", async () => {
      const output = await getOutput(mockWriteInput("script.py", "class Phase2:\n    pass"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", async () => {
      const output = await getOutput(mockWriteInput("script.py", "def process_items():\n    pass"));
      expect(output).toBeNull();
    });
  });

  describe("Write vs Edit mode", () => {
    it("blocks Write tool with deny", async () => {
      const output = await getOutput(mockWriteInput("main.go", "package main\nfunc step1() {}"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("asks for Edit tool instead of deny", async () => {
      const output = await getOutput(mockEditInput("main.go", "func step1() {}"));
      expect(output?.permissionDecision).toBe("ask");
    });
  });

  describe("File type filtering", () => {
    it("checks Go files", async () => {
      const output = await getOutput(mockWriteInput("main.go", "func step1() {}"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks TypeScript files", async () => {
      const output = await getOutput(mockWriteInput("app.ts", "function step1() {}"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("skips unsupported file types (JSON)", async () => {
      const output = await getOutput(mockWriteInput("config.json", '{"step1": "value"}'));
      expect(output).toBeNull();
    });
  });

  describe("Test files are NOT excluded", () => {
    it("checks *_test.go files", async () => {
      const output = await getOutput(mockWriteInput("main_test.go", "func step1() {}"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks *.spec.ts files", async () => {
      const output = await getOutput(mockWriteInput("app.spec.ts", "function step1() {}"));
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks test_*.py files", async () => {
      const output = await getOutput(mockWriteInput("test_utils.py", "def step1():\n    pass"));
      expect(output?.permissionDecision).toBe("deny");
    });
  });
});

describe("processInput with markdown", () => {
  it('detects "# 1. Introduction"', async () => {
    const output = await getOutput(mockWriteInput("README.md", "# 1. Introduction"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("1. Introduction");
  });

  it('detects "## Step 2: Setup"', async () => {
    const output = await getOutput(mockWriteInput("docs.md", "## Step 2: Setup"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Step 2");
  });

  it('detects "### Phase 3"', async () => {
    const output = await getOutput(mockWriteInput("guide.markdown", "### Phase 3"));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Phase 3");
  });

  it("allows descriptive headings", async () => {
    const output = await getOutput(mockWriteInput("README.md", "# Introduction"));
    expect(output).toBeNull();
  });

  it("allows headings with numbers mid-text", async () => {
    const output = await getOutput(
      mockWriteInput("README.md", "# Using OAuth2 for Authentication"),
    );
    expect(output).toBeNull();
  });
});

describe("processInput with MCP tools", () => {
  it("detects numbered heading from MCP body", async () => {
    const output = await getOutput(
      mockMcpInput("mcp__claude_ai_Linear__save_issue", {
        title: "Add feature",
        description: "## Step 1: Setup\nInstall dependencies and configure the environment",
      }),
    );
    expect(output?.permissionDecision).toBe("ask");
  });

  it("allows clean MCP body", async () => {
    const output = await getOutput(
      mockMcpInput("mcp__plugin_github_github__create_pull_request", {
        title: "Add feature",
        body: "## Summary\nClean content with enough text to pass the length threshold for extraction",
      }),
    );
    expect(output).toBeNull();
  });

  it("uses ask instead of deny for MCP tools", async () => {
    const output = await getOutput(
      mockMcpInput("mcp__plugin_github_github__create_pull_request", {
        title: "Add feature",
        body: "# 1. First Step\nThis body has enough content to be extracted as markdown",
      }),
    );
    expect(output?.permissionDecision).toBe("ask");
  });

  it("detects numbered heading from Bash heredoc", async () => {
    const output = await getOutput(
      mockMcpInput("Bash", {
        command: `gh pr create --body "$(cat <<'EOF'\n## Step 1: Setup\nInstall dependencies\nEOF\n)"`,
      }),
    );
    expect(output?.permissionDecision).toBe("ask");
  });

  it("skips MCP tools with no markdown content", async () => {
    const output = await getOutput(
      mockMcpInput("mcp__claude_ai_Linear__save_issue", {
        title: "Short title",
        team: "ENG",
      }),
    );
    expect(output).toBeNull();
  });
});

describe("processInput edge cases", () => {
  it("returns null for Bash without markdown content", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_use_id: "test",
    };
    expect(await getOutput(input)).toBeNull();
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
    expect(await getOutput(input)).toBeNull();
  });
});
