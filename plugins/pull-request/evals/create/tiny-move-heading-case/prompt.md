Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Moves `heading-case.ts` and its test from the writing plugin's `hooks/` to `detection/`. The pull-request plugin's parity test path and its `.ci.json` path follow the move. 4 files changed, +4/-4.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- `detection/headings.ts` imports it and nothing in `hooks/` does.
- The `.ci.json` path keeps a writing-side edit selecting pull-request's CI.
