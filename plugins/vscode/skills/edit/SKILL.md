---
name: vscode:edit
description: Open content in VS Code for interactive editing before using it in the next step.
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/edit.ts:*)"
  - "Read"
  - "Write"
---

# Edit

Open content in VS Code for the user to review and edit before proceeding.

## Workflow

### New content (stdin mode)

Draft the content for the user's request, then pipe it to the edit script:

```bash
printf '%s' '<content>' | bun ${CLAUDE_SKILL_DIR}/scripts/edit.ts --ext <ext>
```

The script opens VS Code with `--wait`, blocks until the tab is closed, then prints the edited content to stdout. Use the returned content for the next step (MCP call, file write, commit message, etc.).

### Existing files

Pass the file path directly:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/edit.ts <file>
```

VS Code opens the file with `--wait`. The user edits and closes the tab. No stdout — the file is modified in place.

## Content Formatting

For multi-field content (issues, PRs, specs), use YAML front matter for structured fields and the body for prose. Parse the front matter from stdout to extract fields for API requests.

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--ext <ext>` | `md` | File extension for temp files (determines VS Code syntax highlighting) |
| `--no-wait` | off | Open without blocking (fire-and-forget) |
