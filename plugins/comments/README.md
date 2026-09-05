# Comments

Detect AI slop code comments in a diff and steer clean comment generation.

LLMs over-produce low-value comments: restatement of simple code, narration of the change, self-praise, and section-divider banners. They also dress real facts in AI voice. This plugin extracts comments deterministically, judges them against a model of when a comment earns its place, and acts on each: `keep` the good ones, `trim` the slop, and `rewrite` the ones that carry a fact under voice. The changes land on a review branch.

## Scopes

One pipeline, two scopes selected by a flag:

- Diff scope (default, `--base <ref>`, `--mr <iid>`): the comments a change introduced, scoped to added and modified lines.
- Repo scope (`--all`): every tracked code file's comments, for sweeping a slop-heavy codebase into a large reviewable deletion.

Both run extraction, intrinsic-complexity ranking, an agent fan-out for judging, and a deterministic apply.

## Contents

- **`comments:audit`** skill: the three-step pipeline. `preflight` extracts, ranks, and builds the judging job. The committed Workflow fans out one agent per shard to judge. `apply` lands the trims and rewrites on a `comments/audit-*` branch or reports the findings. `--report`, `--fix`, `--path`, `--sort`, and `--limit` tune scope and output.
- **`detection/`**: comment extraction over Shiki's TextMate grammars, the diff and repo collectors, intrinsic-complexity ranking, stable comment ids, and the exemption gate that keeps tool directives, shebangs, and license headers away from the judge. `density.ts` measures comment share against calibrated per-language baselines, weighting the ranking. `provenance.ts` blames each comment's lines and quotes the agent evidence off their commits (uncommitted lines, trailers such as `Co-Authored-By` and `Claude-Session`, the Claude Code footer, bot authors), which rides along to the judge as authorship evidence. Git names the committer, so a human name with no signal is weak evidence, and the judge reads the voice as well. `tree.ts` reads the working tree against the branch's merge base for the Stop hook, and `transcript.ts` names the files a session edited. Per-comment deterministic features land in the job dir beside the verdicts, accumulating labeled pairs for a future routing layer.
- **`judge/`**: the versioned `prompt.md`, the verdict schema, per-verdict validation, and the job builder that shards comments for the Workflow.
- **`workflow/`**: the committed Workflow script the skill hands the job to.
- **`apply/`**: the deterministic edit engine, the verdict id-match against re-extracted comments, the branch writer, and the report renderer.
- **`evals/`**: the labeled fixture corpus, the action-accuracy eval, and the SDK calibration oracle behind a must-keep ship gate.
- A preventive steering rule lives at `user/rules/code-comments.md`, scoped by path to code files.

## Density Hook

`hooks/density.ts` runs on `Stop`. It takes the files the session's `Edit`, `Write`, and `MultiEdit` calls named, measures the comment share of the lines those files add over the branch's merge base with the default branch, and charges each file's comment weight against its language baseline. At 2800 characters of total excess it blocks the stop, names the three heaviest files, and asks for a `comments:audit` run over the diff and the trims it flags. Below that it stays silent.

The number describes the tree as it stands. Trimming a comment lowers it, rewriting one costs what the surviving text weighs, and a branch back at its base scores zero, so the audit the hook asks for can satisfy it.

The score is volume, so slop written at an ordinary density passes. Files the session touched through a shell heredoc or `sed` never reach it, and neither does work outside the repo it stopped in. It also skips extensions missing from the language map, generated files, and files git ignores. Added lines that are 95% comment read as a documentation pass and never escalate on their own.

It blocks once. The reason opens with a `comment-density:` marker, and the hook scans the whole transcript for it before blocking again. Turning it off means disabling the plugin.

## Testing

Deterministic extraction, ranking, the job builder, the edit engine, the verdict join, and the hook's block and suppression paths:

```bash
bun test plugins/comments
```

The eval's ship gate runs the SDK oracle and needs `ANTHROPIC_API_KEY`:

```bash
bun run plugins/comments/evals/eval.ts --gate
```

The gate holds the must-keep comments at `keep` (canonical-API docstrings, genuine why-comments, regression-test rationale). Trimming or rewriting one of those is the destructive error the gate guards against.
