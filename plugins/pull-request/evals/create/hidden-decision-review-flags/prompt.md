Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Adds a `review <file>` subcommand to the prose-lab skill's CLI: it snapshots the file into the gitignored lab data, opens it in Plannotator, and records each inline comment as a flag with no pattern. Adds `annotations()` and `locate()` helpers with tests. 11 files changed, +468/-24.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- Goal: let the lab take flags on any document, such as a PR body from another repo or a draft in `tmp/`. Group assigns the pattern later.
- Plannotator's `annotate --json` output omits the annotations, so `annotations()` reads them from Plannotator's feedback index instead.
- The quotes in the index are rendered text, with backticks and link URLs stripped, so `locate` maps them back to raw offsets through an mdast parse.
- A quote that appears twice in the document is left unlocated and printed for Group, rather than guessing which copy was meant. Plannotator's `blockId` could settle it later.
- Dogfooded: I reviewed an earlier draft of the PR body through the command, and each inline comment and deletion became a flag on the marked span once `locate` matched the curly apostrophes Plannotator renders.
