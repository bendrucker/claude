# PR Body Eval

A local harness for measuring the PR bodies that `pull-request:create` produces, so edits to `plugins/pull-request/skills/create/` are gated on output quality instead of lint alone. It follows the structure of [`plugins/issue/evals/issue-refine`](../../../issue/evals/issue-refine) for mining and labeling, and the structure of the retired `evals/pr-headings` harness for scoring.

The loop: mine real bodies, label them, turn the labels into a mechanical score, then run the curated scenarios as native cases against two refs of the guidance and compare scores.

## Privacy

The session index includes an imported `work` host marked block-egress, and work PR bodies live on private hosts anyway. `scripts/mine.ts` hardcodes `host = 'local'` and `repository LIKE 'bendrucker/%'` in its SQL, so only public personal PRs are ever mined. Keep those filters if you touch the query. `data/`, `feedback/`, and `results/` are gitignored regardless.

## Fixtures

Data mined from real PRs and sessions stays out of this public repo. It lives in `s3://ben-drucker-agents-eval-corpus/pr-body/` (the `agents` account) and syncs into gitignored local copies:

- `fixtures/`: `labels.json` and `scenarios/`, at `pr-body/fixtures/`
- `data/revisions/`: Claude-drafted bodies paired with Ben's revisions (`work.jsonl`, `github.jsonl`), his pre-AI PRs (`handwritten.jsonl`), and his feedback on PR bodies (`feedback.jsonl`), at `pr-body/data/revisions/`
- [`../create-scenarios/`](../create-scenarios/): the scenario case directories and their `examples/`, at `pr-body/create-scenarios/`

```bash
bun plugins/pull-request/evals/pr-body/scripts/sync.ts pull   # --profile agents
bun plugins/pull-request/evals/pr-body/scripts/sync.ts push   # --profile agents-admin
```

`--dry-run` lists the changes without copying. `calibrate.ts`, `run-eval.ts`, and `judge.ts` read `fixtures/` and exit with a pointer to `pull` when it is missing.

## Structure Limits

`structure.ts` parses a body to mdast and measures what a reader sees without expanding anything: prose outside fenced code and `<details>`. `LIMITS` holds three one-sided limits: 120 visible words, 40 words in the longest paragraph or bullet, and 6 inline code spans in paragraphs and list items (`proseCodeSpans`, excluding tables, fenced code, and `<details>`). A body fails only by exceeding one, so collapsing data or writing less never costs anything. The output should be a baseline Ben adds to, shorter than what he writes himself.

`scripts/limits.ts <results-dir>...` scores each run's PR body against the limits as `visible-words`, `max-block`, and `prose-code-spans` rows and writes `<results-dir>-limits/` for `compare.ts`. Run it before `compare.ts`. The `work-*` cases in `create-scenarios` come from edited work MRs, described in summary with no source. Their fixtures run `create-scenarios/stubs.sh`, which installs the [`eval-stubs`](../../../../packages/eval-stubs/) `glab` and `gh` in echo mode so the body-rules hook fires on the create call and `limits.ts` reads the body the stand-in printed.

`scripts/fit.ts` checks a metric against `data/revisions/`: how often a revision moves it down, and with `--human`, how well it separates plugin drafts from Ben's writing (AUC).

```bash
bun plugins/pull-request/evals/pr-body/scripts/fit.ts data/revisions/work.jsonl data/revisions/github.jsonl --via-skill --human data/revisions/handwritten.jsonl
```

On the 2026-10 corpus, 2-4% of plugin drafts pass both limits, against 65% of Ben's pre-AI PRs. Diff size predicts the length of Ben's edits only weakly (Spearman 0.30), so the budget is flat.

## Mining

Build the session index first if it is stale (the `observability:session` skill owns it):

```bash
bun plugins/observability/skills/session/scripts/refresh.ts
```

Then mine PR bodies:

```bash
bun plugins/pull-request/evals/pr-body/scripts/mine.ts                      # writes data/samples.json
bun plugins/pull-request/evals/pr-body/scripts/mine.ts --limit 80
bun plugins/pull-request/evals/pr-body/scripts/mine.ts --db ~/.claude/plugins/data/observability-bendrucker/session.duckdb
```

`mine.ts` enumerates PRs opened from local sessions via the index's `pr_links` view, fetches their bodies with `gh pr list`, drops bodies below `--min-chars`, and selects a repo-balanced sample that interleaves long sectioned bodies with tight one-paragraph ones. Each item records repo, PR number, URL, date, state, and the originating session id. Without `--db` it resolves the index from `CLAUDE_PLUGIN_DATA`, matching the other `evals/` miners.

## Labeling

```bash
bun plugins/pull-request/evals/pr-body/label/server.ts                      # http://localhost:4319
```

Open the URL and review each body. Select any span in the rendered body to attach an inline comment with a severity (critical, minor, praise), and set a verdict, quality tags, and freeform notes per PR. Highlights persist across reloads. Everything autosaves to `feedback/<id>.json`. The header links to the PR on GitHub so the diff is one click away while judging the body.

The UI is copied from `plugins/issue/evals/issue-refine/label/` and adapted. Copying is the current convention across the harnesses. Extracting a shared harness package is a known deferred refactor.

## Scoring

`scripts/score.ts` is the rubric as code: the recurring critical spans and tags from a labeling session become mechanical checks. The CLI scores one file and prints a readable report, or a machine row with `--json`. `run-eval.ts` calls the same scorer as a library to emit one JSON row per body, so a run is greppable, diffable, and joinable across arms without a second format.

## Scenario Cases

The eight `fixtures/scenarios/` run as native cases in the local-only [`create-scenarios`](../create-scenarios/) suite, named `scenario-<id>` and tagged `scenario`. Each `prompt.md` carries the scenario's repository, audience tier, diff summary, and session notes, and asks for the PR through `pull-request:create`. `originalBody` never reaches a case, so the session cannot copy the shipped text. Each `fixture.sh` builds a git repo on the scenario's branch with the scenario's remote and one empty commit named for the change, so every `!` context command in the skill succeeds while the diff itself reaches the model through the summary.

```bash
bun evals/native/run.ts plugins/pull-request/evals/create-scenarios -- --runs 2
bun evals/native/run.ts plugins/pull-request/evals/create-scenarios --ref main -- --runs 2
```

The second line grades the skill as it stands at `main` with the same cases. [`compare.ts`](../../../../evals/native/compare.ts) then compares the two results directories row by row, which replaces the old two-arm A/B: the base ref is the current arm and the working tree is the revision. No preference grader picks between arms, since `compare.ts` across refs answers the same question per grader.

Each scenario case grades:

- `reply-shape`: the reply holds a `Title:` line, a blank line, then the body
- `skill-fired`, `skill-loaded`: the plugin arm invoked `pull-request:create` and its context commands succeeded
- `heading-sentence-case`, `heading-question`, `heading-clause`: regex approximations of `classifyPrHeading`
- `generic-heading`: no heading that would fit any PR, such as `Summary` or `Test Plan`
- `narration-leak`, `verbosity`, `self-contained`, `substance-retention`: `llm` graders ported from the retired promptfoo rubrics, scoped to the body after the `Title:` line. `verbosity` embeds the diff summary and `substance-retention` the session notes, so the judge grades against the scenario

The judge sees only the final reply, one criterion at a time, and answers with one word. `narration-leak` judges sentences only, since `generic-heading` settles the heading half of the old rubric deterministically. The rubrics this suite replaced scored an isolated slip near the middle of a scale. A native verdict is binary, so `narration-leak` and `self-contained` pass a single slip in an otherwise clean body and fail on a pattern.

The three heading regexes split the classifier's signals into sentence case, question-shaped or sentence-terminated headings, and comma or parenthetical clauses. Against `fixtures/labels.json` they reach 100% precision and 76.8% recall together (sentence case alone 55.1% recall, the other two 21.7% each). The classifier itself reaches 87.0% recall, so the regexes trade recall on predicate verbs and short parentheticals for zero false positives. `bun evals/native/check.ts plugins/pull-request/evals/create-scenarios` checks each case's regex graders against `examples/scenario-<id>/`, where `shipped.md` is the PR body that actually merged.

## Calibration

`classifier.ts` is the lexical sentence-heading screen ported from the `pr-headings` harness. `classifyPrHeading(heading)` returns `{ flagged, signals }`, where each signal names the tell that fired (trailing punctuation, interrogative opener, predicate verb, sentence case, length). `score.ts` uses it for the headings dimension, and the scenario cases' heading regexes approximate it.

`calibrate.ts` scores the classifier against `fixtures/labels.json`, 102 headings hand-labeled good or bad:

```bash
bun plugins/pull-request/evals/pr-body/calibrate.ts
```

Current numbers: 96.8% precision, 87.0% recall, F1 0.92. Precision is the one to defend. A false positive flags a heading the user considers good, which is how a screen loses trust. Treat a drop below 95% as a regression in the port, and fix the port rather than tuning the classifier to the labels.

## Legacy A/B Eval

`scripts/run-eval.ts` measures whether a guidance revision changes what the model writes. It predates the native scenario cases and cannot load skills, so both arms are plain markdown files inlined into the generation prompt. It stays as the audit reference the scenario cases' `llm` graders are checked against.

```bash
bun plugins/pull-request/evals/pr-body/scripts/run-eval.ts --arm-a <current-guidance.md> --arm-b <revised-guidance.md>
```

Arm A is the current guidance text, arm B the revision under test. Each scenario runs twice per arm (two seeds) to separate a real effect from sampling noise. Generation runs on Opus, matching the model that writes bodies in practice. Judging runs on Sonnet via `scripts/judge.ts` and `judge-prompt.md`, blinded to which arm produced which body. Both steps need `ANTHROPIC_API_KEY`.

Scenarios live in `fixtures/scenarios/<id>.json`, one file per real PR, with the shipped body kept for reference and baseline scoring:

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

## Ground Truth

- `fixtures/labels.json`: 102 labeled headings, the calibration target, in the bucket
- `fixtures/scenarios/`: curated generation scenarios with the shipped body for reference, the source of the `scenario-*` cases in `../create-scenarios/`, in the bucket
- `judge-prompt.md`: the judge rubric, tracked
- `data/`, `feedback/`, `results/`: gitignored, rebuilt by the miner, the labeler, and the runners

## Layout

- `scripts/mine.ts`: builds `data/samples.json` from `pr_links` plus `gh pr list`
- `scripts/score.ts`: mechanical rubric, one JSON row per body
- `scripts/run-eval.ts`: legacy two-arm generation over `fixtures/scenarios/`
- `scripts/judge.ts`, `judge-prompt.md`: the legacy blinded LLM judge
- `label/server.ts`, `label/index.html`: the review UI
- `classifier.ts`, `calibrate.ts`: the heading screen and its calibration
- `scripts/sync.ts`: pulls and pushes `fixtures/` and the `create-scenarios` cases
