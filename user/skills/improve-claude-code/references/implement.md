# Implement

The mechanics behind [Implement](../SKILL.md#implement): the pipeline Workflow shape, stage contracts, and PR body format.

Feed the approved plans into a second Workflow shaped as `pipeline(approvedPlans, implement, ciGate)`:

- `implement`: an `agent` with `agentType: 'general-purpose'` and `isolation: "worktree"` implements the plan, runs `bun test`, runs `review:code <effort>` at the approved level, commits, and opens the PR via `pull-request:create` with the [PR body](#pr-body) backlink. Returns `{ thingsId, prUrl, branch }`.
- `ciGate`: a fast initial CI check with one trivial-failure fix pass. Returns `{ thingsId, prUrl, ciStatus }`.

Do not hold worktree agents open on long CI waits: the gate catches trivial breakage, then Watch handles the rest.

The Workflow tool delivers `args` as a JSON string, so normalize it before use (the `parallel` plan workflow takes no args). The pipeline shape and each stage's result schema (`meta` must be a pure literal):

```javascript
export const meta = {
  name: 'improve-cc-implement',
  description: 'Implement each approved plan as a PR, then fast-gate CI',
  phases: [{ title: 'Implement' }, { title: 'CI gate' }],
}

const { approved } = typeof args === 'string' ? JSON.parse(args) : args

const IMPLEMENTED = {
  type: 'object',
  required: ['thingsId', 'prUrl', 'branch'],
  properties: {
    thingsId: { type: 'string' },
    prUrl: { type: 'string' },
    branch: { type: 'string' },
  },
}

const CI_GATE = {
  type: 'object',
  required: ['thingsId', 'prUrl', 'ciStatus'],
  properties: {
    thingsId: { type: 'string' },
    prUrl: { type: 'string' },
    ciStatus: { type: 'string' },
  },
}

const results = await pipeline(
  approved,
  (plan) =>
    agent(implementPrompt(plan), {
      agentType: 'general-purpose',
      isolation: 'worktree',
      phase: 'Implement',
      schema: IMPLEMENTED,
    }),
  (built, plan) =>
    agent(ciGatePrompt(built), {
      label: `ci:${plan.thingsId}`,
      phase: 'CI gate',
      schema: CI_GATE,
    }),
)
```

## PR body

Include an `Original Task` link so the PR traces back to the Things todo:

```
Original Task: [<todo-title>](https://things.bendrucker.me/show?id=<todo-id>)
```
