---
type: llm
---
The diff modifies an existing deploy skill. It adds one allowed-tools entry (`fly status`), renames the modes quick/careful to fast/verified, and adds the step that runs `fly status` and reports the running machine count. The skill, its `fly deploy` command, `--remote-only`, and the health check already existed.

Fail if the body claims something about the diff that contradicts this, such as that the PR adds or creates the deploy skill, or adds more than one allowed-tools entry. Only claims about what the diff changes count: attributions to people, plan references, and test-plan items are judged by other graders.
