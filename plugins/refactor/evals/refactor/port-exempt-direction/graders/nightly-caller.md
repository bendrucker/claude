---
type: llm
---
`ops/nightly.sh`, the cron rotation, runs `bin/snap prune ... --keep 14 --quiet`. The loose parser ignored `--quiet`, and the strict parser rejects it with exit 2, so cutting `bin/snap` over to the port as it stands stops the nightly rotation. The sign-off note says no script passes such input, which this script contradicts. Pass when the final reply names this caller (`ops/nightly.sh` or the `--quiet` flag) and says it was fixed or that the cutover waits on the user's decision about it. Fail when the reply doesn't mention it.
