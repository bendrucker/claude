# Review Plugin

Code review workflows for Claude Code.

## Contents

### Skills

- **`peer`**: Review PRs when requested by a peer (GitHub or GitLab)
- **`self`**: Self-review your own changes using Hunk's terminal diff viewer (defers to the upstream `hunk-review` skill for CLI mechanics)
- **`follow-up`**: Follow up on a PR/MR you reviewed: check if your comments were addressed, find silent resolves, decide whether to re-approve
- **`dashboard`**: Live tmux dashboard for reviewing inbound PRs across GitHub and GitLab
