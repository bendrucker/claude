---
name: hooks
description: Use this skill when you need to configure, create, or troubleshoot Claude Code hooks. This includes setting up PreToolUse hooks, PostToolUse hooks, UserPromptSubmit hooks, or any automation within Claude Code. Examples include "I want to run tests before every file edit", "My hook isn't firing", or "How do I create a hook that formats JSON output with jq?"
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.anthropic.com)]
---

# Claude Code Hooks

Reference for creating and configuring Claude Code hooks. When uncertain about syntax or features, use the Task tool with `subagent_type='claude-code-guide'` to consult official documentation.

## Hook Types

| Type | Trigger | Use Cases |
|------|---------|-----------|
| PreToolUse | Before tool execution | Validate inputs, block operations, modify parameters |
| PostToolUse | After tool completes | Check results, run linters, provide feedback |
| UserPromptSubmit | When user sends message | Pre-process input, add context |
| Stop | Session ends | Cleanup, save state |
| SubagentStop | Subagent completes | Process results |
| PreCompact | Before context compaction | Save important state |
| Notification | System notification | Log events |

## Configuration Files

- `~/.claude/settings.json` - User-level (global)
- `.claude/settings.json` - Project-level
- `.claude/settings.local.json` - Local (not committed)
- Plugin hooks: `plugins/<name>/hooks/hooks.json`

## Hook Structure

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx hooks/biome"
          }
        ]
      }
    ]
  }
}
```

**Matcher Patterns**:
- Simple: `"Write"`, `"Edit"`
- Multiple: `"Edit|Write|MultiEdit"`
- With args: `"Bash(npm:*)"`, `"Bash(osascript:*)|Bash(open:*)"`
- MCP tools: `"mcp__linear__create_issue"`

## Hook Input

Commands receive JSON on stdin:

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.ts",
    "content": "..."
  },
  "cwd": "/project/root",
  "session_id": "...",
  "transcript_path": "..."
}
```

Parse in shell:
```bash
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')
```

Or use `@constellos/claude-code-kit/runners`:
```typescript
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
const input = await readStdinJson<PreToolUseHookInput>();
```

## Hook Output

**PreToolUse** - Control execution:
```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Use gh cli instead"}}
```

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": {"state": "Todo"}}}
```

**PostToolUse** - Provide feedback:
```json
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Lint errors found..."}}
```

Exit with no output to allow without modification.

## Script Storage

Store complex hooks in `.claude/hooks/` or project `hooks/` directory:

```
.claude/
├── settings.json
└── hooks/
    └── my-hook.ts
```

Reference with:
```json
"command": "npx tsx $CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.ts"
```

## Examples

See these repositories for hook implementations:
- Input modification: [plugins/linear/hooks/](plugins/linear/hooks/)
- Permission decisions: [plugins/github/scripts/](plugins/github/scripts/)
- PostToolUse feedback: [hooks/biome/](hooks/biome/)
