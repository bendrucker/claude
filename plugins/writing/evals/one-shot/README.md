# One-Shot Rewrite Eval

Measures how far one rewrite moves a draft when the model gets every writing finding at once. The drafts are real: markdown written through Write and Edit, and bodies sent through Linear, Notion, and GitHub tools, mined from the session index.

## Drafts

`bun scripts/mine.ts` reads the session index, keeps each session's first version of a draft at 40 words or more, scans it with `findAll` (batch rules on, message rules for tracker bodies and `tmp/` files), and keeps drafts with at least one finding. It samples up to `--per-category` drafts for each category so rare rules get coverage, and tags a stable fifth `holdout` by id. Hosts imported without `--egress` are left out, so the sample can leave the machine.

Drafts land in the gitignored `data/drafts.jsonl`. `bun scripts/sync.ts push` copies them to `s3://ben-drucker-agents-eval-corpus/one-shot/data`, and `pull` brings them back.

## Rewriting

`bun scripts/run.ts --name <run>` rescans each draft with the current rules, hands the model the draft and every finding in one call ([`rewrite-prompt.md`](scripts/rewrite-prompt.md)), and rescans the rewrite. A second call ([`meaning-prompt.md`](scripts/meaning-prompt.md)) lists what the rewrite lost. Each draft's result lands in `results/<run>/<id>.json`, keyed by the prompts, models, draft, and rendered findings, so a rerun skips drafts whose inputs are unchanged and a rule edit reruns only the drafts it touches. `--split`, `--limit`, `--model`, and `--judge-model` pick the slice and models. Calls run on subscription auth.

## Report

`bun scripts/report.ts <run>` prints, per category, the drafts it fired on, the share of its instances the rewrite fixed, the instances left, the instances it introduced into drafts that lacked it, and the share of its drafts whose rewrite lost meaning. `--base <run>` sets a base run's figures beside each, over the drafts both runs share, which is how a rule or prompt edit is judged. The lossy column counts co-occurrence: a draft with several findings charges a loss to each of them.

## Dogfood

`bun scripts/dogfood.ts --name <run> --cwd <repo> <globs...>` runs the same rewrite and judge over markdown files that trip a rule. With `--apply` it writes back each rewrite the judge passes and lists the losses of the rest, so the diff on a branch is the review surface.
