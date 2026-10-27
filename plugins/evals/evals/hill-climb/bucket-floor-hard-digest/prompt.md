/evals:hill-climb plugins/ops/skills/digest-check plugins/ops/evals/digest-check

The baseline for `digest-check` is in. One case fails a grader in nearly every run on both arms. Sort the failure into one of the error-analysis buckets and tell me why.

## Failing grader

`correct-digest` on case `verify-manifest`, a `regex` grader on the reply with the pattern `\b9f2c1d7e4b0a6385c1e9d02f7ab34c6\b`.

Explanation: the reply states a different MD5 digest.

## What the case provides

The prompt pastes a 600-byte manifest and asks for its MD5 digest. The session has `Skill` as its only tool, so it cannot run `md5sum`. The skill's instructions are followed correctly: the reply states the digest alone, in lowercase hex, on one line.

## Scaling run

The unchanged case run once with `--model` set a tier above the climb's model: 1/6 on the with arm and 0/6 on the without arm, each with a different wrong digest.

## Trace excerpt, `traces/verify-manifest-with-3.jsonl`

```jsonl
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"ops:digest-check"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"Launching skill: ops:digest-check"}]}}
{"type":"result","result":"3b7e0c5a91d4f68e2a7c1b09d5e83f40"}
```

End the reply with one line naming the bucket: `Bucket: skill`, `Bucket: grader`, `Bucket: reach`, or `Bucket: floor`.
