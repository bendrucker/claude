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
  - mcp__claude-in-chrome__tabs_context_mcp
  - mcp__claude-in-chrome__tabs_create_mcp
  - mcp__claude-in-chrome__navigate
  - mcp__claude-in-chrome__get_page_text
---

# Agent Ideas

Harvest agent-tooling ideas from a curated list of thinkers and map them to concrete artifacts in this repo (a skill, hook, setting, or rule). The harvest runs in two phases: a feed pass that fetches, mines, and delivers a digest, and a local pass that fills the X-only gap and files the keepers. As the weekly routine these run headless-then-local, bridged by a teleport doorway item. Run on-demand at your own terminal, they collapse into one pass with no doorway (see [Deliver the Doorway Item](#deliver-the-doorway-item)).

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

Keep the digest in this session's context as well. The local phase reads it from here.

## Deliver the Doorway Item

Skip this section on a local on-demand run. The doorway exists only to bridge the headless weekly routine to a local terminal; `claude --teleport ${CLAUDE_SESSION_ID}` minted from a session you are already in points at itself. When the browser and Things are reachable (you invoked the skill yourself), go straight from Synthesize to [Fill the X-Only Gap](#fill-the-x-only-gap). The doorway is the remote routine's handoff, nothing more.

For the weekly routine, create exactly one Things inbox item. It is the routine's only notification, so make its notes self-sufficient:

- **Title**: `[agent-ideas] Weekly digest: N ideas (YYYY-Www)`
- **Notes**: the top-line summary, then the teleport command on its own line so it's tappable:

  ```
  claude --teleport ${CLAUDE_SESSION_ID}
  ```

Pick the delivery path by environment:

- **Local** (Things reachable on this Mac): use the `things:inbox` skill. Leave it untagged, since the local phase adds `claude-code` per keeper later.
- **Remote** (headless routine, no local MCPs): use the Zapier connector tool `mcp__claude_ai_Zapier__things_create_to-do`. It reaches Things through Anthropic's proxy. Tags aren't available remotely, which is fine: the doorway item is intentionally untagged.

Do not tag the doorway item `claude-code`. Tagging happens per keeper in the local phase, so the whole digest doesn't land in the `improve-claude-code` backlog as one blob.

## Local Phase

The local phase fills the X-only gap and files the keepers. You reach it two ways. The weekly routine gets here when you tap the doorway item: `claude --teleport` pulls the cloud session into a local terminal where the browser and Things are reachable. A local on-demand run flows straight here from Synthesize, with no doorway in between.

The digest is already in this session's context. After a teleport into a fresh terminal it may not be, so read the latest `tmp/agent-ideas-digest-*.md` to recover the feed-derived cards.

## Fill the X-Only Gap

`x-only` sources were skipped in the remote fetch. Read their recent timelines in the browser and mine them into cards with the same bar as the feed path. See [references/browser.md](references/browser.md) for the tool-loading sequence, the per-author flow, and the failure modes (extension not connected, logged-out wall). If the browser is unavailable, note which authors went unread and proceed with the feed cards.

## Capture Keepers

For each keeper card, create one Things todo via the `things:inbox` skill, tagged `claude-code` so `improve-claude-code` picks it up:

- **Title**: `[agent-idea] <card title>`
- **Notes**: the pitch, then the source URL, then the suggested `artifactType`. This is the shape `improve-claude-code` consumes (short title, full notes).
- Pass `--tag claude-code` and `--session-id ${CLAUDE_SESSION_ID}` so the capture carries the right tag and session attribution.

Capture one todo per keeper, not one blob. Each becomes an independently triageable backlog item. Don't re-capture the feed cards as new ideas; the digest already framed them. The local phase adds the X-only cards and tags everything.

## Hand Off

Once the keepers are captured, the work belongs to `improve-claude-code`: it triages the `claude-code` backlog into batched PRs. Tell the user how many todos landed and that they can run `improve-claude-code` to process them.

## Gotchas

- **No completion notification exists for routines.** The doorway item _is_ the signal. If its creation fails, say so loudly in the run output rather than ending silently.
- **Teleport, not resume.** The handoff is `claude --teleport <session>`, which pulls the cloud session into a local terminal with local tools. `--resume` does not do this. If the browser or Things isn't reachable after teleport, you may not actually be in a local session. Confirm before assuming the fallback is broken.
- **Thin weeks are normal.** Low-frequency blogs often post nothing in an 8-day window. A digest of 0-2 ideas is a valid outcome, not a failure. On the weekly routine, still drop the doorway item so the cadence is visible.
- **One tag, one backlog.** The `claude-code` tag is the contract with `improve-claude-code`. Without it, the todo won't surface there.
