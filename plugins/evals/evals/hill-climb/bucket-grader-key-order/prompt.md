/evals:hill-climb plugins/docs/skills/term-rename plugins/docs/evals/term-rename

The baseline for `term-rename` is in. One `dev` case fails a grader on both arms in every run, and its neighbors move when candidates touch the skill. Sort the failure into one of the error-analysis buckets and tell me why.

## Failing grader

`replaced-all` on case `rename-widget`, a `trace` grader with the pattern `"name":"Edit","input":\{"file_path":"[^"]*guide\.md","replace_all":true`.

Explanation: the pattern was not found in the trace.

## Trace excerpt, `traces/rename-widget-with-1.jsonl`

The prompt asked the session to rename "widget" to "panel" everywhere in `guide.md`, which has 11 occurrences.

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"docs:term-rename"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/work/guide.md"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"replace_all":true,"file_path":"/work/guide.md","old_string":"widget","new_string":"panel"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"The file /work/guide.md has been updated. All occurrences of 'widget' were replaced with 'panel'."}]}}
{"type":"result","result":"Renamed all 11 occurrences of widget to panel in guide.md."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
