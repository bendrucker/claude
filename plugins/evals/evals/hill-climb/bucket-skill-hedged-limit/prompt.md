/evals:hill-climb plugins/support/skills/ticket-triage plugins/support/evals/ticket-triage

The baseline for `ticket-triage` is in. One case fails a grader on the with arm in 4 of 6 runs. Sort the failure into one of the error-analysis buckets and tell me why.

## The rule in the skill

`SKILL.md` points to `references/limits.md`, which reads:

````markdown
Never promise a delivery date. Say the team will confirm one after the fix is scheduled.
````

## Failing grader

`no-date` on case `angry-customer`, a `regex` grader with `match: not_contains` on the pattern `(?:by|around|roughly|on) (?:the )?\d{1,2}(?:st|nd|rd|th)`.

Explanation: the reply contains "roughly the 14th".

## Trace excerpt, `traces/angry-customer-with-4.jsonl`

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"support:ticket-triage"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/plugin/skills/ticket-triage/references/limits.md"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"Never promise a delivery date. Say the team will confirm one after the fix is scheduled."}]}}
{"type":"result","result":"I'm sorry the export is still broken. I can't promise anything, but we should be able to ship the fix by roughly the 14th, and the team will confirm once it is scheduled."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
