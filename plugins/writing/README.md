# Writing

Writing style enforcement and slop detection for prose output (PR descriptions, review comments, Slack messages, documentation). Catches AI-generated and human writing patterns that read as vague, promotional, or templated.

## Contents

- **Hooks**: Step, phase, and part numbering detection, heading style enforcement, AI writing trope detection (em dashes, vocabulary, copula avoidance, promotional language, parallelism, connector density)
- **Skills**: `writing:writing` system reminder for prose writing guidelines, `writing:analyze` session-history-based trope ruleset curation, `writing:rewrite` user-invoked text rewriter, `writing:scan` user-invoked trope detector (`audit` gates a directory, `score` measures one input's density), `writing:review` multi-agent document review, `writing:no-diary` cuts process narration out of a deliverable
- **Agents**: `content`, `style`, `artifacts` (conditional review lenses)

## Wordlists

Word-list trope patterns live as line-delimited files under [`wordlists/`](wordlists/).

#### Stemmed Wordlists

One word per line. Matching uses a Porter stemmer (`stemmer` npm package), so inflected forms are caught from base entries. `#` comments and blank lines are ignored. Multi-word and hyphenated phrases are not supported (the stemmer tokenizes on word boundaries). Use inline regex patterns in `tropes.ts` for phrase matching.

#### Plain Wordlists (Regex)

Used for openers and let-me-verbs where the match depends on position (line start, "let me" prefix). One entry per line, compiled to a regex alternation with configurable prefix/suffix.

#### Weighted Wordlists

`<word> <weight>` per line. Uses the same Porter stemmer as vocabulary. The hook accumulates the weighted total of hits and reminds when the total clears a threshold.

The loader lives in [`detection/wordlists.ts`](detection/wordlists.ts). Compiled patterns are exposed via the `WORDLISTS` constant and consumed by `tropes.ts`.

## Hook Dispatcher

A single PreToolUse entry script, [`hooks/pretooluse.ts`](hooks/pretooluse.ts), reads stdin once and runs the numbering, headings, and tropes checkers in-process. It emits at most one output per tool call with fixed priority (deny > ask > context, earliest checker wins within a tier). Shared skips apply once up front: plan mode, plan and memory paths, and scratch paths (`tmp/` directories, `$TMPDIR`, background job dirs), where prose is internal handoff text that gets scanned later at the Bash egress surface (`--body-file`, `--body`, `gh api -F body=@file`) instead of at write time.

Context-tier findings are suppressed when the same rule category already fired in the session within the last five minutes ([`hooks/session-state.ts`](hooks/session-state.ts)). Deny and ask tiers always fire.

#### Run Log

Every dispatcher run appends one JSONL line to `~/.claude/writing-hooks/log.jsonl` (rotated past 5 MB): timestamp, session, tool, extension, duration, outcome (`silent | context | ask | deny | skipped-scratch`), category, and suppression. This is the evidence surface for auditing the hooks' cost and precision. `WRITING_HOOKS_LOG=0` disables it, and a path value redirects it. The `writing:analyze` skill reads it through [`skills/analyze/scripts/hook-health.ts`](skills/analyze/scripts/hook-health.ts), which summarizes volume, latency, and per-rule fire/suppress counts and raises fix opportunities. Once two consecutive health checks come back stable, flip the default off.

## Testing

```sh
bun test plugins/writing
```
