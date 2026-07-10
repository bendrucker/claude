import { describe, expect, it } from "bun:test";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { checkBoldAsHeading, checkSentenceHeading, checkTitleCase, processInput } from "./headings";

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
  {
    description: "lowercase as (AP stop word) mid-heading",
    content: "## The Tagger Comparison as an Eval Device, Not the Architecture",
    match: false,
  },
  {
    description: "lowercase vs. (AP stop word) mid-heading",
    content: "## Relationship to Other Issues, and What to Hold vs. Do Ad Hoc",
    match: false,
  },
  {
    description: "capitalized As (incorrect AP case)",
    content: "## Treat It As a Device",
    match: true,
  },
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

const sentenceHeadingCases: { description: string; content: string; match: boolean }[] = [
  {
    description: "topic colon with linking verb",
    content: "## The Cache Layer: Redis Holds the Session State",
    match: true,
  },
  {
    description: "subject plus linking verb",
    content: "## Latency Is the Main Bottleneck",
    match: true,
  },
  {
    description: "colon clause with not an",
    content: "## Rollback: A Safety Net, Not an Undo Button",
    match: true,
  },
  {
    description: "colon clause with is the default",
    content: "## Caching Strategy: Write-Through Is the Default",
    match: true,
  },
  {
    description: "relative clause with how/handle",
    content: "## Prior Art: How Other Brokers Handle This",
    match: true,
  },
  {
    description: "imperative opener build",
    content: "## Build Against the Documented Limits",
    match: true,
  },
  {
    description: "relative clause with that and keep",
    content: "## Joints That Keep the Prototype From Becoming Debt",
    match: true,
  },
  {
    description: "imperative list document/stabilize/expose",
    content: "## Document, Stabilize, and Expose the Internal Cache API",
    match: true,
  },
  {
    description: "parenthetical with trailing clause and linking verb",
    content: "## Token Exchange (RFC 8693) So the Proxy Never Holds a User Token",
    match: true,
  },
  { description: "short topic label", content: "## Cache Layer", match: false },
  { description: "short topic label prior art", content: "## Prior Art", match: false },
  { description: "short topic label blast radius", content: "## Blast Radius", match: false },
  { description: "short topic label error taxonomy", content: "## Error Taxonomy", match: false },
  {
    description: "topic with parenthetical citation",
    content: "## Token Exchange (RFC 8693)",
    match: false,
  },
  { description: "single word size", content: "## Size", match: false },
  { description: "single word proposal", content: "## Proposal", match: false },
  { description: "imperative two words below threshold", content: "## Build Now", match: false },
  { description: "enumerator stage", content: "## Stage 1: Context Gathering", match: false },
  { description: "enumerator step", content: "## Step 1: Read the Transcript", match: false },
  { description: "enumerator phase", content: "## Phase: Calendar", match: false },
  { description: "enumerator example", content: "## Example: Blog Schema", match: false },
  {
    description: "enumerator pattern",
    content: "## Pattern 2: Domain-specific organization",
    match: false,
  },
  {
    description: "documented miss: 5 words, of-phrase, no verb",
    content: "## Blast Radius of a Leaked Key",
    match: false,
  },
  {
    description: "documented miss: verb-less, 4 words after stripping parenthetical",
    content: "## Machine-Readable Internal Error Taxonomy (Client vs Server Cases)",
    match: false,
  },
  {
    description: "documented miss: colon clause whose verb is outside the linking set",
    content: "## Refresh: Now Supported at the Edge, Unconfirmed for the Client",
    match: false,
  },
  {
    description: "documented miss: long verb-less noun phrase",
    content: "## Programmatic, Conformant Schema Registration Guidance for Multi-Tenant Setups",
    match: false,
  },
  {
    description: "long noun-phrase title with no verb",
    content: "## Architecture Review: CLI Command Package Layout",
    match: false,
  },
  {
    description: "ticket-prefixed task heading",
    content: "## ABC-1234: Defer eager view binding in the loader",
    match: false,
  },
  {
    description: "interrogative rationale label with linking verb",
    content: "## Why the Default Is Unsafe",
    match: false,
  },
  { description: "interrogative section label", content: "## What was wrong", match: false },
  { description: "inline-code-only heading", content: "## `context: fork`", match: false },
];

describe("checkSentenceHeading", () => {
  for (const { description, content, match } of sentenceHeadingCases) {
    it(description, () => {
      const result = checkSentenceHeading(content);
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

  it("returns sentence-heading guidance", () => {
    const output = getOutput(mockWriteInput("README.md", "## Latency Is the Main Bottleneck"));
    expect(output?.additionalContext).toContain("first sentence");
  });

  it("returns null for a short noun-phrase heading", () => {
    expect(getOutput(mockWriteInput("README.md", "# Cache Layer"))).toBeNull();
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
});
