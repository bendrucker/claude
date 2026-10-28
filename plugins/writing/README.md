# Writing

Writing style enforcement and slop detection for prose a person reads: PR descriptions, review comments, Slack messages, documentation. Catches AI-generated and human writing patterns that read as vague, promotional, or templated.

Documents a model executes belong to the [prompting](../prompting) plugin. [`.claude/rules/plugins.md`](../../.claude/rules/plugins.md) states the audience rule.

## Contents

- **Hooks**: one dispatcher that lints message prose before a call sends it and edited files after they are saved, and a background SessionStart hook that syncs the pinned Vale packages
- **Skills**: `writing:writing` system reminder for prose writing guidelines, `writing:analyze` hook health from the run log, `writing:rewrite` user-invoked text rewriter, `writing:scan` user-invoked trope detector (`audit` gates a directory, `score` measures one input's density), `writing:review` multi-agent document review, `writing:no-diary` cuts process narration out of a deliverable
- **Agents**: `content`, `style`, `artifacts` (conditional review lenses)

## Vale

[`.vale.ini`](.vale.ini) enables the [`ai-tells`](https://github.com/tbhb/vale-ai-tells) package and this plugin's own [`styles/Writing/`](styles/Writing/) rules, and sets each check's level: `error` denies a message, `warning` adds context, and `MinAlertLevel = warning` keeps `suggestion` out of every consumer. Each rule carries its `evidence:` and `retire when:` criteria in a header comment and its cases in a `tests` block, run with `vale test styles/Writing`. Project cases in [`tests/`](tests/) check what the config decides per file type and message, run with `vale --no-global --config=.vale.ini test tests/`.

## Hook Dispatcher

One entry script, [`hooks/lint.ts`](hooks/lint.ts), handles both hook events. On PreToolUse it lints the prose a Bash or MCP call sends: Bash body flags and files (`--body`, `--body-file`, `gh api -F body=@file`, `git commit -F`) and any MCP input that carries a prose sentence (`isProse` in [`hooks/messages.ts`](hooks/messages.ts)). An `error` alert denies the call. On PostToolUse it lints a Write, Edit, or MultiEdit's saved file with Vale and reports every alert in it as context. Vale scopes code files to their comments and skips files that match no `.vale.ini` section. Both events skip plan mode, plan and memory files, and scratch paths (`tmp/` directories, `$TMPDIR`, background job dirs), whose prose gets linted at the egress surface instead. A check already reported for the same file or message in the last five minutes is muted.

Context-tier findings are suppressed when the same Vale check already fired in the session within the last five minutes ([`hooks/session-state.ts`](hooks/session-state.ts)). Deny and ask tiers always fire.

#### Run Log

Every dispatcher run appends one JSONL line to `~/.claude/writing-hooks/log.jsonl` (rotated past 5 MB): timestamp, session, tool, extension, duration, outcome (`silent | context | ask | deny | skipped-scratch`), the reported check and whether it was suppressed, a hash of the file path, and every check that alerted. This is the evidence surface for auditing the hooks' cost and precision. `WRITING_HOOKS_LOG=0` disables it, and a path value redirects it. The `writing:analyze` skill reads it through [`skills/analyze/scripts/hook-health.ts`](skills/analyze/scripts/hook-health.ts), which summarizes outcomes, latency, and per check its fire count and how often its alerts were acted on.

## Testing

```sh
bun test plugins/writing
```
