# Pull Request Body

What goes in the body, and what to leave out. The create and update skills both use this.

The body conveys what the diff cannot. The reviewer reads the code for what changed. Use the body for why it changed, the decisions you made, and how you know it works. If a sentence only restates what the diff shows, cut it.

Write in active voice and first person for your own calls. "I chose X over Y because…", "I traced this to…". Don't write passively ("X was added", "the bug was caused by…"). Keep the prose plain. Technical terms are fine. Marketing and model flourishes (`source of truth`, `fail loudly`, `escape hatch`, `cleanly`, `wires up`) are not. Load the `writing` skill for the full set of tropes.

## Shape

Default to prose, not a scaffold.

- Open with what changed (a bare verb: "Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when the change needs justifying. Don't restate the title. Don't open with "This PR introduces".
- Length tracks substance, not diff size. A subtle one-line fix may need paragraphs of root-cause reasoning. A large mechanical change may need two sentences.
- Use `##` sections only when the body is long enough to need them. A small PR is a tight paragraph with no headers.

## Headings

A heading names the section's topic. It is not a sentence about the topic. Write a Title-Cased noun phrase, usually two or three words, and let the prose below carry the explanation.

- Cut the qualifying tail: `Structural audit sourced from the hook` → `Structural Audit`. The clause explaining the head noun goes in the first sentence under it.
- Drop parentheticals: `Context Tier (Soft Reminder Only)` → `Context Tier`. A parenthetical holding a clause or a file path is the body trying to live in the heading.
- Let the parent frame the leaf: under `## Tiers`, `Deny Tier` → `Deny`; under `## Decisions`, `Why Not an N-Gram View in DuckDB` → `N-Gram View`. Nest so the child heading stays bare.
- Keep the question out of the heading. The "why" is the prose, or the parent section (`## Decisions`, `## Alternatives`), not a `Why`/`What`/`How` heading.
- Name the topic, not the meta-move: `What Changed` → `Changes`; `What I Didn't Do` → `Deferred Work`; `What I Didn't Change` → `Unchanged Behavior`.
- Keep imperatives tight: `Hide the Inherited `--format` Flag` → `Hide Inherited `--format` Flag`. Drop the article, lose the trailing clause.
- Use Title Case: `Two fixes found while testing the tmux calls` → `Two Fixes`.

A heading has slipped into a sentence when it carries a comma, a trailing period or question mark, a linking verb (`is`, `are`, `exits`), a relative clause (`that`, `which`), or a subject pronoun (`this`, `it`).

## Mine the Conversation

The most valuable content is the substance that lived in the session but never reached the code. Review the conversation that produced the change and surface what applies. This belongs in the PR body, not in code comments where Claude tends to leak it.

- Decisions and the alternatives you rejected. Name what you chose against and why you didn't take it.
- Deviations from the issue or plan. Where the implementation departed from what was specified, and the scope you added or dropped (an extra `allowed-tools` entry, files touched beyond the plan, a feature cut).
- Overturned theories. A root cause you diagnosed then disproved, an approach you built then abandoned. The diff shows the destination. The reviewer benefits from the wrong turn you already ruled out.
- What you observed testing locally. The actual result, surprise, or failure mode, not just "verified". Benchmark or cost numbers. What you couldn't test and the concrete reason ("brew install failed locally", not "needs a real machine").
- Limitations you ruled out. A workaround you considered and rejected as too fragile, a feature deferred as structural. This explains non-changes a reviewer might otherwise question.
- Naming or interface settled by hand. A name the user chose during the work, surfaced as the decision it was rather than presented as obvious.
- Deferred follow-ups, named concretely ("follow-up in #N to…"), not a vague TODO.

Not every PR has all of these. Include only what a reviewer would act on. True but inert detail is padding. Aim for the substance that changes how someone reviews or uses the change. When the work ran through sub-agents, the substance is in their returned summaries. Pull it forward before it gets smoothed away.

### By Change Type

- Visual or GUI work: screenshots or a recording of the result. Rejected layouts. Bugs only live rendering surfaced.
- Backend or API work: an example request and response. The mechanism proof for a fix (what breaks without it). Performance numbers.
- Config, tooling, or prose: scope deviations, what you deliberately did not build, and the evidence that grounds the design.

## Ground Claims in Evidence

Prefer showing to asserting. Link a permalink to the exact lines instead of paraphrasing code. Blockquote the doc or spec you reason from. Paste the real error, stack trace, or test output in a fence rather than describing it. "Reverting the fix makes `TestX` fail with `exit 2`" beats "added a test for the fix".

## Optional Sections

Use these only when the body is long enough to earn them. A small PR stays a paragraph.

### Changes

Organize by concept, not by file. Each bullet is one conceptual shift, even when it spans files. Never write `**path**: description`. Reference an identifier only when it adds something the diff doesn't. Don't pair a count with an enumeration ("all three X (a, b, c)"). Enumerate or summarize, not both. Omit cleanup that follows from the main change (dead imports). The diff shows it.

### Testing

Only if you added tests or tested by hand. State what the test proves, not that it exists. The falsification ("reverting the fix makes `TestX` fail"), the edge cases covered, what you verified manually and what you couldn't. Never test counts ("added 5 tests"). They measure nothing. Never "all tests pass". CI shows that. Paste real output over claiming success.

### References

Related links, issues, or reviews that aren't the motivating issue. Use `Closes #N` for what this resolves and `Relates to #N` for context, keeping the two distinct.

## Slop to Cut

- The reflexive `## Changes` plus `## Testing` scaffold on every PR. Small PRs don't need it.
- Sentence or fragment headings. A heading names the topic, it doesn't narrate it.
- Bullets that narrate which file changed. If a bullet only says what the diff shows, delete it.
- Test counts, "all tests pass", coverage inventories.
- Count-padding ("six detectors, three and three"). The number is rarely the point.
- The consequence chain (`, so the…`) used as a filler connective, and the antithesis (`not just X but Y`, `X instead of Y`) used as framing. Both read as tics when habitual.
