# `permission-denied`

`PermissionDenied` hook that records every auto mode classifier denial to disk. What auto mode costs then becomes measurable rather than anecdotal.

## Why

A classifier denial leaves no trace anywhere durable. It never reaches the transcript, which puts it beyond the [session index](../../../plugins/claude-code/skills/session), and the `/permissions` **Recently denied** tab is per-session and in-memory. Only user *rejections* of a permission prompt are recorded, and those are a different event. With `permissions.defaultMode` set to `auto`, the classifier is the gate on nearly every session, and without this hook there is no way to answer whether a given `autoMode` rule is earning its place or misfiring.

The event fires only for classifier denials. A manually denied prompt, a `PreToolUse` block, and a `deny` rule match are all different events and none of them reach this hook.

## Behavior

Reads the `PermissionDenied` payload on stdin and writes one JSON object per denial:

| Field | Source |
| --- | --- |
| `timestamp` | ISO 8601, written when the hook runs |
| `session_id`, `cwd`, `tool_name`, `reason` | passed through from the payload |
| `target` | the first populated field of `command`, `file_path`, `url`, `path`, `notebook_path`, `prompt`; otherwise the whole `tool_input` as JSON |

Records go to `~/.claude/auto-mode-denials/`, overridable with `CLAUDE_AUTO_MODE_DENIAL_DIR`. Each denial gets its own file named `<timestamp>-<tool_use_id>.json`, which sorts chronologically.

A single appended log would read better, but Bun exposes no append primitive and `node:fs` append is off-limits under this repo's Biome config. Read-modify-write was the alternative, and it drops records when two sessions are denied at the same moment. A file per denial has neither problem.

The hook never returns `hookSpecificOutput.retry`. Retrying is a judgment call about whether the denial was wrong, which belongs to the person reading the log rather than to a hook that fires on every denial. Every failure path is silent: the denial has already happened, the exit code is ignored on this event, and a broken logger should not become session noise.

## Reading It

```sh
jq -r '[.timestamp, .tool_name, .target] | @tsv' ~/.claude/auto-mode-denials/*.json | tail -20
```

Group by what was blocked, to see whether one destination or verb dominates:

```sh
jq -r '.target | split(" ")[0:2] | join(" ")' ~/.claude/auto-mode-denials/*.json | sort | uniq -c | sort -rn
```

A destination that recurs belongs in `autoMode.environment`. A command shape that recurs belongs in `autoMode.allow`. Both live in [`user/settings.json`](../../settings.json); the classifier does not read project settings.

## Removal

This hook exists to produce evidence. It is done when the evidence stops changing decisions. Drop it when a month of log has produced no `autoMode` change and no denial worth acting on, or when Claude Code starts recording classifier denials somewhere the session index can reach. Check with:

```sh
ls ~/.claude/auto-mode-denials | wc -l
```

An empty or near-empty directory after a month of auto-mode-by-default is itself the removal signal: the classifier is not costing anything, and the hook is measuring nothing.

## Testing

```sh
bun test ./user/hooks/permission-denied
```
