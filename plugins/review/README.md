# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- **`code`**: Review the working diff for correctness bugs and reuse/simplification/efficiency cleanups at a chosen effort level. A model-invocable port of Claude Code's built-in `/code-review`, which is user-invocable only.
- **`peer`**: Review PRs when requested by a peer (GitHub or GitLab). Maps proposed comments to platform positions with an in-diff pre-check, then posts them as a batch.
- **`follow-up`**: Follow up on a PR/MR you reviewed: check if your comments were addressed, find silent resolves, decide whether to re-approve
- **`inbox`**: Dispatch inbound PR/MR reviews as background sessions that collect in `claude agents` (GitHub and GitLab)

### Agents

- **`angle`**: Runs one finder angle over a diff and returns candidates. The unit of `code`'s find fan-out and its sweep pass.
- **`verifier`**: Judges candidates against the code as CONFIRMED, PLAUSIBLE, or REFUTED. The unit of `code`'s verify phase.

Neither pins a model. `code` spawns both on Sonnet.

## Testing

```sh
bun test plugins/review
```
