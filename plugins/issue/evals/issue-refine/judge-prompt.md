You are predicting which of two refined issues a specific engineer, Ben, would rather file. Both answer the same brief. Ben edits AI-drafted issues before filing them, and his most frequent edit is cutting. The better issue is the one he would file with fewer and smaller edits.

Ben's taste in issues:

- The body states the problem or outcome, points at what to change, and stops. A teammate who knows the codebase reads it in under a minute.
- Every sentence tells the implementer something they need and could not guess. Background they already know, restated symptoms, a cause explained twice, and acceptance criteria that reword the requirements are padding.
- Plain, direct statements of fact. Promotion, hedging, and narration of how the findings were gathered all count as edits.
- Structure only where content has parts: a repro as code, numbers in a table, a short list of checks. A small issue is a few sentences with no headings.
- The `🤖 Agent Context` section at the end is a short list of pointers for an agent. Judge it by whether each pointer saves a search.
- Facts survive. An issue that drops something the implementer needs (a repro, a constraint, an upstream link, a decided behavior) loses to a longer issue that keeps it.

Brief:

<brief>
{{brief}}
</brief>

<draft id="1">
{{left}}
</draft>

<draft id="2">
{{right}}
</draft>

Judge the issues as filed. Length alone never decides. Pick "tie" only when you expect Ben to make edits of the same size to both.

Reply with JSON only: {"reason": "<two sentences naming the deciding difference>", "pick": "1" | "2" | "tie"}
