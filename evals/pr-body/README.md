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

## Promptfoo A/B

`promptfooconfig.yaml` runs the real skill. Both arms are `anthropic:claude-agent-sdk` providers, which spawn a Claude Code subprocess against a fixture directory, so what is measured is the skill plus the harness rather than a bare model call.

```bash
bun run --cwd evals/pr-body eval:smoke     # first 2 scenarios, both arms
bun run --cwd evals/pr-body eval           # all 8
bun run --cwd evals/pr-body eval:view      # browse the run
```

Both entries rebuild the fixtures first and set `PROMPTFOO_CONFIG_DIR=$HOME/.cache/promptfoo`, because the default `~/.promptfoo` is not writable under the repo sandbox. Arms and graders both carry `apiKeyRequired: false` and authenticate through the logged-in CLI, so a local run needs no key. Set `ANTHROPIC_GRADER_API_KEY` to grade the rubric metrics against the API instead. The override does not reach the `preference` metric: promptfoo's comparison-assert path sends any configured `apiKey` as a literal header, so that assert's provider carries none and authenticates through the CLI credential everywhere.

`ANTHROPIC_API_KEY` must stay unset locally. The provider hands its whole environment to the Claude Code subprocess and re-injects that variable even under `apiKeyRequired: false`, and the CLI takes an API key over the claude.ai login, so exporting it bills both arms to the API instead of the subscription. CI spends subscription credits too, through a `CLAUDE_CODE_OAUTH_TOKEN` secret from `claude setup-token`: the spawned CLI reads it from the environment, and the workflow writes it into `~/.claude/.credentials.json` for the graders, whose unkeyed path reads that file on Linux.

`promptfoo` is pinned to an exact `0.122.2` rather than a range. Two workarounds in `promptfooconfig.yaml` are shaped around bugs in that release: the comparison assert's provider omits `apiKey` because promptfoo sends any configured value as a literal header, and `SELECT_BEST_PROMPT` is restated as a user turn because the built-in is a lone system message the Messages API rejects. A version bump has to re-validate both before the caret goes back.

### Arms

`scripts/fixtures.ts` writes `fixtures/current/` and `fixtures/revised/`, each a `pull-request/` plugin tree holding only the `create` skill plus a `project/` scratch directory the session runs in. The two differ in one file. With no `--variant`, the revised arm gets a generated bullet appended to the skill's `## Body` guidance, enough of a delta to prove the wiring moves.

```bash
bun evals/pr-body/scripts/fixtures.ts --variant <revised-SKILL.md>
bun evals/pr-body/scripts/fixtures.ts --variant <revised-sections.md> --variant-path references/sections.md
```

`EVAL_VARIANT` and `EVAL_VARIANT_PATH` set the same two values. Use them to carry a variant through the `bun run eval` chain, which rebuilds the fixtures itself:

```bash
EVAL_VARIANT=drafts/sections.md EVAL_VARIANT_PATH=references/sections.md bun run --cwd evals/pr-body eval
```

The fixture copy of `SKILL.md` drops the skill's `## Context` block, whose `!` lines shell out for the repo's remote, template, and git state. That context reaches the model through test vars instead. The materializer fails rather than materializing if a `!` line appears anywhere else in the skill.

### Cases

`scripts/cases.ts` renders `scenarios/` into `cases.json`, the file promptfoo reads. Vars carry the repo, tier, branch, base, diff summary, and session notes. `originalBody` never reaches a case, so neither arm can copy the shipped text. `bun run --cwd evals/pr-body cases --check` fails when the two have drifted, and a test asserts the same thing.

The prompt those vars fill lives in the `prompts:` block of `promptfooconfig.yaml`. It names `pull-request:create` outright, matching how a session invokes the skill. An opener that only described the task left the model answering from its own judgment in two of sixteen validated cells, and a body written without the skill has no guidance to attribute a score to.

### Grading

Grading is split by whether the dimension has ground truth behind it.

`headingTells` is a `javascript` assert running `scripts/assert-headings.ts`, which pulls the draft's headings through the same `classifyPrHeading` the shipped hook enforces. That classifier is calibrated against `labels.json` at 96.8% precision. The one dimension with hand-labeled truth behind it is therefore decided deterministically, and costs nothing to grade. A body fails the metric when any heading is flagged, and the reason names each heading and the signals that fired.

The four `llm-rubric` asserts (`narrationLeak`, `verbosity`, `selfContained`, `substanceRetention`), ported from `judge-prompt.md`, plus the `select-best` assert that picks the arm a reviewer would rather receive, cover what no labels exist for. Their absolute scores are uncalibrated, so what they support is a comparison between the two arms of one run. A `skill-used` assert proves the create skill actually ran. The grader provider is pinned to Anthropic so promptfoo never falls back to its default OpenAI grader.

`scripts/judge.ts` and `judge-prompt.md` stay as the audited fallback. They run blinded on Opus-generated bodies with the whole rubric in one prompt, which is the reference the promptfoo rubrics are checked against when a verdict looks wrong.

Sonnet 5 rejects `temperature`. The grader therefore carries no sampling parameters. Clear promptfoo's response cache with `promptfoo cache clear` when a rubric edit needs regrading.

Caching does not pin the arms. It covers grader calls only: the agent-sdk provider disables its own caching under subscription auth (`externalCredentialProviderBypassesCache`), so both arms regenerate on every local run and a repeat run measures sampling noise as well as the guidance delta.

### Cost

Each arm caps at `max_budget_usd: 0.75` and `max_turns: 12`, and `setting_sources: []` keeps user and project config out of the session, which is the main lever on per-session tokens. A measured draft costs $0.12 to $0.43 at list price over two to five turns, so an 8-case A/B reports somewhere near $3 to $5. Locally that spend is the subscription's and `evals/scripts/report.ts` files it as subscription-notional. In CI it is real API spend against the monthly budget.

Export a run into the durable corpus with the `results` entry, which pins the suite name so the slug promptfoo would derive from the config description never gets used:

```bash
bun run --cwd evals/pr-body results          # the latest run
bun run --cwd evals/pr-body results --sync   # then mirror to S3
```

## Legacy A/B Eval

`scripts/run-eval.ts` measures whether a guidance revision changes what the model writes. It predates the promptfoo suite and cannot load skills, so both arms are plain markdown files inlined into the generation prompt. It stays until the promptfoo graders are validated against `labels.json`.

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
- `cases.json`: generated from `scenarios/`, tracked so the suite runs on a fresh clone
- `data/`, `feedback/`, `results/`, `fixtures/`: gitignored, rebuilt by the miner, the labeler, and the runners

## Layout

- `promptfooconfig.yaml`: the two-arm suite, its rubrics, and the pinned grader
- `scripts/fixtures.ts`: materializes `fixtures/current/` and `fixtures/revised/`
- `scripts/cases.ts`: renders `scenarios/` into `cases.json`
- `scripts/assert-headings.ts`: the `headingTells` assert, the classifier behind promptfoo's `javascript` hook
- `scripts/mine.ts`: builds `data/samples.json` from `pr_links` plus `gh pr list`
- `scripts/score.ts`: mechanical rubric, one JSON row per body
- `scripts/run-eval.ts`: legacy two-arm generation over `scenarios/`
- `scripts/judge.ts`, `judge-prompt.md`: the legacy blinded LLM judge
- `label/server.ts`, `label/index.html`: the review UI
- `classifier.ts`, `labels.json`, `calibrate.ts`: the heading screen and its calibration
