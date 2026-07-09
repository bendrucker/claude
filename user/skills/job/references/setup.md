# Setup

First-run interview. Produces `~/.config/claude-job-skill/config.json`. The skill is open source, so everything employer-specific lives only in this file.

## Detect Before Asking

Build candidate answers from the environment rather than a hardcoded tool list:

- Scan the installed-skills list already in context for version-control, issue-tracker, code-review, worktree, messaging, email, and personal task-manager coverage. Messaging, email, and a personal task-manager often arrive as MCP servers rather than skills or CLIs, so check the connected MCP servers too.
- Probe for CLIs read-only: `command -v`, then the CLI's authenticated-user query (its `whoami` or `me` equivalent) to learn the username, which doubles as verification for the interview's version-control answer.
- Check `git config --get remote.origin.url` in likely repos for a host hint.

Offer only what is present.

## Interview

Ask via AskUserQuestion with detected candidates as options, relying on the built-in Other choice to cover anything detection missed.

- Version control: platform, host, work username (verify against the CLI's authenticated-user query), preferred CLI.
- Issue tracker: platform, username and team, and how "current cycle" is expressed there, whether that is a cycle, sprint, iteration, or milestone, recording the exact term and how to query it.
- Worktrees: the tool used, if any, plus every root directory the end-of-day sweep should walk when it checks for uncommitted changes and unpushed commits.
- Messaging: the platform, how it is reached (an installed skill, an MCP server, or a CLI), and the work handle. Used to sweep inbound direct messages and mentions. Optional.
- Email: the account, how it is reached (an installed skill, an MCP server, or a CLI), and the work address. Used to sweep unhandled mail. Optional.
- Personal inbox: a personal capture destination distinct from the work tracker, how it is reached (an installed skill, an MCP server, or a CLI), for your own next-steps and reminders. Kept separate so "track this to my inbox" never lands a team-backlog issue. Optional.
- Working hours: optional, default 09:00 to 17:00, used only to suggest a mode when `/job` runs with no argument.
- Notes: optional free-form text for reviewer conventions and team norms, where employer specifics belong rather than anywhere in the skill.

## Persist

Run `mkdir -p ~/.config/claude-job-skill`, then write `config.json`:

```json
{
  "version": 1,
  "vcs": { "platform": "...", "host": "...", "username": "...", "cli": "..." },
  "tracker": { "platform": "...", "username": "...", "team": "..." },
  "chat": { "platform": "...", "access": "...", "username": "..." },
  "email": { "platform": "...", "access": "...", "address": "..." },
  "inbox": { "platform": "...", "access": "..." },
  "worktrees": { "tool": "...", "roots": ["~/src/..."] },
  "hours": { "start": "09:00", "end": "17:00" },
  "notes": "free-form conventions"
}
```

Only `vcs` and `tracker` are required. Persist stable identities alone, since volatile state like open PRs, review queues, and CI results is discovered fresh on every run.

Echo the written config back for confirmation, then continue into the originally requested mode if there was one.

## Re-Run

`/job setup` re-runs the interview. The current config is already injected at the top of `SKILL.md`, so offer each current value as the default answer.
