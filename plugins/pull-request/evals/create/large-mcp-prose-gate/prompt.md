Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

The writing plugin's trope hook now runs on every MCP tool call and scans the input strings that read as prose. Adds an `isProse` shape test in `hooks/check-tropes.ts`, an `mcp__.*` matcher in `hooks.json` with a stdin grep guard, property tests, and detector fixes for punctuation false positives. 8 files changed, +280/-5.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The no-negation block only ran on Bash, so cloud sessions skipped it. They publish PR bodies with `mcp__github__create_pull_request` and thread replies with `mcp__hearthbot__post_message`, and the hook matched neither.
- Rejected a list of tools and fields to scan: it would go stale. Instead any string in any MCP input is scanned when it reads as prose.
- `isProse` accepts a string when one sentence, after code is stripped, has 4+ tokens, 80%+ plain words, and ends in `.`, `!`, `?`, or `:`. Queries, SQL, paths, IDs, and JSON fail it whatever field they sit in.
- The hooks.json guard greps stdin for three separators before spawning bun. It is a superset of `isProse`, and a property test enforces that. It passes 152 of 349 real MCP calls to bun.
- Matching calls get the Bash egress tier: structural denies block, the rest add context.
- Detector false positives fixed first: governors separated by punctuation ("RAM, no swap"), clause-opening conjunctions, and letterless leftovers from stripped code spans.
- Evidence: PRs with a hit under the current detector, local body-file 9/117 (8%), cloud GitHub MCP 41/130 (32%), local before the block 19/67 (28%).
- Prose detection: 100% of published PR bodies, 69/70 thread replies, 1.2% of Bash commands, 0% of Read/Grep/Glob/WebFetch inputs. On 313 hand-labeled MCP strings, precision 1.000, recall 0.948. Misses are log-dense messages and terse one-liners.
- Hegel found two bugs: a closer after the terminator and a colon before a code span. Both fixed. 50k-case stress runs pass.
- Left out: salutation deny would block emails over a mail MCP; `git commit -m` isn't scanned; a relative `--body-file` after `cd` passes silently (11 of 155 calls); `validate-body` in pull-request has the same cloud blind spot.
