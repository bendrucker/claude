# `issue:refine` Eval

A native `claude plugin eval` suite for `issue:refine`. Each case hands the skill a synthetic brief plus the files and related issues an investigation would find, and asks for the finished issue between `<issue>` and `</issue>` lines, with and without the plugin.

The graders encode [`RUBRIC.md`](RUBRIC.md), which came from labeling real refined issues. The shared ones live in `graders/` and join every case through `suite.yaml`. They scope to the `<issue>` block: title checks read the frontmatter, and body checks stop at `## 🤖 Agent Context`, where line numbers and bare lists are allowed. Critical findings (an H1 in the body, antithesis headings, bare issue numbers, line-number citations) weigh 3, the rest 1. `type-*` graders pin each case's expected type, `no-headings` holds the trivial cases to a sentence or two, and `relations` checks the cases whose related issues carry URLs.

Cases are tagged by type (`bug`, `feature`, `refactor`, `spike`) and size (`trivial`, `compact`, `full`). `seeded` marks the two briefs written to bait the rubric's failures: bare issue numbers and line ranges in the brief.

`bun evals/native/run.ts plugins/issue/evals/issue-refine -- --tag seeded` runs it locally, and `gh workflow run eval.yml --ref <branch> -f suite=plugins/issue/evals/issue-refine` in CI. Results land in the gitignored `results/`.

`examples/<case>/` holds, per case, an issue every grader accepts, plus issues that trip each grader. `bun evals/native/check.ts plugins/issue/evals/issue-refine` tests every regex grader against them.
