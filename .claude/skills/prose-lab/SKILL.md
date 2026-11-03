---
name: prose-lab
description: Turn the user's labels on repo prose, or their notes from reviewing a document in Plannotator, into calibrated Vale rules.
disable-model-invocation: true
argument-hint: "[review <file>] [--corpus skills|agent-facing|all] [--repo <path>...]"
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

- `--corpus <name>`: the documents `sweep` lints. Default: `skills`. On `status` and `serve`, it limits the ratings, calls, and deck to hits in that corpus's files, so `status --corpus agent-facing` rates a check on prompts apart from prose a person reads.
- `--repo <path>`, repeatable: `sweep` also lints the corpus in that checkout. Its hits' files read `name:path`, where `name` is the checkout's directory. Keep another repo's paths and quotes in the lab data, out of commits and PR bodies.

## Flag

Run `sweep --corpus all --wide`, with a `--repo` for each checkout the user named. `--wide` also reports the checks the plugin configs turn off. Start `propose` and `serve` in the background, and hand the user the URL. `propose` asks a model for spans the rules miss, one call per file, and its cards join the deck as `Model.Proposed` as they arrive.

The cards tab shows one hit at a time without its check, choosing the undecided check with the widest interval. A vote on a span judges every check with a hit on it. The sample tab lists hits per check, and the document tab flags spans that neither the rules nor the model marked. Stop until the user says the sitting is done.

Then run `status`, which calls each check decided past ten judged hits. Run it again with `--corpus agent-facing` to rate checks on prompts alone. Propose each `enable` and `retire` call to the user with its counts. An accepted `enable` flips the check's line in the plugin's `.vale.ini` per `.claude/rules/vale-styles.md`. Retire through Retire. Take the `Model.Proposed` hits labeled right to Group, since they name patterns the rules miss.

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

A check `status --corpus agent-facing` calls `enable` or `keep` reaches `prompting:scan` here: turn an `ai-tells` check on in `plugins/prompting/.vale.ini`, or port a `Writing` rule into the `Prompting` style.

When no candidate clears the floor, ship nothing. Record the trial (each candidate, its interval, and why it failed) in the commit that closes the round.

## Retire

The check table in `status` calls `retire` on a shipped check whose interval sits wholly under the floor. Propose retiring each one to the user with its counts.

`rules` ranks the plugins' rules by complexity and marks those over the ceiling. Rewrite one with candidates checked by `compare <rule.yml> <candidates...> --dir <corpus>`, passing the rule's file path, which lists the hits each keeps, drops, and adds. Accept a drop when the dropped hits are rare or marginal. When the user disagrees with a score, adjust `WEIGHTS` in `complexity.ts`.

## Completion

A round is done when every pattern at `generalizing` either has a promoted rule or a recorded trial, and the user has the list of hits you judged unsure.

Read [references/thresholds.md](references/thresholds.md) when a stage looks wrong or the user asks to change a bar.

## Gotchas

- A Vale `sequence` rule's `skip` does nothing on a punctuation token. Put `skip` on a `pattern: '\w+'` token after it.
- Penn's `:` tag covers both colons and semicolons.
- The tagger reads many verbs as nouns and drops inline code, so a rule that needs a finite verb after punctuation misses most of its positives.
- Writing's `ai-tells.SemicolonUsage` already covers clauses joined by a semicolon. Score a joined-clause candidate on colons alone.
