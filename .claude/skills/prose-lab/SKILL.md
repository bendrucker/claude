---
name: prose-lab
description: Turn the user's labels on repo prose, or their notes from reviewing a document in Plannotator, into calibrated Vale rules.
disable-model-invocation: true
argument-hint: "[review <file>] [--corpus skills|agent-facing|all]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/../../../packages/prose-lab/lab.ts:*)
  - Read
  - Write
  - Grep
  - Glob
  - AskUserQuestion
---

# Prose Lab

The user flags writing anti-patterns in this repo's documents. The lab turns a pattern with enough examples into a Vale rule that holds a precision floor on text it was not written from, and retires shipped rules the corpus stops supporting. `.claude/rules/vale-styles.md` sets the bar every rule meets.

Run every command as `bun ${CLAUDE_SKILL_DIR}/../../../packages/prose-lab/lab.ts <command>`. `--help` on any command lists its flags. Data lives in `packages/prose-lab/data/`, gitignored. Run `sync pull` before a sitting and `sync push` after one.

## Arguments

- `--corpus <name>`: the documents `sweep` lints. Default: `skills`.

## Flag

Run `sweep`, then `serve` in the background, and hand the user the URL. The sample tab takes right, wrong, or unsure per hit with an optional pattern slug. The document tab flags spans that the rules missed. Stop until the user says the sitting is done.

## Review

For `review <file>`, run `review <file>` in the background with `timeout: 7200000` and `dangerouslyDisableSandbox: true`, since the sandbox refuses the browser's connection to Plannotator. Hand the user the URL it prints. It snapshots the file into the lab data, records each inline comment as a flag without a pattern, prints global and unlocated notes, and re-sweeps. When it exits, go straight to Group.

## Group

Read the new labels and flags, including flags without a pattern and the notes `review` printed. Cluster their notes and matches into patterns, and confirm each new slug with the user through `AskUserQuestion`. Register each with `pattern`, then `assign` its labels and flags.

## Generalize

Take a pattern whose `status` stage is `generalizing`. Write three or more candidate rules into `tmp/candidates/`, ranging from the most abstract form to the narrowest. Score them together with `score <pattern> <files...>`.

`score` also reports each candidate's complexity, and `status` picks the simplest candidate whose precision interval overlaps the most precise one's. A candidate over the ceiling never reaches `ready`. Rewrite it with a part-of-speech `sequence` or a scope instead of a hand-listed exception.

Pre-judge the hits `score` queues with `label <id> --verdict ... --pattern <slug>`, which records them as the model's. Rescore. Collect the hits you judged `unsure` into one list for the user. The user's label on a span overrides yours.

## Promote

Promote the candidate `status` reports as `ready`. Write it into `plugins/<plugin>/styles/<Style>/` with an `evidence:` header naming the labeled counts and a `retire when:` header. Add `vale test` cases from labeled examples, at least three right and three wrong. Run `vale --no-global --config=plugins/<plugin>/.vale.ini test plugins/<plugin>/styles/<Style>`. For a `Prompting` rule, also run the precision eval in `plugins/prompting/evals/rule-precision/`. Then record the check with `pattern <slug> --check <Style.Rule>`.

When no candidate clears the floor, ship nothing. Record the trial (each candidate, its interval, and why it failed) in the commit that closes the round.

## Retire

After each `sweep`, the check table in `status` marks shipped checks whose labeled floor fell under the bar. Propose retiring each one to the user with its counts.

`status` also names the plugins' rules over the complexity ceiling, and `rules` ranks them all. Rewrite one with candidates checked by `compare <rule> <candidates...> --dir <corpus>`, which lists the hits each keeps, drops, and adds. Accept a drop when the dropped hits are rare or marginal. Pass `--rate <Style.Rule> --verdict complex|fine` to `rules` when the user disagrees with a score, and refit `WEIGHTS` in `complexity.ts` when the ceiling's agreement falls.

## Completion

A round is done when every pattern at `generalizing` either has a promoted rule or a recorded trial, and the user has the list of hits you judged unsure.

Read [references/thresholds.md](references/thresholds.md) when a stage looks wrong or the user asks to change a bar.

## Gotchas

- A Vale `sequence` rule's `skip` does nothing on a punctuation token. Put `skip` on a `pattern: '\w+'` token after it.
- Penn's `:` tag covers both colons and semicolons.
- The tagger reads many verbs as nouns and drops inline code, so a rule that needs a finite verb after punctuation misses most of its positives.
- Writing's `ai-tells.SemicolonUsage` already covers clauses joined by a semicolon. Score a joined-clause candidate on colons alone.
