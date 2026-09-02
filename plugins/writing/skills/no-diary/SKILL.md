---
name: writing:no-diary
description: >-
  Cut process narration, past states, session leakage, and provenance from a
  deliverable (PR or MR body, code comment, doc, skill, review comment, issue,
  plan) so it states the result rather than how the work happened.
argument-hint: "[<file> | <pr> | <section> | <text>]"
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Bash
  - Agent
  - Skill
---

# No Diary

## Arguments

`$ARGUMENTS` is freeform. Resolve it to concrete text:

- A path, optionally with a line range, reads that file.
- A PR or MR number or URL reads the body through `gh` or `glab`, with the commands in `references/surfaces.md`.
- A section name or heading locates it in the artifact under discussion.
- A description with no target names the problem in the deliverable in play.

With no arguments, resolve the target in this order: text the user pasted this turn, the file this session last wrote or edited, then the PR for the current branch. Ask only when two candidates are equally live.

## Output

Where the rewrite goes depends on how the target resolved:

- **A file.** Edit it in place.
- **A PR or MR body.** Write the new body under `tmp/`, then apply it with the command in `references/surfaces.md`. Confirm first when the user did not name the PR.
- **Pasted text.** Return the rewrite in your reply. Nothing on disk changed, so do not go looking for a file to put it in.

Then report what you cut, grouped by the `Removals` headings, in a few lines.

## The Test

Every sentence must change what the reader does. A sentence explaining why a decision was right, what it replaced, or where it came from fails.

Prefer deleting whole sentences, since trimming words out of a diary sentence leaves a shorter diary. Cut within a sentence only for the cases in `Gotchas`.

Judge the text as a reader who was not in the session. For a whole artifact rather than a passage, dispatch a `general-purpose` agent that loads `writing:no-diary` and `writing:writing` and works from the artifact alone, plus its diff where one exists, with no session transcript.

## Removals

- **Change evolution.** The shapes the work passed through. Any sentence needing an earlier draft to parse, and sequencing words such as "originally", "initially", "then", "turned out", "along the way", "ended up".
- **Session leakage.** The conversation inside the artifact: feedback echoed as commentary, a reviewer's question answered in a code comment, the user's own phrasing quoted back.
- **Past states.** What the code or doc used to be, and how bad it was. Remove the thing rather than commenting on its removal.
- **Provenance and deliberation.** Where an idea came from, what it beat, why a rule is correct. Alternatives belong in the commit or the PR body.
- **Restatement.** Prose that re-describes the diff: file inventories, structural tours, a paragraph per function. Naming the function is enough.
- **Self-reference.** The artifact describing itself, its own sections, or harness behavior the harness already provides.

## Replacements

Most diary sentences sit where a useful sentence belongs. Put one of these there:

- The end state, stated plainly.
- What a reader cannot reconstruct from the diff: intent, the decisions behind it, what a change prevents.
- How, only when it is novel.
- Insight earned along the way, stated explicitly and briefly, never embedded in a change description.
- Evidence, such as a number proving an assumption held.

## Gotchas

- A prompt asking for what is non-obvious to a reviewer produces the literal heading "Things that wouldn't be obvious to a reviewer". Write what the instruction asked for, never the instruction.
- Verification results resemble narration. Keep the result and cut the framing: a row count proving a join assumption is a finding, and "I ran it and found" is not.
- Cutting a rationale can strand the rule it supported. Keep one clause when the reason is what lets a reader handle an unlisted case.
- Rewriting a user's own prose is out of scope. When the invocation frames the text as theirs ("my review comment", "my draft") or the artifact attributes it to them, cut the diary and leave the voice.

## Surfaces

[`references/surfaces.md`](references/surfaces.md) has rules per surface. Read the section for the surface you are editing.

## Voice

Load `writing:writing` before rewriting. It governs word choice and cadence.
