---
name: agent-ideas
description: Harvest agent-tooling ideas from prominent developers.
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/fetch.ts:*)
  - Read
  - Grep
  - Glob
---

# Agent Ideas

Harvest agent-tooling ideas from a curated list of thinkers and map them to concrete artifacts in this repo (a skill, hook, setting, or rule). The harvest runs in two phases: a headless weekly pass that fetches feeds and delivers a digest, and a local pass after teleport that fills the gaps and files the keepers.

This is the foundation: the curated source list and the deterministic fetch.

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
