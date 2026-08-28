# Effort Cells

The cells live in [efforts.yaml](efforts.yaml), and [scripts/review-plan.ts](scripts/review-plan.ts) resolves and prints the one a review runs. No review reads this file. It holds the reasoning behind the cell assignments, for whoever changes them next.

## Inline Families

A capable orchestrator reviews better working through the angles itself than it does splitting them across agents, so both Opus 4.8 and Fable 5 stay inline through the middle of the ladder. The `inline-*` cells run every angle in the orchestrator's own context. No fan-out, no verify pass.

The families part at `xhigh`. Opus 4.8 keeps upstream's inline calibration there, unchanged. Fable 5 fans out instead, at Sonnet rates, which buys breadth without paying Fable rates per angle.

## Spawn Model

Every fan-out spawn passes `model: sonnet` alongside its `subagent_type`. What a fan-out cell buys is breadth, and breadth comes from many independent readers of the same diff. Paying the orchestrator's own rate for each of those readers buys nothing extra. Most diffs fail on lines. Lines are what Sonnet reads well and cheaply.

## Finder Budget

Sonnet 5 at `high` and `xhigh` scales the fleet to the diff size instead of running a fixed one agent per angle. Upstream sets that hint on Sonnet 5 alone. No other family carries the `finder-budget` modifier.

## Degraded Fan-Out

A missing `Agent` tool degrades every fan-out cell to a single inline pass. That branches on the tool set rather than on the cell. [SKILL.md](SKILL.md) owns it, and no cell encodes it.

## Upstream

The `inline-*` cells are upstream's `o48-*` cells under a family-neutral name, since two families now select them. [references/upstream-2.1.215.md](references/upstream-2.1.215.md) maps each one back to its upstream identifier and holds the extracted prompt text the cells were calibrated against. `bun scripts/check-review-drift.ts` compares that snapshot to the installed binary.
