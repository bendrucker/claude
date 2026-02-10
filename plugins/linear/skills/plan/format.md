# Plan File Format

A plan is a directory containing a project spec, issue files, and milestone files.

## Directory Structure

```
linear-plan-<name>/
├── <name>.md                    # Project spec
├── .claude/settings.local.json  # Session permissions
├── .sync-state.json             # Linear sync state (generated)
└── issues/
    ├── <issue>.md               # Issue files
    └── milestones/
        └── <milestone>.md       # Milestone files
```

## Issue Frontmatter

```yaml
---
title: Issue title (required)
label: bug
priority: 1-4 (1=urgent, 4=low)
milestone: milestones/v1.md
estimate: 3
assignee: username
blocks:
  - other-issue.md
blocked_by:
  - dependency.md
---

Issue description in Markdown.
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Issue title |
| `label` | string | no | Issue label |
| `priority` | number | no | 1 (urgent) to 4 (low) |
| `milestone` | string | no | Relative path to milestone file |
| `estimate` | number | no | Story points |
| `assignee` | string | no | Assignee username |
| `blocks` | string[] | no | Issues this blocks (filenames) |
| `blocked_by` | string[] | no | Issues blocking this (filenames) |

## Milestone Frontmatter

```yaml
---
title: Milestone title (required)
description: Short description
issues:
  - auth.md
  - api.md
---

Milestone details in Markdown.
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Milestone title |
| `description` | string | no | Short description |
| `issues` | string[] | no | Issue filenames in this milestone |

## Conventions

- Issue filenames should be kebab-case: `fix-auth-flow.md`
- Milestone filenames match milestone names: `v1.md`, `beta-release.md`
- Dependency references (`blocks`, `blocked_by`) use issue filenames only (not paths)
- Milestone references from issues use relative paths: `milestones/v1.md`
- Milestone `issues` arrays use filenames only: `auth.md` (not `../auth.md`)
- Keep bidirectional consistency: if milestone lists an issue, the issue should reference that milestone
