mkdir -p tmp
cat > tmp/issue-webhook-replay.md <<'MD'
---
title: Webhook replays after a deploy deliver each event twice
type: bug
labels: [webhooks, Bug]
priority: urgent
relations:
  duplicate-of:
    - https://linear.app/acme/issue/ENG-330
  blocks:
    - https://linear.app/acme/issue/ENG-42
---

After every deploy, the delivery worker replays its in-flight batch from the start, so subscribers receive each event in that batch twice. [Duplicate webhook deliveries after deploy](https://linear.app/acme/issue/ENG-330) tracks the symptom. This issue records the cause, and [the delivery dashboard](https://linear.app/acme/issue/ENG-42) can't ship accurate counts until it's fixed.

## Acceptance Criteria

- [ ] A deploy during a batch delivers each event once
- [ ] The worker checkpoints after each delivered event, not per batch
- [ ] A test kills the worker mid-batch and asserts single delivery

## 🤖 Agent Context

- `DeliveryWorker.run` in `webhooks/worker.go` checkpoints only after the whole batch
- `SIGTERM` handling in `cmd/worker/main.go` exits without flushing the checkpoint
MD
