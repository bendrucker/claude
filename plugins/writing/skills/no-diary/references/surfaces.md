# Surfaces

The test in `SKILL.md` decides every case these rules do not name.

## PR and MR Bodies

Open on why the change exists. Give the decisions a reviewer cannot reconstruct from the diff, then stop.

Read the body with `gh pr view <n> --json body -q .body` or `glab mr view <n> --output json | jq -r .description`. Apply the rewrite with `gh pr edit <n> --body-file` or `glab mr update <n> --description-file`.

- Write prose and bullets rather than numbered phases or steps.
- Describe what the tests cover. A verification result belongs in the body only when it is evidence.
- Start each section on its content.
- Put long detail in a collapsible section rather than the first screen.
- Say what a fix prevents, leaving out that you noticed it or that it was unrequested.

## Code Comments

A comment carries what the code cannot: an invariant, a constraint from outside the file, an observed production behavior.

- Move session feedback, a reviewer's question, and a decision under debate to the PR body or the commit.
- Cut issue IDs, ticket numbers, and customer names.
- Cut the obvious negative. "No monkey-patching here" tells a reader nothing.
- Test comments follow the same rules.

## Docs and Specs

A doc describes the system as it stands.

- Cut research provenance: what was read, benchmarked, or evaluated on the way to the design earns a footnote at most.
- Answer only objections a reader would raise.
- A rejected alternative survives only as the constraint that ruled it out, stated in a clause.
- Point at the script rather than narrating mechanics it already enforces.
- Prefer the durable framing: what this is and what it is worth, independent of the change that introduced it.
- Say a temporary shim is temporary, including what removes it.

## Skill Prose

A line earns its place by changing what the model does when it reads the file. Cut what `CLAUDE.md` or a single lookup already covers.

## Review Comments

Plain technical English, from someone who understood the problem rather than someone answering a list. Show what was investigated and what came of it rather than mirroring the reviewer's comments back point by point.

## Issues

State the problem and what would resolve it. The reporter's monologue, the session that surfaced it, and the reasoning behind it stay out.

## Plans

A plan is a standalone execution document that survives the chat being thrown away.

- Present the current plan only, linking to the transcript for its history.
- Address the executor, not the reviewer.
- Ruled-out approaches, when they matter, go in one alternatives section.
