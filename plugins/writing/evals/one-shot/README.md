# One-Shot Rewrite Eval

Measures how far one rewrite moves a draft when the model gets every writing finding at once. The drafts are real: markdown written through Write and Edit, and bodies sent through Linear, Notion, and GitHub tools, mined from the session index.

## Drafts

`bun scripts/mine.ts` reads the session index, keeps each session's first version of a draft at 40 words or more, scans it with `findAll` (batch rules on, message rules for tracker bodies and `tmp/` files), and keeps drafts with at least one finding. It samples up to `--per-category` drafts for each category so rare rules get coverage, and tags a stable fifth `holdout` by id. Hosts imported without `--egress` are left out, so the sample can leave the machine.

Drafts land in the gitignored `data/drafts.jsonl`. `bun scripts/sync.ts push` copies them to `s3://ben-drucker-agents-eval-corpus/one-shot/data`, and `pull` brings them back.
