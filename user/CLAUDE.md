# Claude

## Style

- Prefer concise, direct responses.
- Minimize unnecessary explanations unless requested.
- Don't join independent clauses with semicolons or em dashes. End the clause with a period. Swapping one connector for another is not a fix. Semicolons only at rare, normal-English cadence.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- Use natural line breaks unless the surrounding code is wrapped at a specific column.
- Include a trailing newline in all new files.
- Prefer meaningful anchor text over raw URLs.
- Use bullet points for lists, checklists if I ask for tasks.
- Use code comments ONLY to clarify code that is not self-explanatory to OTHER readers. If you need to explain the code, do so in a separate message before editing.
- Load the `writing:writing` skill before writing any long-form prose for others (PR comments, review feedback, documents, issue descriptions, Slack messages). The skill enforces tone and style rules that must be followed.

## Organization

- Avoid creating or adding to catch-all packages/modules like `utils` or similar. Provide meaningful names for packages and keep them well-scoped, but not overly small.
- Break code into multiple files where appropriate first before splitting across directories.
- Do not number steps or phases in code (e.g., "Phase 1:", "Step 2:"). Use descriptive function names and call them in sequence. Numbering creates tight coupling, obscures whether order matters, and impedes inserting new steps.

## Curation

Every customization costs tokens on every session. Before adding one, define how it gets removed: what shows it's working, what shows it isn't, and where that signal surfaces.

Prefer accommodating Claude Code's native defaults over overriding them, since a changed default encodes usage and eval data you lack. Add a customization that fights one only as a light-touch experiment with evaluation and removal criteria.

## Workflow

- The user has carefully curated skills for their common workflows. Load skills when possible to adhere to the user's preferences and navigate their projects efficiently.
- A skill that instructs a subagent fan-out or a background dispatch already carries the user's authorization for `Agent`. Run the dispatch as the skill writes it, and degrade to an inline pass only when `Agent` is absent from the tool set, saying in the output that it ran inline.
- For questions about Claude Code features or usage, use the `Agent` tool with `subagent_type='claude-code-guide'` to consult official documentation.
- Prefer the `agent-browser` skill over `WebFetch`/`WebSearch` when a task needs a real browser — interacting with a page, screenshots, scraping JS-rendered content, or web-app QA/dogfooding. It loads the CLI's version-matched `skills get` workflows. Plain `WebFetch` stays fine for static page fetches.
- Finish a branch with `/ship`: it runs the warranted review passes, opens the PR, babysits CI to green, triages bot comments, and refreshes the body. Don't hand-chain `EnterWorktree` + `pull-request:create` for a branch finish.
- `pull-request:create` remains the skill for opening a PR directly (it is what `/ship` calls). If it's unavailable, create the PR with an empty body.
- Open PRs ready for review by default. Reserve `--draft` for speculative changes that need deep human review before merge. Draft status can suppress bot review.
- When executing build commands, output to `/dev/null` to avoid creating binaries.
- Store temporary files in `tmp/` directory.
- The sandbox can write `/tmp`, `$TMPDIR`, and the repo. Never disable the sandbox for file writes; only bypass after a sandboxed run of that command actually failed.
- Use `pbcopy` and `pbpaste` for clipboard interaction.

## Planning

Sessions default to auto mode, so investigating is cheap and plan mode is not needed to explore safely. Plan mode is where a settled approach gets written down. The research belongs before it.

- Investigate in auto mode until the approach is settled, then enter plan mode to transcribe it. A plan that takes many tool calls to write was entered too early.
- When I ask for a plan and something is still open, finish resolving it first and tell me what you are resolving. Do not enter plan mode and research from inside it.

## Check-ins

Schedule `⏰` plan check-ins in Things with `things:url add`, which unlike inbox capture can set `when=<yyyy-mm-dd>`. Tag them `claude-code`. Things is the only tracker that can raise work on a future date, so work-tracked check-ins go there too, linking their Linear issue in the notes.

Notes carry what to check, the plan path, the repo, and a launch URL:

```
claude-cli://open?q=<url-encoded prompt>&cwd=<absolute main repo path>
```

- `open` is the only action. Use `q` for the prompt and `cwd` for the working directory. Both are ordinary percent-encoded query params. The handler base64-encodes them itself when it builds the session's argv.
- The URL prefills a new session's prompt without submitting it, and cannot resume the original session.
- Point `cwd` at the main repo, never a worktree. Worktrees get pruned.

## Git

- Never `git push` to the default branch (usually `main` or `master`) unless I explicitly instruct you.
- Always work on a topic branch with a short hyphenated name.
- For commit messages, use multiple `-m` flags for a simple subject and body. Each `-m` is a separate paragraph. For complex messages, pass the message through a heredoc.

## Worktrees

I use Worktrunk (the `wt` CLI) for git worktrees, exposed through two skills:

- For creating or entering a worktree, use the `worktrunk:wt-switch-create` skill. It re-roots the session into a new worktree (optionally in another repo), runs an optional task, and acts as a targeted command for the common case. Prefer it over the generic skill whenever the task is worktree creation, including anywhere you would otherwise delegate worktree creation to Worktrunk. This preference holds even when a background-job or harness context suggests the generic `EnterWorktree` tool for isolation.
- For everything else (pruning, listing, removing, running hooks, editing config, and general `wt` questions), use the generic `worktrunk:worktrunk` skill.
- Disposable verification worktrees may be created with `git worktree add tmp/<name>`; everything persistent goes through the worktrunk skills.

## Stacked PRs

I work in stacks routinely, in one of two layouts, chosen per stack. Load `github:stack` before any `gh stack` command. `gitlab:merge-request` is the GitLab equivalent.

- A worktree per branch (see Worktrees above) suits layers I work on in parallel or over a long stretch. `wt sync` rebases each branch onto its parent in dependency order: `--fetch` to pull the base first, `--push` to update remotes, `--prune` to remove integrated worktrees, `--dry-run` to preview the plan. Publish with `gh stack link`, after `wt sync --push`, because `link` pushes without force.
- One worktree holding the whole stack suits a stack I'm actively reshaping, where reordering and folding layers matters more than working two layers at once. `gh stack` owns it end to end, and `gh stack sync` covers what `wt sync` and `gh stack link` do together in the other layout.

Don't mix the two within one stack. The local-tracking commands silently do nothing to a branch checked out in another worktree. `gh stack merge` merges either layout. Pull the surviving layers afterward, since GitHub rebases everything left open above the merge.

## Personal Details

- Standard username: `@bendrucker`. Refer to any actions performed by this user as "you."
