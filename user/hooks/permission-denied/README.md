# `permission-denied`

`PermissionDenied` hook that records every auto mode denial to a JSONL log. What auto mode costs then becomes measurable rather than anecdotal.

## Why

A denial leaves no trace anywhere durable. It never reaches the transcript, which puts it beyond the [session index](../../../plugins/claude-code/skills/session), and the `/permissions` **Recently denied** tab is per-session and in-memory. Only user *rejections* of a permission prompt are recorded, and those are a different event. With `permissions.defaultMode` set to `auto`, the classifier is the gate on nearly every session, and without this hook there is no way to answer whether a given `autoMode` rule is earning its place or misfiring.

The event is scoped to the auto mode classifier. A `PreToolUse` hook block and a `deny` rule match are different events and neither reaches this hook. A `soft_deny` rule that prompted and that you then rejected may reach it, so read a repeated entry as "the classifier stopped this", not as "the classifier was wrong".

## Behavior

Reads the `PermissionDenied` payload on stdin and appends one JSON object per denial:

| Field | Source |
| --- | --- |
| `ts` | ISO 8601, written when the hook runs |
| `session_id`, `cwd`, `reason` | passed through from the payload |
| `tool` | the payload's `tool_name` |
| `target` | the first populated field of `command`, `file_path`, `url`, `path`, `notebook_path`, `prompt`; otherwise the whole `tool_input` as JSON |

`CLAUDE_AUTO_MODE_DENIAL_LOG` resolves the destination in one place, the same contract the writing plugin's [`run-log.ts`](../../../plugins/writing/hooks/run-log.ts) uses: unset defaults to on, `0`/`false`/`off` disables logging, and any other value is a path override. The default is `~/.claude/auto-mode-denials.jsonl`, rotated to `.1` past 5 MB.

Appending needs `O_APPEND` atomicity, since concurrent sessions write to one file and a read-modify-write would drop records. That takes `appendFileSync`, which this repo's oxlint config restricts. The import therefore carries a scoped `oxlint-disable-next-line` comment naming that rationale, following the pattern `run-log.ts` established.

The hook never returns `hookSpecificOutput.retry`. Retrying is a judgment about whether a denial was wrong, which belongs to the person reading the log. A failure is caught so it cannot break the session, but it prints to stderr rather than passing silently: an empty log is the signal that retires this hook, and a silent failure would forge that signal.

## Reading It

```sh
jq -r '[.ts, .tool, .target] | @tsv' ~/.claude/auto-mode-denials.jsonl | tail -20
```

Group by what was blocked, to see whether one destination or verb dominates:

```sh
jq -r '.target | split(" ")[0:2] | join(" ")' ~/.claude/auto-mode-denials.jsonl | sort | uniq -c | sort -rn
```

A destination that recurs belongs in `autoMode.environment`. A command shape that recurs, and that you would have approved every time, belongs in `autoMode.allow`. Both live in [`user/settings.json`](../../settings.json). The classifier does not read project settings.

## Removal

This hook exists to produce evidence. It is done when the evidence stops changing decisions. Drop it when a month of log has produced no `autoMode` change and no denial worth acting on, or when Claude Code starts recording denials somewhere the session index can reach. Check the recent window rather than the total, which only grows:

```sh
jq -r --arg since "$(date -v-30d +%Y-%m-%d)" 'select(.ts > $since) | .ts' \
  ~/.claude/auto-mode-denials.jsonl | wc -l
```

A near-zero count over a month of auto-mode-by-default is itself the removal signal: the classifier is not costing anything, and the hook is measuring nothing. Confirm the hook still runs before reading a zero that way, since a broken hook produces the same count.

## Testing

```sh
bun test ./user/hooks/permission-denied
```
