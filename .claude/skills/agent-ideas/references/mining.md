# Mining Posts Into Repo-Mappable Ideas

The goal is not "summarize what these people wrote." It is: **which posts suggest a concrete artifact in _this_ repo** (a skill, hook, user setting, rule, or workflow), and what is the smallest version of that artifact.

## Idea card schema

Each surviving idea is a card with these fields:

```
title         short imperative phrase, becomes "[agent-idea] <title>"
pitch         1-2 sentences: what the artifact is and why this post motivates it
artifactType  skill | hook | setting | rule | workflow
sourceName    the source's display name
sourceUrl     the post URL
actionability low | medium | high
repoOverlap   existing surface it refines (path or name), or null if net-new
```

The local triage phase consumes these directly: `title` becomes the Things todo
title, and the rest becomes the notes body.

## Heuristics (proven in the proof run)

- **Repo-aware is the bar.** A good card names a real surface in this repo it
  would refine, or makes a clear case for a net-new artifact. Vague "you could
  build a tool for X" with no repo hook is noise. Drop it. "Real" is literal:
  a non-null `repoOverlap` must point at a path that exists, and the pitch must
  not misstate what that surface already does. A card whose overlap is wrong is
  as dead as one with a 404 source.
- **Per-source cap by depth.** A long-form essay can yield 2-3 cards; a thin
  link-blog entry or quote yields at most 1. Don't pad thin sources to hit a
  quota.
- **Expect a low/medium skew.** This is a mature repo. Refinements to existing
  skills dominate. Net-new high-actionability artifacts are rare and notable.
  Flag the rare one when it appears. Don't manufacture them.
- **Auto-demote dead sources.** Before a card ships, confirm its `sourceUrl`
  resolves. If it 404s, drop the card (the idea cannot be traced or verified).
- **Dedupe against the repo.** Before a candidate becomes a card, check it
  against existing surfaces (skills, hooks, settings, rules). If the repo
  already has it, either set `repoOverlap` to that surface and reframe the card
  as a refinement, or drop it if there is nothing to add.

## Suggested flow

1. Group the fetched posts by source. Skip sources with no posts.
2. Fan out: one mining agent per source (or per small batch of thin sources).
   Give each agent the posts plus this schema and the heuristics above, and a
   read-only view of the repo so it can fill `repoOverlap` and dedupe. Feed
   excerpts are often a single thin line; tell the agent to `WebFetch` the full
   post when a title or excerpt looks promising, before judging it. That fetch
   doubles as the 404 check in step 3.
3. Collect cards. Verify each `sourceUrl` resolves (demote 404s) and each
   non-null `repoOverlap` points at a path that exists (drop the card, or
   reframe it as net-new, when the overlap doesn't resolve). Same bar both
   ways: a claim you can't verify doesn't ship.
4. Dedupe across agents (two sources can surface the same idea) and against the
   repo. Keep the strongest framing of each.

## Dedupe targets in this repo

When checking `repoOverlap`, the surfaces that already exist:

- Skills: `plugins/*/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, and `user/skills/*`
- Hooks: `plugins/*/hooks/`, plus hooks in `.claude/settings.json` and `user/settings.json`
- Settings/permissions/sandbox: `.claude/settings.json` (project) and `user/settings.json` (user)
- Rules: `.claude/rules/*.md` (project, path-scoped) and `user/rules/*.md` (user, all repos)

Both `.claude/*` (project) and `user/*` (user-level, symlinked to `~/.claude`) are live;
a card can land in either. Don't check only one tree.
