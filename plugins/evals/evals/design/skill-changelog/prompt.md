/evals:design plugins/notes/skills/changelog-entry

Build an eval suite for the `changelog-entry` skill and write it to `plugins/notes/evals/changelog-entry/`, for `claude plugin eval`.

The skill turns a described change into one `CHANGELOG.md` line. Its requests come in two kinds: `fix` (a bug fix) and `breaking` (a change that breaks callers). Tag each case with its kind.

I corrected it three times last week, which is why I want this. Here are the turns, trimmed:

> user: add a changelog line for the retry fix
> assistant: `- Fixed a bug where uploads were retried forever (#412)`
> user: no. Imperative, no "Fixed a bug where", no PR number

> user: changelog entry, we renamed `--out` to `--output`
> assistant: `- Rename the --out flag to --output` under `### Fixed`
> user: that breaks scripts, it starts with BREAKING: and goes under Changed

> user: note for the timeout change, it now defaults to 30s instead of 10s
> assistant: `- Increase the default timeout to 30 seconds` under `### Fixed`
> user: it's not a fix, it's a behavior change. Changed, and say what a user sees

The skill already holds these rules. What I don't have is a way to tell whether an edit to it makes them stick.
