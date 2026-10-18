import { expect, test } from "bun:test";
import { parseContext, parseProbeStream, parseTokens } from "./startup-context";

test.each<[string, number]>([
  ["15.3k", 15300],
  ["657", 657],
  ["~110", 110],
  ["< 20", 20],
  ["2.8k", 2800],
])("parseTokens(%p) is %p", (text, expected) => {
  expect(parseTokens(text)).toBe(expected);
});

const CONTEXT = `## Context Usage

**Model:** claude-sonnet-5-5
**Tokens:** 27.9k / 280k (10%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.5k | 0.9% |
| Memory files | 12.2k | 4.4% |
| Skills | 9.5k | 3.4% |

### MCP Tools

| Tool | Server | Tokens |
|------|--------|--------|
| mcp__docs__read | docs | 318 |

### Custom Agents

| Agent Type | Source | Tokens |
|------------|--------|--------|
| analyst | User | 137 |

### Memory Files

| Type | Path | Tokens |
|------|------|--------|
| User | /home/user/.claude/CLAUDE.md | 2.8k |

### Skills

| Skill | Source | Tokens |
|-------|--------|--------|
| grilling | User | ~90 |
| code-review | Built-in | < 20 |
`;

test("parseContext reads every table under its heading", () => {
  expect(parseContext(CONTEXT)).toMatchSnapshot();
});

function usage(input: number, write: number, read: number) {
  return { input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read };
}

test("parseProbeStream takes each thread's first turn and names subagents by their spawn", () => {
  const stream = [
    { type: "system", subtype: "init" },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        usage: usage(2, 40000, 4000),
        content: [
          { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "analyst" } },
          { type: "tool_use", id: "t2", name: "Agent", input: { subagent_type: "Explore" } },
        ],
      },
    },
    {
      type: "assistant",
      parent_tool_use_id: "t1",
      message: { usage: usage(3, 20000, 0), content: [] },
    },
    {
      type: "assistant",
      parent_tool_use_id: "t1",
      message: { usage: usage(1, 5, 20003), content: [] },
    },
    {
      type: "assistant",
      parent_tool_use_id: "t2",
      message: { usage: usage(3, 0, 19000), content: [] },
    },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { usage: usage(1, 100, 44002), content: [] },
    },
    { type: "result", total_cost_usd: 0.5 },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");
  expect(parseProbeStream(stream)).toEqual({
    costUsd: 0.5,
    main: 44002,
    agents: { analyst: 20003, Explore: 19003 },
  });
});
