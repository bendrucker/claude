---
name: overlay
description: Link a third-party checkout's .claude to its overlay, or report the current link state. Use when a session warns that an overlay exists but is not linked, or when setting up a fresh clone or worktree.
user-invocable: true
disable-model-invocation: true
argument-hint: link|status [checkout]
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/link.ts:*)"
---

# Overlay

Run the linker with the arguments given. The checkout defaults to the working directory.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/link.ts $ARGUMENTS
```

Relay what it reports. `link` prints only when it changes something, so silence means the checkout was already linked or has no overlay. A blocked `link` names what `.claude` holds, which has to move or go before the link can replace it.

The configuration itself lives at `$CLAUDE_OVERLAYS_ROOT/<owner>/<repo>/.claude/`, defaulting to `~/.claude-repo/overlays/`. That path is a deployed clone of the claude repo, which `claude-upgrade` fast-forwards nightly. Edit `overlays/` in a branch of `~/src/bendrucker/claude` and let the sync carry it.
