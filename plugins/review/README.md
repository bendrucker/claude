# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- **`code`**: Review the working diff for correctness bugs and reuse/simplification/efficiency cleanups at a chosen effort level. A model-invocable port of Claude Code's built-in `/code-review`, which is user-invocable only.
- **`peer`**: Review PRs when requested by a peer (GitHub or GitLab). Maps proposed comments to platform positions with an in-diff pre-check, then posts them as a batch.
- **`follow-up`**: Follow up on a PR/MR you reviewed: check if your comments were addressed, find silent resolves, decide whether to re-approve
- **`meat-proxy`**: Draft a short reply that hands an AI-relayed PR, MR, or doc back to its author with motivation and scope questions, holding line-level findings in private notes. Drafts only, never posts
- **`inbox`**: Dispatch inbound PR/MR reviews as background sessions that collect in `claude agents` (GitHub and GitLab)
- **`human`**: Request Ben's own review of the working diff or a document, in the terminal (reviewr, plannotator-tui) or the browser (plannotator). Raises a herdr pane label and toast that the plugin's `UserPromptSubmit` hook clears when he replies

### Hooks

- **`UserPromptSubmit`**: Clears the `review` pane label `human` raised, once the reply lands

### Agents

- **`review`**: Reviews a pushed PR with fresh eyes in an isolated worktree, never editing it. Runs `peer` on a peer's PR and a cold audit on Ben's own. The agent `inbox` dispatches.
- **`angle`**: Runs one finder angle over a diff and returns candidates. The unit of `code`'s find fan-out and its sweep pass.
- **`verifier`**: Judges candidates against the code as CONFIRMED, PLAUSIBLE, or REFUTED. The unit of `code`'s verify phase.

`angle` and `verifier` pin no model, and `code` spawns both on Sonnet. `review` inherits the caller's model.

## Testing

```sh
bun test plugins/review
```
