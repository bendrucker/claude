# Agents

User-scope [subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents). `install.sh` symlinks this directory to `~/.claude/agents/`, so every `*.md` here is available to any project as a named agent.

These are reusable, named background agents, one per file, named by basename. Dispatch one with `claude --bg --agent <name> "<task>"`, or pick it from the agent step in the `claude-launch` launcher (in the dotfiles repo).

`scout.md` is a concrete starting point. It investigates read-only and reports findings without touching the tree. Copy it to add your own, keeping `tools` scoped to what the agent needs and `model` matched to the work.

The global default subagent (the `agent` key in `settings.json`) is intentionally left unset. Setting it would run every main session as that subagent.
