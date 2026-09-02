# Surfaces

The test in `SKILL.md` decides every case these rules do not name.

## PR and MR Bodies

Open on why the change exists. Give the decisions a reviewer cannot reconstruct from the diff, then stop.

- No numbered phases or steps.
- No test-pass reports or passing counts. Describe what the tests cover.
- No file inventories in a changes section. Name the function or the behavior.
- No sentence introducing a section before the section.
- A verification result belongs in the body when it is evidence. It stays out when it is the floor, as a passing-test tally is.
- Long detail goes in a collapsible section rather than the first screen.
- Say what a fix prevents, leaving out that you noticed it or that it was unrequested.

## Code Comments

A comment carries what the code cannot: an invariant, a constraint from outside the file, an observed production behavior.

- No comment on what the code used to do, or how bad it was. Delete the thing instead.
- No conversation. Session feedback, a reviewer's question, and a decision under debate all belong in the PR body or the commit.
- No issue IDs, ticket numbers, or customer names.
- No stating the obvious negative. "No monkey-patching here" tells a reader nothing.
- Test comments follow the same rules.

## Docs and Specs

A doc describes the system as it stands.

- No research provenance. What was read, benchmarked, or evaluated on the way to the design stays out, earning a footnote at most.
- No defending the design against objections nobody raised.
- A rejected alternative survives only as the constraint that ruled it out, stated in a clause. The evaluation that reached it goes.
- Point at the script rather than narrating mechanics it already enforces.
- Prefer the durable framing: what this is and what it is worth, independent of the change that introduced it.
- Say a temporary shim is temporary, including what removes it.

## Skill Prose

A line earns its place by changing what the model does when it reads the file.

- No sentence announcing what the section will say.
- Nothing `CLAUDE.md` or a single lookup already covers.
- Imperative for actions, declarative for definitions.
- Cut anything the model would perform identically without. Human readability is not the target.

## Review Comments

Plain technical English, from someone who understood the problem rather than someone answering a list.

- No counting. "Four minor issues" is not a finding.
- No line paths recited in prose. It reads as robotic.
- Show what was investigated and what came of it rather than mirroring the reviewer's comments back point by point.

## Issues

State the problem and what would resolve it. The reporter's monologue, the session that surfaced it, and the reasoning behind it stay out.

## Plans

A plan is a standalone execution document. It has to survive the chat being thrown away.

- No change log between revisions, and no "changed since last plan" block. The plan links to the transcript.
- No dialogue with the reviewer.
- Ruled-out approaches, when they matter, go in one alternatives section rather than threaded through as history.
