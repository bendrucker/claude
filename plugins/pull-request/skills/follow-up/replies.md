# Reply Tone

Write one to three sentences, proportional to the comment. Lead with what changed ("Fixed", "Good catch") and cite the specific fix (a function, a line, a commit) so the reviewer can verify it without re-reading the diff. When pushing back, give the code context or concrete reason: "I kept this because X handles the edge case where Y."

## Replying to AI Reviewers

Write a bot-thread reply as a note for any reader, addressed to no one:

- State the resolution: "Guarded with a null check" or "Intentional: this path only runs after validation."
- For a false positive, give the one-line reason before resolving: "Not reachable here, the caller already validates `id`."
- Mention a bot only in the `@<bot>` re-trigger, which is a top-level comment.
