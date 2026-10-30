Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

`comments:audit` passes its judge workflow's script text to the Workflow tool through `script` in place of `scriptPath`, and the workflow script drops its rationale comments. 3 files changed, +4/-16.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- `comments:audit` and its eval gate broke: the Workflow tool now loads a `scriptPath` only from the session's working directories, and the plugin script lives outside them.
- The script's comments go because every run copies the whole script into the tool call.
- A one-shard audit ran end to end: the inline workflow wrote verdicts and `apply --report` read them back.
- No tests or docs changed.
