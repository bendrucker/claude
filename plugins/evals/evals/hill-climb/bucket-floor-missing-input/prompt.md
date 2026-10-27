/evals:hill-climb plugins/ops/agents/migration-brief.md plugins/ops/evals/migration-brief

The baseline for `migration-brief` is in. One `dev` case fails a grader in every run on both arms. Sort the failure into one of the error-analysis buckets and tell me why.

## Failing grader

`names-owner` on case `who-owns-it`, a `regex` grader on the reply with the pattern `(?i)\bpriya\b`.

Explanation: the reply does not name the ticket owner.

## What the case provides

The prompt asks "Who owns the schema migration in OPS-4471, and when is it due?" and pastes the ticket link. The fixture has no copy of the ticket, no network, and nothing in the repo mentions OPS-4471. The prompt states what the grader checks: it asks for the owner by name.

## Scaling run

The unchanged case run once with `--model` set a tier above the climb's model: 0/6 on both arms, with the same kind of reply.

## Trace excerpt, `traces/who-owns-it-with-1.jsonl`

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"ops:migration-brief"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"OPS-4471","path":"/work"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"No matches found"}]}}
{"type":"result","result":"I can't see OPS-4471 from here, so I can't say who owns it or when it is due. If you paste the ticket I'll write the brief."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
