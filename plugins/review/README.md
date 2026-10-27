# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- The `peer` skill reviews PRs when requested by a peer (GitHub or GitLab). It maps proposed comments to platform positions with an in-diff pre-check, then posts them as a batch.
- The `follow-up` skill follows up on a PR/MR you reviewed: it checks if your comments were addressed, finds silent resolves, and decides whether to re-approve.
- The `meat-proxy` skill drafts a short reply that hands an AI-relayed PR, MR, or doc back to its author with motivation and scope questions, holding line-level findings in private notes. It drafts only and never posts.
- The `inbox` skill dispatches inbound PR/MR reviews as background sessions that collect in `claude agents` (GitHub and GitLab).
- The `human` skill requests Ben's own review of the working diff or a document, in the terminal (reviewr, plannotator-tui) or the browser (plannotator). It raises a herdr pane label and toast that the plugin's `UserPromptSubmit` hook clears when he replies.

### Hooks

- The `UserPromptSubmit` hook clears the `review` pane label `human` raised, once the reply lands.

### Agents

- The `review` agent reviews a pushed PR with fresh eyes in an isolated worktree, never editing it. It runs `peer` on a peer's PR and a cold audit on Ben's own. It is the agent `inbox` dispatches.

## Testing

```sh
bun test plugins/review
```
