# Pull Request Body

What goes in a PR body. Used by the create and update skills.

A reviewer reads the body once, before the diff, to learn what problem the change solves and what it does about it. Write the body that answers those two questions and stop. The diff shows how the code does it.

The body is all the reviewer gets. The reviewer sees only the diff and links that open for them: issues, PRs, permalinks. Describe the change in the repo's own terms.

## Layout

The body is one paragraph of two to four sentences, in this order:

1. The motivation: the problem as the user saw it, in active voice with a concrete subject ("nightly backups to the replica failed for a week before anyone noticed"). State the harm or property plainly ("The log line omits the request path"), never a dramatized outcome. When a check or limit is involved, say what it protects ("to keep secrets out of build logs"). When no failure motivated the change, state the condition it improves ("Error codes were bare integers repeated across the handlers"). Open on this motivation, never on how the system works underneath.
1. What the change does, as "This fixes that by ...", "This adds ...", or "This replaces ...". When the old state explains itself, merge it into this sentence ("This replaces the hard-coded retry count with a config value") and skip the problem sentence.
1. When the change introduces a named piece, how that piece behaves, in one sentence. Describe it by its defining property ("rejects any key not on the list"), not its configuration.
1. When the session measured the failure at the scale where it happens, that one figure, in one sentence.

A change to existing behavior can open instead with two bullets, `Before:` and `After:`, one sentence each, stating the behavior and the assumption behind it.

After the paragraph, add at most two short sentences, each holding a fact a reviewer would get wrong without being told. Take them from this list, in order:

- Evidence that answers the reviewer's first question, led by its verdict ("The benchmark shows no regression.") and then the figure.
- The constraint behind a design choice (why a threshold, default, or limit is set where it is).
- The scope ("Only the CI profile sets the limit.").
- A dependency on another PR.

State it as a plain fact. Estimates, rejected alternatives, rollout steps, and removed tests never fill this line.

Add a `## Deferred` list only when the change leaves its own goal unfinished, such as a limit raised partway with the next step known. Follow-ups that build on a finished change, and loose ends found during the work, stay out of the body.

Aim for about 60 words.

## Selection

The session produces many true facts, and the body states the problem, the change, and the one fact a reviewer needs. A fact gets a sentence only when a reviewer would review the diff differently without it. When a secondary mechanism answers part of the stated problem, give it one sentence saying what it does.

These stay in the session, even when they were hard-won:

- Alternatives you rejected.
- The mechanism: file paths, type names, the type it introduces, what a helper takes, what the query counts, the README it updates.
- Verification: test runs, previews, benchmark output, and claims about what fails without the change or what stays byte-identical.
- Cleanup and side fixes in the same diff, including removed tests and sandbox or config fixes the change needed to run.
- Figures for spend, counts, and history, other than the one measurement in the paragraph.
- Follow-ups, bugs, and ideas outside this change's goal. They belong in an issue.
- Caveats and edge cases (empty inputs, name collisions, values aged from a default), threshold estimates, and assurances that change nothing for the reviewer.

## Completion

After drafting, run a cut pass before writing the file. Tag each sentence with the one slot it fills:

- `problem`: the motivation, from the paragraph's first step.
- `change`: what the change does.
- `behavior`: how a new piece behaves.
- `figure`: the one measurement at the failure's scale.
- `fact`: a sentence from the list after the paragraph, at most two.
- `deferred`: an item in the `## Deferred` list.
- `ref`: the closing issue reference.

Delete every sentence without a tag, and every sentence past a tag's limit. When a tagged sentence also states a second fact, cut the second fact. The body is done when every sentence carries a tag. Write the body without the tags.

## Sentences

- Use the shortest words that state the fact. Fold an elaboration clause into one adjective: "untyped config keys", not "config keys, with no type saying what each one holds".
- State scope and behavior directly ("Only the CI profile sets the limit."), without inverted conditionals ("leaving the flag off keeps the old path") or reassurance ("so nothing changes there").
- Open on the state this change fixes, never on a follow-up. A follow-up fits in one clause at the end.
- Join sentences with plain connectives.
- One fact per sentence. State an effect as its own sentence, not as a ", so ..." tail.
- Give a before/after timing as a percent change plus both raw values ("drops 30%, from 10:00 to 7:00").
- State the behavior the change produces. The hook, API, or field it uses is in the diff.

## Examples

Bodies written by hand for real changes, quoted verbatim:

> When a required provider is passed down to a module, the `terraform_unused_required_providers` rule still reports the provider as unused. This checks all provider configurations _explicitly_ passed into modules and counts those required providers as used.
>
> It remains a lint error to declare a required provider when it is _implicitly_ inherited by the child module, as that declaration is the child's responsibility.
>
> Closes #1189

> Fixes a regression, described in #1450. When evaluating an entry in `required_providers`, this adds a variable (dynamic value) with the provider's name, allowing the evaluation of `configuration_aliases`. This evaluation is looser than Terraform would perform, e.g., `configuration_aliases = [aws.foo.bar]` would presumably be considered valid. References to other providers should still fail.
>
> Closes #1450

## Headings

A heading is two or three words in AP title case, usually a noun phrase. Put the explanation in the prose below the heading.

- Cut qualifying tails (`Structural audit sourced from the hook` → `Structural Audit`), parentheticals (`Context Tier (Soft Reminder Only)` → `Context Tier`), and colon-spliced status (`Not Yet Met: The Live Proof` → `Deferred Proof`).
- Drop context the parent heading already gives, nesting so the child stays bare: under `## Decisions`, `Why Not an N-Gram View in DuckDB` → `N-Gram View`.
- Name the topic, not the question: `What I Didn't Do` → `Deferred`. No `Why`/`What`/`How` headings. Put the why in the prose below.
- Drop articles and trailing clauses from imperatives: `Hide the Inherited --format Flag` → `Hide Inherited --format Flag`.
- No `## Summary` heading outside a template. The first paragraph is the summary.

A heading carrying a comma, a colon, trailing punctuation, a linking verb, a relative clause, or a subject pronoun has become a sentence.

### AP Title Case

The PR-body hook re-cases every heading through `heading-case.ts`. For a body file already on disk, it rewrites the heading lines in place and reports the change. Carry those headings into any later edit. A body it cannot rewrite (a heredoc in the same command, or passed inline) is denied instead, as is a heading it cannot map word for word back to its source: one with a backslash escape, an HTML entity, or a word straddling markup (`fol**low**up`). Capitalize each word, except these when they fall between the first and last word: `a`, `an`, `and`, `as`, `at`, `but`, `by`, `for`, `in`, `nor`, `of`, `on`, `or`, `per`, `so`, `the`, `to`, `via`, `vs`, `vs.`, `yet`. Every other word stays capitalized, `up` included, since the checker leaves it off the list (`Speed Up the Commit Hook`).

- Lowercase a listed word in the middle: `Heading Case Via the Hook` → `Heading Case via the Hook`; `Reasons To Defer` → `Reasons to Defer`.
- A hyphenated compound capitalizes each element and applies the same list past the first: `Follow-up Tasks` → `Follow-Up Tasks`, while `Ready-to-Ship Checklist` keeps its lowercase `to`.
- Inline code spans, unbackticked CLI flags (`--body-file`), identifiers with an internal capital (`gitLab`), and unbackticked filenames or config names carrying a dot (`tmux.conf`) pass through as written.

