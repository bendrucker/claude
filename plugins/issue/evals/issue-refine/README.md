# `issue:refine` Eval

A native `claude plugin eval` suite for `issue:refine`. Each case hands the skill a synthetic brief plus the files and related issues an investigation would find, and asks for the finished issue between `<issue>` and `</issue>` lines, with and without the plugin.

The graders encode [`RUBRIC.md`](RUBRIC.md), drawn from labeled refine outputs and from the corrections Ben made to drafts in Plannotator and chat. The shared ones live in `graders/` and join cases through `suite.yaml`. They scope to the `<issue>` block: title checks read the frontmatter, and body checks stop at `## 🤖 Agent Context`, where line numbers and bare lists are allowed. Critical findings (an H1 in the body, antithesis headings, bare issue numbers, line-number citations, leaks of the drafter's own paths and tools) weigh 3, the rest 1.

## Cases

Cases are tagged by type (`bug`, `feature`, `refactor`, `spike`), size (`trivial`, `compact`, `full`), and split (`dev`, `holdout`). The split was drawn at random within each type.

- The short, clean briefs from the original rubric guard the formatting rules.
- `dump` cases hand over a session's investigation notes, the way most real refines start. The right issue keeps a fraction of them. Each carries `keeps-*` graders for the facts a cut must not lose, so deleting everything fails.
- `leak` cases plant the drafter's tmp paths, machine, and personal tools in the notes.
- `bug-upstream-empty-element` files into a repository the team doesn't maintain, where Agent Context must be absent and `#75` is native link syntax.
- Cases that supply a source URL or a repro grade `links-source` and `repro-code`. `bug-config-repro` reproduces from env config and a compose command.
- `seeded` briefs bait bare issue numbers and line ranges.
- The `neg-*` cases, tagged `negative`, are requests the skill must not take: filing, listing, or checking an issue in Linear, with the `linear` plugin loaded beside it. They score only `refine-not-fired`, a `tool_used` grader on both arms. `linear-fired` on `neg-linear-file` is a with-only indicator that the Linear skill took the request.

## Metrics

- `body-words-N` is a ladder on the body above Agent Context: 80, 150, and 250 for compact cases, 150, 250, and 400 for full ones, 80 for the trivial one. Each rung passes or fails, so a climb that trims bodies moves the score before it reaches the tightest rung.
- Other ladders work the same way: bullet length (`bullet-words-*`) and count (`bullets-*`), headings, paragraph length, inline code spans, and Agent Context length (`context-words-*`).
- `llm` graders judge one criterion each: `ac-verifies` and `oq-justified` on every non-spike case, `bullets-concise` on every case, and a case-specific judge where a rule needs reading (structured event definitions, acceptance tests that show the bug, decided items not left open, an unmerged harness not called existing). `judge_model` in `suite.yaml` runs them on a different model than the sessions.

## Running

`bun evals/native/run.ts plugins/issue/evals/issue-refine -- --tag dev` runs the dev split locally, and `gh workflow run eval.yml --ref <branch> -f suite=plugins/issue/evals/issue-refine -f args='--tag dev'` in CI. Results land in the gitignored `results/`. `bun plugins/issue/evals/issue-refine/scripts/sync.ts push` mirrors them to `s3://ben-drucker-agents-eval-corpus/issue-refine/results/` (`--profile agents-admin` by default, `--no-profile` in a cloud session), and `pull` brings them back for `compare.ts`.

`examples/<case>/` holds, per case, an issue every grader accepts, plus issues that trip each grader. `bun evals/native/check.ts plugins/issue/evals/issue-refine` tests every regex grader against them.
