---
name: linear:plan
description: >-
  Plan projects locally with Markdown files, visualize plans interactively,
  and sync to Linear. Use when planning projects, decomposing work into issues,
  managing milestones, or creating Linear issues from a plan.
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_ROOT}/scripts/scaffold.ts:*)
  - Bash(bun ${CLAUDE_SKILL_ROOT}/scripts/serve.ts:*)
  - Bash(bun ${CLAUDE_SKILL_ROOT}/scripts/sync.ts:*)
  - Read
  - Write
  - Glob
  - mcp__linear
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_SKILL_ROOT}/scripts/serve.ts:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
---

# Plan

Plan projects as local Markdown files with YAML frontmatter, then visualize and sync to Linear.

## File Format

See `format.md` for the complete plan file format reference.

## Workflow

### 1. Scaffold

Create a new plan directory:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/scaffold.ts <name>
```

Creates `linear-plan-<name>/` in `/tmp/claude` with the spec doc, settings, and directory structure.

### 2. Write Issues

Create issue files in `issues/` with YAML frontmatter:

```yaml
---
title: Implement auth flow
priority: 1
label: feature
milestone: milestones/v1.md
blocked_by:
  - design-auth.md
---

Implement OAuth2 authentication flow with refresh tokens.
```

Create milestone files in `issues/milestones/`:

```yaml
---
title: V1 Release
description: Initial release
issues:
  - implement-auth.md
  - add-api.md
---
```

### 3. Visualize

Serve an interactive visualization:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/serve.ts <plan-dir>
```

Opens a browser with three views:
- **Graph** — DAG of issue dependencies
- **Table** — sortable/filterable issue list
- **Kanban** — milestone columns with drag-and-drop

Edit issues directly in the browser. Changes write back to disk and live-reload.

### 4. Sync to Linear

Push the plan to Linear:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/sync.ts <plan-dir> --team ENG --create-project
```

Creates a Linear project, milestones, and issues with dependency relations. Use `--dry-run` to preview. Re-runs are idempotent via `.sync-state.json`.
