---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: user,review: treat a skill's fan-out as requested

The user reported that /ship's reviewer pass ran inline instead of fanning out to subagents, even though the ship skill's own instruction said to fan out.

## What changed and why

Traced the cause with grep -a against the installed 2.1.220 CLI binary: two lines, "Do not call the AgentTool unless the user requested it" and "Do not use workflows or deep-research unless the user requested it," are compiled directly into the binary and absent from settings.json, .claude.json, user/, and every hook in the repo, so nothing in this repo can disable them.

## Out of Scope (Deferred, Not Part of This PR)

A prose-quality hook flagged the first PR body draft for low sentence-length variation (CV=0.41 over 13 sentences); the refreshed body was rewritten to vary rhythm, mixing short fragments with longer explanatory sentences.
