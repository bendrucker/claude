---
name: agent-ideas
description: Harvest agent-tooling ideas from prominent developers.
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/fetch.ts:*)
  - Read
  - Grep
  - Glob
  - WebFetch
  - Task
  - Write
  - Skill(things:inbox)
  - mcp__claude_ai_Zapier__things_create_to-do
---

# Agent Ideas

Harvest agent-tooling ideas from a curated list of thinkers and map them to concrete artifacts in this repo (a skill, hook, setting, or rule). The harvest runs in two phases: a headless weekly pass that fetches feeds, mines them, and delivers a digest, and a local pass after teleport that fills the gaps and files the keepers.

## Sources

`sources.ts` is the prunable core: a version-controlled list of thinkers, each with a feed URL, or marked `x-only` when no usable feed exists. Edit it directly to add, drop, or retune sources. Keep it small and high-signal; a source earns its place by regularly producing ideas that map to artifacts in this repo.

## Fetch

Pull the last 8 days of posts across all feed sources:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/fetch.ts > tmp/agent-ideas-posts.json
```

Each result is `{source, sourceType, feedUrl, posts:[{title,url,date,excerpt}], error?}`. Sources with `error` set could not be fetched; note them but don't block. `x-only` sources are absent here by design (the local phase handles them after teleport).

Narrow to specific sources or widen the window with flags:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/fetch.ts --days 14 --source simon --source mario
```

## Mine

Turn posts into repo-mappable idea cards. The bar is high: a card must name a real surface in this repo it would refine, or make a clear case for a net-new artifact. See [references/mining.md](references/mining.md) for the card schema, the proven heuristics (per-source cap by depth, auto-demote 404 sources, dedupe against existing repo surfaces), and the fan-out flow.

Fan out one mining `Task` agent per source (batch thin sources together). Give each the source's posts, the schema, the heuristics, and a read-only view of the repo so it can fill `repoOverlap` and dedupe. Collect the cards, verify each `sourceUrl` resolves (demote 404s), then dedupe across agents.

## Synthesize

Write the digest to `tmp/agent-ideas-digest-<YYYY-Www>.md`:

- A top-line summary: idea count, the standout cards, the low/medium/high split.
- Per-idea cards in full (the schema fields), grouped high → low actionability.
- A short "repo overlaps" note listing cards that refine existing surfaces.

Keep the digest in this session's context as well. After teleport, the local phase reads it from here.

## Deliver the Doorway Item

Create exactly one Things inbox item. It is the routine's only notification, so make its notes self-sufficient:

- **Title**: `[agent-ideas] Weekly digest: N ideas (YYYY-Www)`
- **Notes**: the top-line summary, then the teleport command on its own line so it's tappable:

  ```
  claude --teleport ${CLAUDE_SESSION_ID}
  ```

Pick the delivery path by environment:

- **Local** (Things reachable on this Mac): use the `things:inbox` skill. Leave it untagged, since the local phase adds `claude-code` per keeper later.
- **Remote** (headless routine, no local MCPs): use the Zapier connector tool `mcp__claude_ai_Zapier__things_create_to-do`. It reaches Things through Anthropic's proxy. Tags aren't available remotely, which is fine: the doorway item is intentionally untagged.

Do not tag the doorway item `claude-code`. Tagging happens per keeper in the local phase, so the whole digest doesn't land in the `improve-claude-code` backlog as one blob.

## Gotchas

- **No completion notification exists for routines.** The doorway item _is_ the signal. If its creation fails, say so loudly in the run output rather than ending silently.
- **Teleport, not resume.** The handoff is `claude --teleport <session>`, which pulls the cloud session into a local terminal with local tools. `--resume` does not do this.
- **Thin weeks are normal.** Low-frequency blogs often post nothing in an 8-day window. A digest of 0-2 ideas is a valid outcome, not a failure. Still drop the doorway item so the cadence is visible.
