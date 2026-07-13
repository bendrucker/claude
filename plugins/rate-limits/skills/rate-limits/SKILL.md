---
name: rate-limits
description: >-
  Predict and manage Claude Code usage-limit exhaustion from the burn rate. Use
  to install/prepare the recorder and compiled hook, diagnose the reporting
  pipeline (doctor), report current usage and the projected 5-hour exhaustion
  (status), or run a pre-flight usage check before starting large work.
allowed-tools:
  - Bash
  - Read
---

# Rate Limits

The plugin fits recent usage samples for the current 5-hour block, projects when usage reaches 100%, and warns when that lands before the block resets. The hook fires automatically each prompt. This skill drives the surfaces around it.

`bun ${CLAUDE_PLUGIN_ROOT}/scripts/rate-limits.ts` is the entry point for every action below.

## Install / Prepare

Run once per plugin root (a plugin upgrade lands in a fresh root, so rerun after upgrading):

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/rate-limits.ts install
```

`install` compiles the alert hook to `bin/alert` (the hook falls back to `bun` until it exists) and checks whether the statusline recorder is wired. Without the recorder, no history accumulates and the prediction never fires.

### Wire the Recorder

The prediction needs usage history, which the single-snapshot `rl.json` cannot hold. The recorder wraps your existing statusline so every render records a sample. Set `statusLine.command` in `~/.claude/settings.json` to wrap the inner command after a `--` separator:

```json
{
  "statusLine": {
    "command": "bun /path/to/plugins/rate-limits/scripts/recorder.ts -- <your existing statusline command>"
  }
}
```

The recorder reads the statusline payload once, writes `rl.json` (single writer), appends to history, then execs the inner command with the same stdin. Recording is best-effort, so a failure never blocks rendering.

History is edge-triggered NDJSON at `~/.claude/rate-limits/history.ndjson` (override with `CLAUDE_RATE_LIMITS_HISTORY_PATH`): a line is appended only when `used_percentage` changes, and lines older than 7 days are pruned on each write. Concurrent-session duplicates collapse on read.

The compiled binary at `bin/alert` is gitignored and ephemeral. A plugin upgrade lands in a fresh root with no binary, so rerun `install` after upgrading. The dispatcher falls back to `bun` until the binary exists.

## Doctor

Diagnose why the prediction is silent:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/rate-limits.ts doctor
```

Checks `rl.json` (path, exists, parses, numeric percentage, freshness), history (exists, fresh, enough in-block samples), the compiled hook, and the statusline recorder. Each failing check prints remediation. A stale or missing `rl.json`/history means the recorder is not reporting.

## Status

Report current usage and the projection on demand:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/rate-limits.ts status
```

Prints each window's percentage and reset, plus the 5-hour burn rate and projected exhaustion relative to reset. Running status also stamps the session marker, so it suppresses a redundant hook alert about a breach it just showed.

## Pre-flight

Before starting a large or long-running task, run `status` and read the projection. If the 5-hour limit is projected to exhaust before the work would finish (or before reset with little margin), pause and tell the user: name the projected exhaustion time and how far before reset it lands, and ask whether to proceed, pace the work, or wait for the reset. Do not silently start work that the current burn rate cannot finish.

## Tuning

Sensitivity defaults live in `scripts/predict.ts` and are overridable via env:

- `CLAUDE_RATE_LIMITS_MARGIN_MS`: how far before reset a projected exhaustion must land to alert (also the re-alert threshold).
- `CLAUDE_RATE_LIMITS_MIN_SAMPLES`: minimum in-block samples before fitting.
- `CLAUDE_RATE_LIMITS_MIN_SPREAD_MS`: minimum time spread across samples before fitting.
