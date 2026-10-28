# Writing

Writing style enforcement and slop detection for prose a person reads: PR descriptions, review comments, Slack messages, documentation. Catches AI-generated and human writing patterns that read as vague, promotional, or templated.

Documents a model executes belong to the [prompting](../prompting) plugin. [`.claude/rules/plugins.md`](../../.claude/rules/plugins.md) states the audience rule.

## Contents

- **Hooks**: a PreToolUse dispatcher that lints introduced prose and code comments with Vale, and a background SessionStart hook that syncs the pinned Vale packages
- **Skills**: `writing:writing` system reminder for prose writing guidelines, `writing:analyze` hook health from the run log, `writing:rewrite` user-invoked text rewriter, `writing:scan` user-invoked trope detector (`audit` gates a directory, `score` measures one input's density), `writing:review` multi-agent document review, `writing:no-diary` cuts process narration out of a deliverable
- **Agents**: `content`, `style`, `artifacts` (conditional review lenses)

## Vale

[`.vale.ini`](.vale.ini) enables the [`ai-tells`](https://github.com/tbhb/vale-ai-tells) package and this plugin's own [`styles/Writing/`](styles/Writing/) rules, and sets each check's level: `error` denies a message, `warning` adds context, `suggestion` stays out of the hook. Each rule carries its `evidence:` and `retire when:` criteria in a header comment and its cases in a `tests` block, run with `vale test styles/Writing`. Project cases in [`tests/`](tests/) check what the config decides per file type and message, run with `vale --no-global --config=.vale.ini test tests/`.

## Hook Dispatcher

A single PreToolUse entry script, [`hooks/pretooluse.ts`](hooks/pretooluse.ts), reads stdin once and lints the text a call introduces with Vale. It emits at most one output per tool call, at the highest level any alert reached. Shared skips apply once up front: plan mode, plan and memory paths, and scratch paths (`tmp/` directories, `$TMPDIR`, background job dirs), where prose is internal handoff text that gets scanned later at the egress surface instead of at write time: Bash (`--body-file`, `--body`, `gh api -F body=@file`) and any MCP call whose input carries a prose sentence, whatever the server or field (`isProse` in [`hooks/check-tropes.ts`](hooks/check-tropes.ts)), which in a cloud session covers PR bodies and thread replies.

Context-tier findings are suppressed when the same Vale check already fired in the session within the last five minutes ([`hooks/session-state.ts`](hooks/session-state.ts)). Deny and ask tiers always fire.

#### Run Log

Every dispatcher run appends one JSONL line to `~/.claude/writing-hooks/log.jsonl` (rotated past 5 MB): timestamp, session, tool, extension, duration, outcome (`silent | context | ask | deny | skipped-scratch`), the reported check and whether it was suppressed, a hash of the file path, and every check that alerted. This is the evidence surface for auditing the hooks' cost and precision. `WRITING_HOOKS_LOG=0` disables it, and a path value redirects it. The `writing:analyze` skill reads it through [`skills/analyze/scripts/hook-health.ts`](skills/analyze/scripts/hook-health.ts), which summarizes volume, latency, per-check fire/suppress counts, and how often each rule was acted on, then raises fix opportunities. Once two consecutive health checks come back stable, flip the default off.

## Testing

```sh
bun test plugins/writing
```
