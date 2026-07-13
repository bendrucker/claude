# `writing:writing` Rubric

A local harness for evaluating the writing style rules. The aim is a rubric: a
concrete list of what makes a rewrite good or bad, derived from labeling real
outputs, then used to score the rules before and after edits.

The eval unit is the [`writing:rewrite`](../../plugins/writing/skills/rewrite)
transform. `writing:writing` only injects the style rules into context and emits
no artifact. It has nothing observable to label. `rewrite` applies the same
rules to a draft and produces a cleaned version. Its `(input, output)` pair is
the proxy for whether the rules do their job.

This scaffold delivers the mining script and the labeling UI. The rubric,
scorer, and judge come after a labeling session, since the rubric is derived
from the labels.

## Privacy

`rewrite` runs on arbitrary text, including drafts written on work hosts.
`scripts/mine.ts` hardcodes `host = 'local'` in its probe SQL, so imported work
sessions are never read. `data/` and `feedback/` are gitignored regardless. The
only content that ships is the synthetic `drafts/` set.

## Dataset

The rubric wants real `(input, output)` pairs. They can't be reconstructed from
the session index. `rewrite` runs in a fork and displays its result rather than
writing a file, and the rewritten text is gone the moment that fork returns. The
index keeps the input, which arrives as the skill args in `skill_calls`. It
never sees the output.

So the labelable set is synthetic. `drafts/` holds hand-authored pairs, each a
sloppy `input` and a plausible but imperfect `output`, seeded with the two
failure modes a labeler needs to catch:

- Over-stripping: the rewrite drops a functional fact the input carried.
- Residual slop: a trope survives into the output.

The drafts are tracked and reproducible, the way
[`evals/issue-refine/briefs`](../issue-refine/briefs) seeds its A/B scenarios
with the tropes its rubric targets. `mine.ts` still probes the index and reports
how many real `writing:rewrite` invocations exist. A future owner needs that
real-corpus size even though the outputs aren't recoverable.

## Workflow

### 1. Mine

Build the session index first if it is stale (the session skill owns it):

```bash
bun plugins/claude-code/skills/session/scripts/refresh.ts
```

Then assemble the labelable sample:

```bash
bun evals/writing/scripts/mine.ts                      # writes data/samples.json
bun evals/writing/scripts/mine.ts --limit 30
```

`mine.ts` probes the index for the real invocation count, loads the synthetic
`drafts/`, and selects a category-balanced sample that interleaves the longer
rewrites with the tight one-liners.

### 2. Label

```bash
bun evals/writing/label/server.ts                      # http://localhost:4320
```

Open the URL and review each pair. Input and output render side by side. Per
item you can:

- Select any span in either panel to attach an inline comment with a severity
  (critical / minor / praise). Mark lost meaning on the input, residual slop on
  the output. Highlights persist across reloads.
- Set a verdict (good / ok / bad), toggle quality tags, and write freeform notes.

Everything autosaves to `feedback/<id>.json`.

The UI is a single-file labeling server serving the paired view.

### 3. Derive the rubric (after labeling)

Once a batch is labeled, the recurring critical spans and tags become
`RUBRIC.md`: the failure modes the rules should stop producing (over-stripping,
residual slop) and the traits to preserve. That feeds concrete edits to
`plugins/writing/` and a mechanical `score.ts`.

The scorer will not re-implement pattern matching. It wraps the plugin's own
engine: [`plugins/writing/detection/scan.ts`](../../plugins/writing/detection/scan.ts)
(`scanAll`) or the `writing:score` skill's `--json` density output. Residual slop
is whatever the engine still finds in the output.

### 4. A/B test a rules change (after the rubric)

An A/B run takes each synthetic draft's input, rewrites it through two versions
of the rules (committed via `git show HEAD:...` versus the working tree), and
scores both outputs. `ab-report.ts` gives the mechanical score, a blinded
`judge.ts` handles the meaning-loss findings the engine can't measure.

The scorer is the plugin's own detection engine, so an A/B run must pin that
engine and its wordlists to one revision across both sides. Scoring the new
rules with the new engine would let a wordlist edit flatter itself. Pin to the
committed revision so both outputs are judged by the same detector.

## Status

- Done: `scripts/mine.ts`, `drafts/`, `label/` UI, this loop definition.
- Next (owner): run the labeler over the drafts, expand `drafts/` toward ~30
  pairs spanning more categories, label them.
- After labeling: `RUBRIC.md`, `score.ts` (wrapping `scan.ts`), `judge.ts`,
  `ab-report.ts`, and a gate on `plugins/writing/` edits.

## Layout

- `scripts/mine.ts`: probes the index, builds `data/samples.json` from `drafts/`
- `scripts/mine.test.ts`: property and table tests over the pure helpers
- `drafts/`: synthetic `(input, output)` pairs, seeded with both failure modes (tracked)
- `label/server.ts`, `label/index.html`: the paired review UI (inline span comments, verdict, tags, notes)
- `data/`, `feedback/`: generated or local-only (gitignored)
