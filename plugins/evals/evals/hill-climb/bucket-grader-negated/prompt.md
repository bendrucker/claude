/evals:hill-climb plugins/ops/skills/stall-diagnosis plugins/ops/evals/stall-diagnosis

The baseline for `stall-diagnosis` is in. One case fails a grader on the with arm in 3 of 6 runs. Sort the failure into one of the error-analysis buckets and tell me why.

## Failing grader

`no-invented-cache` on case `queue-stall`, a `regex` grader with `match: not_contains` on the pattern `\bcache\b`. The fixture has no cache, and the grader exists to catch a reply that blames one.

Explanation: the reply contains "cache".

## Trace excerpt, `traces/queue-stall-with-3.jsonl`

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"ops:stall-diagnosis"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/work/worker.log"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"12:01:07 lease renewed\n12:01:37 lease renewed\n12:02:07 lease expired, job 8841 requeued"}]}}
{"type":"result","result":"The stall is the lease: the worker renews every 30s, the lease expires at 60s under load, and the job is requeued. I ruled out a cache problem, since nothing in the log or the config mentions one."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
