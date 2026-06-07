# High-stakes classifier

Recognize when Claude is about to take an action that warrants an approval gate even though it could proceed.

#### Context

Spec: [Classification](../blocking-dispatch.md#classification), High-stakes action. This is the second blocking trigger alongside stuck.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

Define the gated action set and how Claude recognizes a member of it before acting:

- Gated: deploys and releases, external sends (email, Slack, public posts), money and payment actions, destructive deletion of cloud resources, infrastructure, or data (dropping a table or database, tearing down a resource), force-push and history rewrite, production database migrations.
- Never gated: deleting local or remote git branches and cleaning up worktrees. These run without confirmation.

#### Out of scope

The gate interaction (own task). The stuck trigger, which comes from the task graph.

#### Approach

Express the gated set as recognizable action signatures, not a vague category, so the classifier fires reliably and does not over-trigger. Pin down the boundary cases that matter here: a destructive cloud or data delete is gated, a git branch or worktree delete is not, even though both are deletions. Keep the list in one place the gate reads.

#### Acceptance criteria

- [ ] Each gated action class has a concrete recognition rule.
- [ ] Git branch and worktree cleanup pass through ungated.
- [ ] A cloud, infra, or data destruction is gated.

#### References

- [blocking-dispatch.md, classification](../blocking-dispatch.md#classification)
