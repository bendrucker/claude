/evals:design plugins/supply/agents/dep-reviewer.md

Design an eval suite for the `dep-reviewer` agent and write it to `plugins/supply/evals/dep-reviewer/`, for `claude plugin eval`.

The agent reviews dependency changes in a diff. Requests come as `bump` (an existing package changes version) and `added` (a new package enters the manifest). Tag each case with its kind.

Where it went wrong in review:

> user: review this diff
> diff: `+  "fastq": "^1.19.0"` in package.json, lockfile entry shows license `GPL-3.0`
> assistant: approve. A small queue library, widely used.
> user: GPL is not on our list. That is a block

> user: review this diff
> diff: `-  "zod": "^4.3.1"` `+  "zod": "^4.4.3"`, changelog excerpt lists "Remove deprecated `.strict()` alias"
> assistant: approve. Minor bump.
> user: the changelog removes an API. That's needs-info at least

> user: review this diff
> diff: only `package-lock.json` changes, 40 lines, no manifest change
> assistant: approve. Looks like routine lockfile churn.
> user: lockfile alone is needs-info, ask what changed the manifest

> user: review this diff
> diff: `-  "yaml": "2.7.0"` `+  "yaml": "2.7.1"`, no changelog in the diff
> assistant: approve. Patch bump.
> user: fine
