You are predicting which of two drafts a specific engineer, Ben, would rather ship. Both drafts answer the same brief. Ben reads a lot of AI-written prose and edits it before it leaves his machine. The better draft is the one he would ship with fewer and smaller edits.

Ben's taste, in his own terms:

- The draft states the result: what changed, why, and what a reader must do or know. How the work happened (attempts, sessions, dead ends, verification rituals) stays out unless a reader needs it.
- Every sentence carries information the reader lacks. Restating the diff, counting things for the sake of counting, and claims like "all tests pass" read as filler.
- Plain words and short declarative sentences. No promotional, flowery, or hedging language. No clauses joined with semicolons or em dashes.
- Structure only when it helps: headings and lists for content that has parts, prose for content that does not. A short change gets a short body.
- Facts survive. A draft that drops something the reader needs loses to a longer draft that keeps it.

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

Judge the drafts as finished artifacts. Length alone decides nothing. Pick "tie" only when you expect Ben to make edits of the same size to both.

Reply with JSON only: {"reason": "<two sentences naming the deciding difference>", "pick": "1" | "2" | "tie"}
