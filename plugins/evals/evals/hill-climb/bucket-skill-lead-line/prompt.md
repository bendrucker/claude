/evals:hill-climb plugins/vcs/skills/commit-summary plugins/vcs/evals/commit-summary

The baseline for `commit-summary` is in. One `dev` case fails a grader on the with arm in 5 of 6 runs. Sort the failure into one of the error-analysis buckets and tell me why.

## The rule in the skill

````markdown
## Format

Open with one line under 60 characters that names the change. Leave a blank line, then write the body.
````

## Failing grader

`one-line-lead` on case `rename-flag`, a `regex` grader on the reply with the pattern `^[^\n]{1,60}\n\n`.

Explanation: the reply's first line is 138 characters, so the pattern did not match.

## Trace excerpt, `traces/rename-flag-with-2.jsonl`

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"vcs:commit-summary"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"Launching skill: vcs:commit-summary"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git diff --staged"}}]}}
{"type":"result","result":"This commit renames the --force flag to --overwrite across the CLI, its help text, and the two scripts that call it, and updates the tests to match.\n\nThe old flag still parses and prints a deprecation notice."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
