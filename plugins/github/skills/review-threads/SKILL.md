---
name: github:review-threads
description: Reply to and resolve GitHub pull request review threads. Use when responding to review comments, marking threads resolved after addressing feedback, or clearing AI-reviewer threads.
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts:*)"
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

# Review Threads

Reply to and resolve review threads on a GitHub pull request via the `addPullRequestReviewThreadReply` and `resolveReviewThread` GraphQL mutations. Fetch thread IDs with the `github:pr-comments` skill (each thread prints its `id`).

## Usage

```bash
# Reply to a thread
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --body "..."

# Reply and resolve in one call
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts reply <thread-id> --resolve --body "..."

# Resolve without replying (avoid: prefer reply --resolve so the resolve carries context)
bun ${CLAUDE_PLUGIN_ROOT}/scripts/review-threads.ts resolve <thread-id>
```

## Arguments

- `<thread-id>`: review thread node ID (e.g. `PRRT_…`), from `github:pr-comments` output
- `reply` flags:
  - `--body`: reply text (or `--bodyFile <path>`, or pipe via stdin)
  - `--resolve`: resolve the thread after the reply posts

## Notes

Don't resolve without a reply: a silent resolve hides why the thread was closed. The combined `reply --resolve` is the default for clearing a thread.
