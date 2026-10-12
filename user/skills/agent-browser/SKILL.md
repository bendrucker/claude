---
name: agent-browser
description: Real-browser automation via the `agent-browser` CLI. Use when a task needs an actual browser — navigating pages, filling forms, clicking, taking screenshots, scraping or extracting page data — or for exploratory testing, QA, and dogfooding of web apps. Pulls version-matched workflow instructions from the CLI itself.
allowed-tools:
  - Bash(agent-browser:*)
  - Bash(npx agent-browser:*)
hidden: true
---

# agent-browser

Native browser-automation CLI (Chrome via CDP, accessibility-tree snapshots, compact `@eN` element refs).

This stub holds no usage details on purpose — load the version-matched workflow from the CLI before running any `agent-browser` command:

```bash
agent-browser skills get core          # start here: workflows, patterns, troubleshooting
agent-browser skills get core --full   # full command reference + templates
agent-browser skills get dogfood       # exploratory testing / QA / bug hunts
agent-browser skills list              # everything on the installed version
```

## Sessions

Each `--session` runs its own Chrome until it is closed or its idle timeout passes.

- Use one session per agent, named for the agent rather than the item, and reuse it across items by navigating it.
- Run `agent-browser --session <name> close` once your last item is done.
- A brief for browser-driving subagents names one session per subagent, and at most two such subagents run at a time.

Slack automation exists via `agent-browser skills get slack`, but prefer the Slack MCP tools for reads/sends/searches.
