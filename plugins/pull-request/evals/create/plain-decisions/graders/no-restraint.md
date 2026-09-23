---
type: llm
---
Judge only the PR title and body, not any note about the push failing. The body never talks about its own content: no "I left out", "omitted for brevity", "not covered here", or list of topics the body does not discuss.

Statements about the code are not restraint and pass: a file left in place, a flag removed, an alternative rejected, work not done in this change. Fail only on sentences whose subject is the PR description itself.
