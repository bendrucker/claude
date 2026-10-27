/evals:hill-climb plugins/docs/skills/runbook-outline plugins/docs/evals/runbook-outline

The baseline for `runbook-outline` is in. One case fails a grader on the with arm in 5 of 6 runs while its sibling cases pass. Sort the failure into one of the error-analysis buckets and tell me why.

## The skill's description

````yaml
description: Outline an operations runbook. Use when asked to write or restructure a runbook.
````

## Failing grader

`has-rollback-section` on case `deploy-notes`, a `regex` grader on the reply with the pattern `(?m)^#+ Rollback$`.

Explanation: the reply has no `Rollback` heading.

## Trace excerpt, `traces/deploy-notes-with-5.jsonl`

The prompt was "Turn these deploy notes into something the on-call can follow at 3am." The sibling cases ask for a "runbook" by name and show `Skill` firing 6/6.

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/work/deploy-notes.txt"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"1. drain the pool\n2. push the build\n3. warm the cache\n4. undrain"}]}}
{"type":"result","result":"## Steps\n\n1. Drain the pool.\n2. Push the build.\n3. Warm the cache.\n4. Undrain the pool."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
