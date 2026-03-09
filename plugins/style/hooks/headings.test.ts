import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { checkBoldAsHeading, checkTitleCase, processInput } from "./headings";

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

async function getOutput(input: PreToolUseHookInput): Promise<PreToolUseHookSpecificOutput | null> {
  const result = await processInput(input);
  if (!result) return null;
  return result.hookSpecificOutput as PreToolUseHookSpecificOutput;
}

const titleCaseCases: { description: string; content: string; match: boolean }[] = [
  { description: "lowercase heading", content: "# introduction", match: true },
  { description: "correctly cased heading", content: "# Introduction", match: false },
  { description: "mixed case heading", content: "## setup and Configuration", match: true },
  {
    description: "correctly cased multi-word",
    content: "## Setup and Configuration",
    match: false,
  },
  { description: "all inline code children", content: "## `context: fork`", match: false },
  {
    description: "correct case with inline code",
    content: "## Using `context: fork` in Skills",
    match: false,
  },
  {
    description: "bad case with inline code",
    content: "## using `context: fork` in skills",
    match: true,
  },
  { description: "uncapitalized first word (stop word)", content: "# the Guide", match: true },
  { description: "stop words mid-heading", content: "# The Guide to Everything", match: false },
  { description: "heading inside code block", content: "```\n# introduction\n```", match: false },
];

describe("checkTitleCase", () => {
  for (const { description, content, match } of titleCaseCases) {
    it(description, async () => {
      const result = checkTitleCase(content);
      if (match) {
        expect(result).not.toBeNull();
      } else {
        expect(result).toBeNull();
      }
    });
  }
});

const boldAsHeadingCases: { description: string; content: string; match: boolean }[] = [
  {
    description: "bold text ending with colon",
    content: "**Configuration:**\nSome text",
    match: true,
  },
  { description: "standalone bold-colon line", content: "**Setup Guide:**", match: true },
  { description: "bold mid-sentence", content: "Some text with **bold** words", match: false },
  {
    description: "bold without colon at start",
    content: "**Important** note about things",
    match: false,
  },
  { description: "bold inside code block", content: "```\n**Configuration:**\n```", match: false },
];

describe("checkBoldAsHeading", () => {
  for (const { description, content, match } of boldAsHeadingCases) {
    it(description, async () => {
      const result = checkBoldAsHeading(content);
      if (match) {
        expect(result).not.toBeNull();
      } else {
        expect(result).toBeNull();
      }
    });
  }
});

describe("processInput", () => {
  it("returns title case guidance", async () => {
    const output = await getOutput(mockWriteInput("README.md", "# introduction"));
    expect(output?.additionalContext).toContain("AP-style title case");
  });

  it("returns bold-as-heading guidance", async () => {
    const output = await getOutput(mockWriteInput("README.md", "**Configuration:**\nSome text"));
    expect(output?.additionalContext).toContain("markdown heading");
  });

  it("skips non-markdown files", async () => {
    expect(await getOutput(mockWriteInput("app.ts", "# introduction"))).toBeNull();
  });

  it("detects title case issue from MCP body", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "# introduction\nThis PR adds support for the new authentication flow" },
      tool_use_id: "test",
    };
    const output = await getOutput(input);
    expect(output?.additionalContext).toContain("AP-style title case");
  });

  it("allows correct title case from MCP body", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "mcp__plugin_github_github__create_pull_request",
      tool_input: { body: "# Introduction\nThis PR adds support for the new authentication flow" },
      tool_use_id: "test",
    };
    const output = await getOutput(input);
    expect(output).toBeNull();
  });

  it("detects title case issue from Bash heredoc", async () => {
    const input: PreToolUseHookInput = {
      hook_event_name: "PreToolUse",
      session_id: "test",
      transcript_path: "/tmp/test",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: {
        command: `gh pr create --body "$(cat <<'EOF'
# introduction
Some content here
EOF
)"`,
      },
      tool_use_id: "test",
    };
    const output = await getOutput(input);
    expect(output?.additionalContext).toContain("AP-style title case");
  });

  it("returns null for non-PR Bash command", async () => {
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
});
