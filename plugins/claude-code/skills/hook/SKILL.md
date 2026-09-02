---
name: claude-code:hook
description: Configure, create, or troubleshoot Claude Code hooks (PreToolUse, PostToolUse, UserPromptSubmit), debug hook failures, or set up any automation within Claude Code. Examples include "I want to run tests before every file edit", "My hook isn't firing", "1 out of 2 hooks ran", or "How do I create a hook that formats JSON output with jq?"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - WebFetch(domain:docs.anthropic.com)
---

# Claude Code Hooks

Reference for creating and configuring Claude Code hooks. When uncertain about syntax or features, use the `Agent` tool with `subagent_type='claude-code-guide'` to consult official docs.

## Hook Types

| Type | Trigger | Use Cases |
|------|---------|-----------|
| PreToolUse | Before tool execution | Validate inputs, block operations, modify parameters |
| PostToolUse | After tool completes | Check results, run linters, provide feedback |
| UserPromptSubmit | When user sends message | Pre-process input, add context |
| PermissionRequest | Permission dialog appears | Return a decision, notify a remote approver |
| Stop | Agent finishes a turn | Cleanup, save state |
| StopFailure | Agent stops on failure | Report the failure |
| SubagentStart / SubagentStop | Subagent spawns / completes | Process results |
| SessionStart / SessionEnd | Session begins / ends | Inject context, export state |
| PreCompact / PostCompact | Around context compaction | Save important state |
| Notification | System notification | Log events |
| TeammateIdle | Teammate about to go idle | Hand off work |

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
            "command": "bun ./hooks/ox"
          }
        ]
      }
    ]
  }
}
```

#### Matcher Patterns

- Simple: `"Write"`, `"Edit"`
- Multiple: `"Edit|Write|MultiEdit"`
- With args: `"Bash(npm:*)"`, `"Bash(osascript:*)|Bash(open:*)"`
- MCP tools: `"mcp__linear__create_issue"`
- Plugin MCP tools: `"mcp__plugin_<plugin>_<namespace>__<tool>"`
- Claude AI MCP tools: `"mcp__claude_ai_<DisplayName>__<tool>"`
- All three patterns: `"mcp__linear__create_issue|mcp__plugin_linear_linear__create_issue|mcp__claude_ai_Linear__save_issue"`

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

Stdin is external data, so decode it with a zod schema covering the fields the hook reads. A plugin hook keeps that schema local, since it cannot import a workspace package:

```typescript
import { z } from "zod";

const HookInput = z.looseObject({
  cwd: z.string().catch(""),
  tool_input: z.looseObject({ file_path: z.string().optional().catch(undefined) }).catch({}),
});

let input: z.infer<typeof HookInput>;
try {
  input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
} catch (error) {
  console.error(`[my-hook] undecodable stdin: ${error}`);
  process.exit(0);
}
```

`looseObject` keeps fields the harness adds later, and `.catch` supplies a per-field default so one unexpected value costs that field rather than the whole payload.

On an undecodable payload, log one line to stderr and exit 0 so the tool call proceeds. A gate exits 1 instead, letting the call through while the harness surfaces the stderr line, so a gate that has stopped deciding says so rather than reading as a call that passed every rule ([plugins/plan/hooks/gate.ts](../../../plan/hooks/gate.ts)). Reserve exit 2 for the block itself.

## Hook Output

**PreToolUse** - Control execution:
```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Use gh cli instead"}}
```

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": {"state": "Todo"}}}
```

On `ExitPlanMode`, `ask` is inert: the tool runs its own plan-approval prompt, and the harness drops the hook's `permissionDecisionReason` and `systemMessage` both. Use `deny` there to carry a reason back.

**PostToolUse** - Provide feedback:
```json
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Lint errors found..."}}
```

Exit with no output to allow without modification.

## Async

`"async": true` on a command hook backgrounds it so the turn does not wait. Nothing above reaches the model: no `permissionDecision`, no `updatedInput`, no `additionalContext`, and exit code 2 does not block. Verified on 2.1.220 that stderr and a nonzero exit are both dropped. `"asyncRewake": true` backgrounds the hook but wakes the model on exit code 2, delivering stderr (or stdout when stderr is empty) as a system reminder. Neither field applies to `prompt` or `agent` hooks.

Use `async` only for a hook that is a pure side effect: a notifier, a status bridge, a terminal bell, a state export. Keep it off when the hook returns any of the output above, mutates state a later step reads, or gates a tool call.

Two events behave differently from the rest, measured on 2.1.220:

- `Stop` kills the backgrounded process almost immediately. Anything past a few milliseconds never finishes. A `Stop` notifier must stay synchronous.
- `SessionEnd` outlives the CLI. A backgrounded hook there runs to completion after the process exits, making it safe to background.

`SubagentStop`, `SessionStart`, `UserPromptSubmit`, and `PostToolUse` all run to completion when backgrounded.

Hooks on the same event already run concurrently with each other, so `async` only shortens the turn when the side-effect hook is the slowest one on its event. It is still worth setting on a hook that qualifies, because the payoff moves as sibling hooks change.

## Script Storage

Store complex hooks in `.claude/hooks/` or a project `hooks/` directory, referenced with:

```json fragment
"command": "bun $CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.ts"
```

## Examples

See these repositories for hook implementations:
- Input modification: [plugins/linear/hooks/](../../../linear/hooks/)
- Permission decisions: [plugins/github/scripts/](../../../github/scripts/)
- PostToolUse feedback: [.claude/hooks/ox/](../../../../.claude/hooks/ox/)

## Debugging

For troubleshooting hook failures, see [debugging](references/debugging.md).
