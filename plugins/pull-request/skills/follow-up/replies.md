# Reply Tone Guidelines

Replies are one to three sentences, concrete, and proportional to the comment. Lead with what changed, not "thanks for the feedback": "Good catch" or "Fixed" is enough, and reference the specific fix (a function name, a line, a commit) so the reviewer can verify without re-reading the diff. When pushing back, give code context or a concrete reason ("I kept this because X handles the edge case where Y"), not "I think this is fine." Short comments get short replies, detailed feedback a proportional response.

## Replying to AI Reviewers

When replying to a bot thread (auto or gated), write the reply as a note for any reader, not a message to the bot:

- **Don't name or address the reviewer.** No "@coderabbitai", no "thanks", no "good bot". The one place a bot is named is the `@<bot>` re-trigger, a top-level comment, not a thread reply.
- **State the resolution, not the dialogue.** "Guarded with a null check" or "Intentional: this path only runs after validation" reads correctly whether a human or a bot raised it.
- **For a false positive, give the one-line reason** before resolving, so the resolve isn't silent: "Not reachable here, the caller already validates `id`."
