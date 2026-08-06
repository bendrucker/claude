# PR Body Eval

A local harness for measuring the PR bodies that `pull-request:create` produces, so edits to `plugins/pull-request/skills/create/` are gated on output quality instead of lint alone. It follows the structure of [`evals/issue-refine`](../issue-refine) for mining and labeling, and the structure of the retired `evals/pr-headings` harness for scoring and the A/B runner.

The loop: mine real bodies, label them, turn the labels into a mechanical score, then A/B two versions of the guidance text against curated scenarios and compare scores.

## Privacy

The session index includes an imported `work` host marked block-egress, and work PR bodies live on private hosts anyway. `scripts/mine.ts` hardcodes `host = 'local'` and `repository LIKE 'bendrucker/%'` in its SQL, so only public personal PRs are ever mined. Keep those filters if you touch the query. `data/`, `feedback/`, and `results/` are gitignored regardless.

## Mining

Build the session index first if it is stale (the `claude-code` plugin's session skill owns it):

```bash
bun plugins/claude-code/skills/session/scripts/refresh.ts
```

Then mine PR bodies:

```bash
bun evals/pr-body/scripts/mine.ts                      # writes data/samples.json
bun evals/pr-body/scripts/mine.ts --limit 80
bun evals/pr-body/scripts/mine.ts --db ~/.claude/plugins/data/claude-code-bendrucker/session.duckdb
```

`mine.ts` enumerates PRs opened from local sessions via the index's `pr_links` view, fetches their bodies with `gh pr list`, drops bodies below `--min-chars`, and selects a repo-balanced sample that interleaves long sectioned bodies with tight one-paragraph ones. Each item records repo, PR number, URL, date, state, and the originating session id. Without `--db` it resolves the index from `CLAUDE_PLUGIN_DATA`, matching the other `evals/` miners.

## Labeling

```bash
bun evals/pr-body/label/server.ts                      # http://localhost:4319
```

Open the URL and review each body. Select any span in the rendered body to attach an inline comment with a severity (critical, minor, praise), and set a verdict, quality tags, and freeform notes per PR. Highlights persist across reloads. Everything autosaves to `feedback/<id>.json`. The header links to the PR on GitHub so the diff is one click away while judging the body.

The UI is copied from `evals/issue-refine/label/` and adapted. Copying is the current convention across `evals/`. Extracting a shared harness package is a known deferred refactor.

## Scoring

`scripts/score.ts` is the rubric as code: the recurring critical spans and tags from a labeling session become mechanical checks. It reads bodies and emits one JSON row per body on stdout, so a run is greppable, diffable, and joinable across arms without a second format.

## A/B Eval

`scripts/run-eval.ts` measures whether a guidance revision changes what the model writes. The harness cannot load skills, so both arms are plain markdown files inlined into the generation prompt:

```bash
bun evals/pr-body/scripts/run-eval.ts --arm-a <current-guidance.md> --arm-b <revised-guidance.md>
```

Arm A is the current guidance text, arm B the revision under test. Each scenario runs twice per arm (two seeds) to separate a real effect from sampling noise. Generation runs on Opus, matching the model that writes bodies in practice. Judging runs on Sonnet via `scripts/judge.ts` and `judge-prompt.md`, blinded to which arm produced which body. Both steps need `ANTHROPIC_API_KEY`.

Scenarios live in `scenarios/<id>.json`, one file per real PR, with the shipped body kept for reference and baseline scoring:

```json
{
  "id": "NNN-<repo-short>-<pr number>",
  "url": "https://github.com/bendrucker/claude/pull/977",
  "title": "...",
  "repo": "bendrucker/claude",
  "tier": "personal",
  "diffSummary": "what changed at concept level, plus rough size (files, +/- lines)",
  "substance": ["decisions, evidence, rejected alternatives, deferred work a body could mine"],
  "originalBody": "the body actually shipped"
}
```

## Calibration

`classifier.ts` is the lexical sentence-heading screen ported from the `pr-headings` harness. `classifyPrHeading(heading)` returns `{ flagged, signals }`, where each signal names the tell that fired (trailing punctuation, interrogative opener, predicate verb, sentence case, length). `score.ts` uses it for the headings dimension.

`calibrate.ts` scores the classifier against `labels.json`, 102 headings hand-labeled good or bad:

```bash
bun evals/pr-body/calibrate.ts
```

Current numbers: 96.8% precision, 87.0% recall, F1 0.92. Precision is the one to defend. A false positive flags a heading the user considers good, which is how a screen loses trust. Treat a drop below 95% as a regression in the port, and fix the port rather than tuning the classifier to the labels.

## Ground Truth

Hand-made artifacts stay tracked. Everything bulky regenerates.

- `labels.json`: 102 labeled headings, the calibration target
- `scenarios/`: curated generation scenarios with the shipped body for reference
- `judge-prompt.md`: the judge rubric
- `data/`, `feedback/`, `results/`: gitignored, rebuilt by the miner, the labeler, and the runner

## Layout

- `scripts/mine.ts`: builds `data/samples.json` from `pr_links` plus `gh pr list`
- `scripts/score.ts`: mechanical rubric, one JSON row per body
- `scripts/run-eval.ts`: two-arm generation and judging over `scenarios/`
- `scripts/judge.ts`, `judge-prompt.md`: the blinded LLM judge
- `label/server.ts`, `label/index.html`: the review UI
- `classifier.ts`, `labels.json`, `calibrate.ts`: the heading screen and its calibration
