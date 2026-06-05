---
name: type-ignore:fix
disable-model-invocation: true
description: Fix type errors instead of ignoring them. Use when cleaning up type ignores across files or batch-fixing type errors.
context: fork
agent: general-purpose
allowed-tools:
  - Read
  - Grep
  - Glob
  - Task
---

# Type Ignore Fixer

Fix type errors instead of ignoring them.

## Scope

$ARGUMENTS

If no scope provided, scan the entire codebase.

## Type Ignores Found

!`rg '@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore|type:\s*ignore|noqa|pylint:\s*disable|//nolint|//lint:ignore|#\[allow\(' -g '*.{ts,tsx,js,jsx,py,go,rs,rb}' -l 2>/dev/null || echo "none found"`

## Process

1. For each file above, spawn a `type-ignore:fixer` agent with prompt: "Fix type ignores in <file_path>"
2. Run type checking to verify fixes
3. Report summary: files fixed, ignores resolved, issues remaining

Spawn agents in parallel using multiple Task tool calls in a single message.
