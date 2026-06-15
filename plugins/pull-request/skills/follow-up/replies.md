# Reply Tone Guidelines

## Acknowledge Directly

Start with what changed, not "thanks for the feedback." If the reviewer caught a real issue, say so plainly: "Good catch" or "Fixed" is enough.

## Explain What Changed

Reference the specific fix: a function name, a line, a commit. Avoid vague "I updated the code" replies. The reviewer should be able to verify without re-reading the diff.

## Disagree With Reasoning

When pushing back, provide code context or a concrete reason. "I kept this because X handles the edge case where Y" is better than "I think this is fine." Link to docs or prior discussion if relevant.

## Keep It Concise

One to three sentences. Don't pad replies with filler or restate the reviewer's comment. If the fix is self-evident from the diff, "Fixed" or "Done" is acceptable.

## Match the Reviewer's Detail Level

Short review comments get short replies. Detailed technical feedback gets a proportional response explaining your reasoning. Don't write a paragraph in response to a one-liner.

## Replying to AI Reviewers

When `--auto` replies to a bot thread, write the reply as a note for any reader, not a message to the bot:

- **Don't name or address the reviewer.** No "@coderabbitai", no "thanks", no "good bot". The one place a bot is named is the `@<bot>` re-trigger, a top-level comment, not a thread reply.
- **State the resolution, not the dialogue.** "Guarded with a null check" or "Intentional: this path only runs after validation" reads correctly whether a human or a bot raised it.
- **For a false positive, give the one-line reason** before resolving, so the resolve isn't silent: "Not reachable here, the caller already validates `id`."
