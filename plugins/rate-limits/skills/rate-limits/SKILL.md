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

`install` compiles the alert hook to `bin/alert` (the hook falls back to `bun` until it exists) and checks whether the statusline recorder is wired. If it reports the recorder is not wired, follow its printed guidance to wrap your statusline command in `~/.claude/settings.json`. Without the recorder, no history accumulates and the prediction never fires. See the plugin README for the wiring example.

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
