/evals:hill-climb plugins/vcs/skills/changelog-entry plugins/vcs/evals/changelog-entry

The baseline for `changelog-entry` is in. One `dev` case fails a grader on the with arm in 6 of 6 runs. Sort the failure into one of the error-analysis buckets and tell me why.

## Failing grader

`uses-template` on case `add-export-flag`, a `regex` grader on the reply with the pattern `^### Added\n- `.

Explanation: the reply does not start with a `### Added` heading and a bullet.

## Indicators

| case | `Skill` fired (indicator), with arm |
| --- | --- |
| `add-export-flag` | 0/6 |
| `fix-timeout` | 6/6 |
| `drop-legacy-api` | 5/6 |

## Trace excerpt, `traces/add-export-flag-with-2.jsonl`

The prompt was "I added an `--export` flag to the CLI. Write the changelog line for it."

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"export","path":"/work/src"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"src/cli.ts:41:  .option('--export <file>')"}]}}
{"type":"result","result":"Added a new `--export <file>` flag to the CLI that writes the results to a file."}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
