import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput, checkMarkdown, checkCode, formatOutput } from "./numbering";

function hasSg(): boolean {
  try {
    execSync("command -v sg", { stdio: ["pipe", "pipe", "pipe"] });
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

function getOutput(
  input: PreToolUseHookInput,
  mode: "write" | "edit" = "write",
): PreToolUseHookSpecificOutput | null {
  const result = processInput(input, mode);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

describe("formatOutput", () => {
  it("formats deny decision", () => {
    const output = formatOutput("deny", "Test reason");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Test reason",
      },
    });
  });

  it("formats ask decision", () => {
    const output = formatOutput("ask", "Test reason");
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
  it('detects "# 1. Introduction"', () => {
    const match = checkMarkdown("# 1. Introduction");
    expect(match).toContain("1. Introduction");
  });

  it('detects "## Step 2: Setup"', () => {
    const match = checkMarkdown("## Step 2: Setup");
    expect(match).toContain("Step 2");
  });

  it('detects "### Phase 3"', () => {
    const match = checkMarkdown("### Phase 3");
    expect(match).toContain("Phase 3");
  });

  it("allows descriptive headings", () => {
    const match = checkMarkdown("# Introduction");
    expect(match).toBeNull();
  });

  it("allows headings with numbers mid-text", () => {
    const match = checkMarkdown("# Using OAuth2 for Authentication");
    expect(match).toBeNull();
  });
});

describe.skipIf(!hasSg())("checkCode (requires sg)", () => {
  it("detects Go func step1()", () => {
    const match = checkCode('package main\nfunc step1() { fmt.Println("test") }', "go");
    expect(match).toContain("step1");
  });

  it("detects Go func phase2()", () => {
    const match = checkCode("package main\nfunc phase2() {}", "go");
    expect(match).toContain("phase2");
  });

  it("allows descriptive Go function names", () => {
    const match = checkCode('package main\nfunc processItems() { fmt.Println("test") }', "go");
    expect(match).toBeNull();
  });

  it("detects JavaScript function step1()", () => {
    const match = checkCode('function step1() { console.log("test"); }', "js");
    expect(match).toContain("step1");
  });

  it("detects JavaScript const part3", () => {
    const match = checkCode("const part3 = () => {};", "js");
    expect(match).toContain("part3");
  });

  it("allows descriptive JavaScript names", () => {
    const match = checkCode('function handleSubmit() { console.log("test"); }', "js");
    expect(match).toBeNull();
  });

  it("detects Python def step1()", () => {
    const match = checkCode("def step1():\n    pass", "py");
    expect(match).toContain("step1");
  });

  it("detects Python class Phase2", () => {
    const match = checkCode("class Phase2:\n    pass", "py");
    expect(match).toContain("Phase2");
  });

  it("allows descriptive Python names", () => {
    const match = checkCode("def process_items():\n    pass", "py");
    expect(match).toBeNull();
  });

  it("detects TypeScript function step1()", () => {
    const match = checkCode("function step1() {}", "ts");
    expect(match).toContain("step1");
  });
});

describe.skipIf(!hasSg())("processInput with code (requires sg)", () => {
  describe("Go numbered identifiers", () => {
    it("detects func step1()", () => {
      const output = getOutput(
        mockWriteInput("main.go", 'package main\nfunc step1() { fmt.Println("test") }'),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("step1");
    });

    it("detects func phase2()", () => {
      const output = getOutput(
        mockWriteInput("main.go", "package main\nfunc phase2() {}"),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
      expect(output?.permissionDecisionReason).toContain("phase2");
    });

    it("allows descriptive function names", () => {
      const output = getOutput(
        mockWriteInput("main.go", 'package main\nfunc processItems() { fmt.Println("test") }'),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("JavaScript numbered identifiers", () => {
    it("detects function step1()", () => {
      const output = getOutput(
        mockWriteInput("app.js", 'function step1() { console.log("test"); }'),
        "write",
      );
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects const part3", () => {
      const output = getOutput(mockWriteInput("app.js", "const part3 = () => {};"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", () => {
      const output = getOutput(
        mockWriteInput("app.js", 'function handleSubmit() { console.log("test"); }'),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("Python numbered identifiers", () => {
    it("detects def step1()", () => {
      const output = getOutput(mockWriteInput("script.py", "def step1():\n    pass"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("detects class Phase2", () => {
      const output = getOutput(mockWriteInput("script.py", "class Phase2:\n    pass"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("allows descriptive names", () => {
      const output = getOutput(
        mockWriteInput("script.py", "def process_items():\n    pass"),
        "write",
      );
      expect(output).toBeNull();
    });
  });

  describe("Write vs Edit mode", () => {
    it("blocks Write tool with deny", () => {
      const output = getOutput(mockWriteInput("main.go", "package main\nfunc step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("asks for Edit tool instead of deny", () => {
      const output = getOutput(mockEditInput("main.go", "func step1() {}"), "edit");
      expect(output?.permissionDecision).toBe("ask");
    });
  });

  describe("File type filtering", () => {
    it("checks Go files", () => {
      const output = getOutput(mockWriteInput("main.go", "func step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks TypeScript files", () => {
      const output = getOutput(mockWriteInput("app.ts", "function step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("skips unsupported file types (JSON)", () => {
      const output = getOutput(mockWriteInput("config.json", '{"step1": "value"}'), "write");
      expect(output).toBeNull();
    });
  });

  describe("Test files are NOT excluded", () => {
    it("checks *_test.go files", () => {
      const output = getOutput(mockWriteInput("main_test.go", "func step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks *.spec.ts files", () => {
      const output = getOutput(mockWriteInput("app.spec.ts", "function step1() {}"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });

    it("checks test_*.py files", () => {
      const output = getOutput(mockWriteInput("test_utils.py", "def step1():\n    pass"), "write");
      expect(output?.permissionDecision).toBe("deny");
    });
  });
});

describe("processInput with markdown", () => {
  it('detects "# 1. Introduction"', () => {
    const output = getOutput(mockWriteInput("README.md", "# 1. Introduction"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("1. Introduction");
  });

  it('detects "## Step 2: Setup"', () => {
    const output = getOutput(mockWriteInput("docs.md", "## Step 2: Setup"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Step 2");
  });

  it('detects "### Phase 3"', () => {
    const output = getOutput(mockWriteInput("guide.markdown", "### Phase 3"), "write");
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("Phase 3");
  });

  it("allows descriptive headings", () => {
    const output = getOutput(mockWriteInput("README.md", "# Introduction"), "write");
    expect(output).toBeNull();
  });

  it("allows headings with numbers mid-text", () => {
    const output = getOutput(
      mockWriteInput("README.md", "# Using OAuth2 for Authentication"),
      "write",
    );
    expect(output).toBeNull();
  });
});

describe("processInput edge cases", () => {
  it("returns null for unknown tool", () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_use_id: "test",
    };
    expect(getOutput(input, "write")).toBeNull();
  });

  it("returns null for missing content", () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Write",
      tool_input: { file_path: "test.go" },
      tool_use_id: "test",
    };
    expect(getOutput(input, "write")).toBeNull();
  });
});
