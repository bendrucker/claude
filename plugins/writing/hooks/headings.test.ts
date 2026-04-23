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

function getOutput(input: PreToolUseHookInput): PreToolUseHookSpecificOutput | null {
  const result = processInput(input);
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
    it(description, () => {
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
    it(description, () => {
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
  it("returns title case guidance", () => {
    const output = getOutput(mockWriteInput("README.md", "# introduction"));
    expect(output?.additionalContext).toContain("AP-style title case");
  });

  it("returns bold-as-heading guidance", () => {
    const output = getOutput(mockWriteInput("README.md", "**Configuration:**\nSome text"));
    expect(output?.additionalContext).toContain("markdown heading");
  });

  it("skips non-markdown files", () => {
    expect(getOutput(mockWriteInput("app.ts", "# introduction"))).toBeNull();
  });

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
    expect(getOutput(input)).toBeNull();
  });

  it("skips memory markdown files", () => {
    const memoryPath = `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`;
    expect(getOutput(mockWriteInput(memoryPath, "# introduction"))).toBeNull();
  });
});
