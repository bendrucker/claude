# Pull Request Body

What goes in a PR body. Used by the create and update skills.

The body covers what the diff can't: why the change exists, the decisions behind it, and how you know it works. The reviewer reads the code for what changed.

Write the body to stand alone. The reviewer sees only the diff and links that open for them: issues, PRs, permalinks. Don't reference your plan, your instructions, or the session ("as planned", "the issue specified", a `## Deviations From the Plan` heading). State each decision itself, not its difference from an instruction the reviewer never saw.

Use active voice, first person for your own decisions ("I chose X over Y because…"). Keep the prose plain. Technical terms are fine. Marketing flourishes (`source of truth`, `fail loudly`, `cleanly`) are not. Load the `writing` skill for the full trope list. Don't reuse this document's vocabulary in the body. A body that calls a detail subtle or notes what it left out is narrating its instructions.

## Audience

Set depth from the repo's owner and visibility, the same probe the create skill runs for reviewers. The rules below apply at every tier.

- **Personal** (a repo you own, public or private): no one else reads the body. One to three paragraphs: intent and the decisions worth re-examining. Skip background you already have.
- **Corporate** (a private or org-owned repo): coworkers skim it. Put the intent in the first sentence and keep supporting detail moderate.
- **Open source** (a public repo you don't own): maintainers scrutinize it. Spend the most here on decisions, rejected alternatives, and evidence.

## Intent

Intent is what the code can't say: why the change exists, the requirement it satisfies, the constraint that forced the design, the alternative you rejected. Narrating the code at a higher level (walking the new control flow, naming what each function now does) is still restating the diff. Cut any sentence the reviewer could reconstruct from the changed code. Quote or link the issue requirement instead of paraphrasing the code.

## Density

- One thread per paragraph. Split past three or four sentences.
- One idea per sentence. A sentence stacking clauses behind three or more commas is a list. Format it as one.
- Add headings once prose passes four or five paragraphs.
- Prose for connected reasoning, lists for parallel items (findings, cases covered, checks run). "Default to prose" bans the reflexive `## Changes` plus `## Testing` scaffold, not lists.

## Headings

A heading is two or three words in AP title case, usually a noun phrase. Put the explanation in the prose below the heading.

- Cut qualifying tails (`Structural audit sourced from the hook` → `Structural Audit`), parentheticals (`Context Tier (Soft Reminder Only)` → `Context Tier`), and colon-spliced status (`Not Yet Met: The Live Proof` → `Deferred Proof`).
- Drop context the parent heading already gives, nesting so the child stays bare: under `## Decisions`, `Why Not an N-Gram View in DuckDB` → `N-Gram View`.
- Name the topic, not the question: `What I Didn't Do` → `Deferred Work`. No `Why`/`What`/`How` headings. Put the why in the prose below or in a parent section (`## Decisions`, `## Alternatives`).
- Drop articles and trailing clauses from imperatives: `Hide the Inherited --format Flag` → `Hide Inherited --format Flag`.
- No `## Summary` heading outside a template. The first paragraph is the summary.

A heading carrying a comma, a colon, trailing punctuation, a linking verb, a relative clause, or a subject pronoun has become a sentence.

### AP Title Case

The PR-body hook re-cases every heading through `heading-case.ts` and denies the create or edit command when its result differs from what you wrote. Capitalize each word, except these when they fall between the first and last word: `a`, `an`, `and`, `as`, `at`, `but`, `by`, `for`, `in`, `nor`, `of`, `on`, `or`, `per`, `so`, `the`, `to`, `via`, `vs`, `vs.`, `yet`. Every other word stays capitalized, `up` included, since the checker leaves it off the list (`Speed Up the Commit Hook`).

- Lowercase a listed word in the middle: `Heading Case Via the Hook` → `Heading Case via the Hook`; `Reasons To Defer` → `Reasons to Defer`.
- A hyphenated compound capitalizes each element and applies the same list past the first: `Follow-up Tasks` → `Follow-Up Tasks`, while `Ready-to-Ship Checklist` keeps its lowercase `to`.
- Inline code spans, unbackticked CLI flags (`--body-file`), identifiers with an internal capital (`gitLab`), and unbackticked filenames or config names carrying a dot (`tmux.conf`) pass through as written.

## Session Content

The best material happened in the session but never reached the code. Review the conversation and pick the two or three items that would change how someone reviews the change, one or two sentences each. In rough order of value:

- A decision with a rejected alternative: what lost and why.
- Scope added or dropped.
- Test observations: the actual result or failure, with real output. Name what you couldn't test and the concrete blocker ("brew install failed locally", not "needs a real machine").
- A follow-up, named concretely ("follow-up in #N to…").

A disproved theory, a rejected workaround, or a name the user settled by hand gets one sentence, and only when it changes the review. Don't mention what you left out. When sub-agents did the work, pull the material from their returned summaries before it's lost.

### By Change Type

- Visual or GUI work: screenshots or a recording. Rejected layouts. Bugs found only by rendering it live.
- Backend or API work: an example request and response. What breaks without the fix. Performance numbers.
- Config, tooling, or prose: scope added or dropped, what you chose not to build, the evidence behind the design.

## Evidence

Show instead of asserting: permalink the exact lines instead of paraphrasing code, blockquote the spec you reason from, paste the real error or test output in a fence.

## Optional Sections

Only when the body is long enough to need them. A small PR stays one paragraph.

### Changes

Organize by concept, not by file. One bullet per conceptual change, even when it spans files. Never `**path**: description`. Name an identifier only when it adds what the diff doesn't. Don't pair a count with an enumeration (`all three X (a, b, c)`): enumerate or summarize. Skip cleanup that follows from the main change.

For a schema change, name the tables and columns touched, since file names rarely show them. Past roughly ten columns, summarize and name only the columns that involved a decision. When the schema is generated from a model that names the table, add only what that mapping doesn't show. Describe a hand-written, date-prefixed migration. Skip a regenerated schema file.

### Testing

Include only when a test or hand check tells the reviewer something the status checks won't. State what the test proves: the falsification ("reverting the fix makes `TestX` fail with `exit 2`"), the edge cases covered, what you verified by hand and what you couldn't.

- Nothing CI already posts: no green-check lists (`lint passes`, `193 pass, 0 fail`). Name a check only when CI doesn't show its result: an intentional exclusion (`ruff over the repo, generated tree excluded`), a pre-existing warning left in place.
- No test counts.
- Paste real output instead of claiming success.

### References

Links that aren't the motivating issue: `Closes #N` for what this resolves, `Relates to #N` for context. Every link must open for the reviewer. On a corporate or open-source repo, drop a private task-tracker URL or replace it with the artifact it points to. On a personal repo the owner is the reviewer, so an `Original Task:` Things link stays.

## Slop to Cut

Beyond what the sections above ban:

- The "This PR introduces" opening. Lead with the change or the problem.
- Count-padding ("six detectors, three and three").
- The consequence chain (`, so the…`) as a filler connective and the antithesis (`not just X but Y`, `X instead of Y`) as framing.
