# Pull Request Body

What goes in the body, and what to leave out. The create and update skills both use this.

The body conveys what the diff cannot. The reviewer reads the code for what changed. Use the body for why it changed, the decisions you made, and how you know it works.

Write the body to stand on its own. The reviewer has the diff and the linked issue and nothing else: not your plan, not the issue you were handed, not the session that produced the change. Every reference must point to something they can open: a linked issue, a PR, a permalink. A phrase like "the plan", "as originally planned", "per the plan", or "the issue specified" (or a `## Deviations From the Plan` heading) points at an artifact they can't see, so it lands as a dead end. State the decision itself instead of the gap between it and an instruction only you saw.

Write in active voice and first person for your own calls. "I chose X over Y because…", "I traced this to…". Don't write passively ("X was added", "the bug was caused by…"). Keep the prose plain. Technical terms are fine. Marketing and model flourishes (`source of truth`, `fail loudly`, `escape hatch`, `cleanly`, `wires up`) are not. Load the `writing` skill for the full set of tropes to avoid.

Never quote this document's own vocabulary in the body. Instruction words describe what to select. They are not phrasing to reuse. A body that says a detail is subtle, or names its own restraint about what it left out, is narrating its instructions instead of the change.

## Audience

How much a body earns depends on who reads it. Read the tier from the repo's owner and visibility, the same probe the create skill runs for reviewers.

- **Personal** (a repo you own, public or private): you review it through Claude, and no one else reads the body. Budget one to three paragraphs. State the intent and the decisions a reviewer should re-examine, and skip background you already carry. Go past three paragraphs only when the change carries that much real substance, and spend the extra length on decisions and their evidence.
- **Corporate** (a private or org-owned repo): coworkers skim it. Lead with intent so the skim lands, and keep supporting detail moderate.
- **Open source** (a public repo you don't own): external maintainers scrutinize it, and unclear intent has the widest blast radius. Spend the most here on decisions, alternatives ruled out, and evidence.

The tier scales depth and length. It does not license a wall of text: the shape and density rules below hold at every tier.

## Intent

Restating the diff has a subtle form that passes for substance: narrating the code at a higher altitude. A paragraph that walks the new control flow, names what each function now does, or describes how the pieces fit is still a retelling of the diff. A careful reviewer reconstructs all of it by reading the change.

Intent is what the code cannot state about itself: why the change exists, the requirement it satisfies, the constraint that forced this shape, the alternative it beat. Test each sentence. If a reader could reconstruct it by reading the changed code, it is narration, so cut it or replace it with the reason behind it. Quote or point to the issue requirement the change satisfies rather than paraphrasing what the code now does.

## Density

The most common defect in real bodies is not the wrong content, it is the right content packed too tightly.

- One thread per paragraph. A paragraph that runs past three or four sentences is doing too much. Split it.
- One idea per sentence. A sentence that stacks clauses behind three or more commas is a list wearing prose clothing. It reads as a wall even when every clause is true.
- Past four or five paragraphs, unsectioned prose gets hard to scan. Give it headings.
- Prose carries reasoning that connects one point to the next. A list carries items that merely co-occur: findings, cases a test covers, checks run, files touched for one reason. When the content is a set of parallel items, make it a list. "Default to prose" bans the reflexive `## Changes` plus `## Testing` scaffold, not lists: compressing an enumeration into a run-on sentence is the same mistake from the other direction.

## Headings

A heading names the section's topic. It is not a sentence about the topic. Write a Title-Cased noun phrase, usually two or three words, and let the prose below carry the explanation.

- Cut the clause riding the head noun, whether a qualifying tail (`Structural audit sourced from the hook` → `Structural Audit`), a parenthetical (`Context Tier (Soft Reminder Only)` → `Context Tier`), or a colon-spliced status (`Not Yet Met: The Live Proof` → `Deferred Proof`). The explanation goes in the first sentence under the heading.
- Let the parent frame the leaf: under `## Tiers`, `Deny Tier` → `Deny`; under `## Decisions`, `Why Not an N-Gram View in DuckDB` → `N-Gram View`. Nest so the child heading stays bare.
- Name the topic, not the question or the meta-move: `What Changed` → `Changes`; `What I Didn't Do` → `Deferred Work`; `What I Didn't Change` → `Unchanged Behavior`. The "why" is the prose, or the parent section (`## Decisions`, `## Alternatives`), never a `Why`/`What`/`How` heading.
- Keep imperatives tight: `Hide the Inherited `--format` Flag` → `Hide Inherited `--format` Flag`. Drop the article, lose the trailing clause.
- Don't open with a `## Summary` heading when you aren't following a template. The first paragraph is the summary already.

A heading has slipped into a sentence when it carries a comma, a colon, a trailing period or question mark, a linking verb (`is`, `are`, `exits`), a relative clause (`that`, `which`), or a subject pronoun (`this`, `it`).

## Mine the Conversation

The best content is substance that lived in the session but never reached the code. Review the conversation and pick the two or three items, across every category in this section, that would change how someone reviews the change. State each in one or two sentences, as a self-contained decision: what you did and why, never a delta against a plan or instruction the reader never saw. Write "I added a `Bash(git push:*)` entry because the workflow pushes the branch," not "I added an entry beyond what the plan listed."

Draw from, in rough order of value:

- A decision with a rejected alternative. Name what you chose against and the reason it lost.
- Scope you added or dropped along the way.
- What you observed testing: the actual result, surprise, or failure mode, with the real numbers or output when they exist. Name what you could not test and the concrete blocker ("brew install failed locally", not "needs a real machine").
- A follow-up, named concretely ("follow-up in #N to…"), not a vague TODO.

A theory you disproved on the way gets one sentence, and only when it changes how someone reviews the change. A workaround you rejected as fragile, or a name the user settled by hand, earns its sentence by the same test. Everything else is padding. An item that would not change the review does not go in, and the body never mentions the items it left out.

When the work ran through sub-agents, the substance is in their returned summaries. Pull it forward before it gets smoothed away.

### By Change Type

- Visual or GUI work: screenshots or a recording of the result. Rejected layouts. Bugs only live rendering surfaced.
- Backend or API work: an example request and response. The mechanism proof for a fix (what breaks without it). Performance numbers.
- Config, tooling, or prose: the scope you added or dropped, what you chose not to build, and the evidence that grounds the design.

## Ground Claims in Evidence

Prefer showing to asserting. Link a permalink to the exact lines instead of paraphrasing code. Blockquote the doc or spec you reason from. Paste the real error, stack trace, or test output in a fence rather than describing it. "Reverting the fix makes `TestX` fail with `exit 2`" beats "added a test for the fix".

## Optional Sections

Use these only when the body is long enough to earn them. A small PR stays a paragraph.

### Changes

Organize by concept, not by file. Each bullet is one conceptual shift, even when it spans files. Never write `**path**: description`. Reference an identifier only when it adds something the diff doesn't. Don't pair a count with an enumeration ("all three X (a, b, c)"). Enumerate or summarize, not both. Omit cleanup that follows from the main change (dead imports). The diff shows it.

For a schema change, name the tables and columns touched, because a file name rarely reveals them. Two limits keep this from becoming a diff transcript. Past roughly ten columns, naming each one is rote, so summarize the change and name only the columns that carry a decision. And when the schema is generated from a model whose name maps to the table, the changed model already tells the reviewer which table moved, so add only what that mapping doesn't. Describe a hand-written, date-prefixed migration. Skip a regenerated schema file.

### Testing

Include this only when a test or a hand check tells the reviewer something the status checks won't. State what the test proves, not that it exists: the falsification ("reverting the fix makes `TestX` fail"), the edge cases covered, what you verified by hand and what you couldn't.

- Say nothing CI will post. A roll-call of green checks (`lint passes`, `types clean`, `build` green, `193 pass, 0 fail`, `0 errors, 0 warnings`) restates the status checks the reviewer already sees on the PR. Name a check only when its result is not one CI carries: a check CI doesn't run, an intentional exclusion (`ruff over the repo, generated tree excluded`), or a pre-existing warning you're leaving in place.
- Never test counts ("added 5 tests", "1165 assertions"). They measure nothing.
- Paste real output over claiming success.

### References

Related links, issues, or reviews that aren't the motivating issue. Use `Closes #N` for what this resolves and `Relates to #N` for context, keeping the two distinct. Every link must resolve for the reviewer. On a corporate or open-source repo, a private task-tracker URL (a Things link, an internal note) is a dead end. Drop it or replace it with the openable artifact it points to. On a personal repo the reviewer is the owner, so an `Original Task:` Things link resolves for exactly the person reading it and stays.

## Slop to Cut

Beyond what the sections above already ban:

- The "This PR introduces" opening. Lead with the change or the problem.
- Count-padding ("six detectors, three and three"). The number is rarely the point.
- The consequence chain (`, so the…`) used as a filler connective, and the antithesis (`not just X but Y`, `X instead of Y`) used as framing. Both read as tics when habitual.
