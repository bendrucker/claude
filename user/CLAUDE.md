# Claude

## Style

- Prefer concise, direct responses.
- Minimize unnecessary explanations unless requested.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- Use natural line breaks unless the surrounding code is wrapped at a specific column.
- Include a trailing newline in all new files.
- Prefer meaningful anchor text over raw URLs.
- Use bullet points for lists, checklists if I ask for tasks.
- Use code comments ONLY to clarify code that is not self-explanatory to OTHER readers. If you need to explain the code, do so in a separate message before editing.

## Organization

- Avoid creating or adding to catch-all packages/modules like `utils` or similar. Provide meaningful names for packages and keep them well-scoped, but not overly small.
- Break code into multiple files where appropriate first before splitting across directories.
- Do not number steps or phases in code (e.g., "Phase 1:", "Step 2:"). Use descriptive function names and call them in sequence. Numbering creates tight coupling, obscures whether order matters, and impedes inserting new steps.

## Workflow

- The user has carefully curated skills for their common workflows. Load skills when possible to adhere to the user's preferences and navigate their projects efficiently.
- For questions about Claude Code features or usage, use the Task tool with `subagent_type='claude-code-guide'` to consult official documentation.
- Always use the `pull-request:create` skill to create pull requests. If the skill is unavailable, create the PR with an empty body.
- When executing build commands, output to `/dev/null` to avoid creating binaries.
- Store temporary files in `tmp/` directory.
- Use `pbcopy` and `pbpaste` for clipboard interaction.

## Stacked PRs

I use git-town for stacked branch workflows combined with worktrunk:

1. Create base branch: `wt switch --create feature/base`
2. Work, commit, then append: `git town append child-name`
3. Create worktree for child: `wt switch child-name`
4. Sync entire stack: `git town sync --stack`
5. Propose all PRs: `git town propose --stack`

Ship branches oldest-first. After a stack branch merges, `git town sync` rebases remaining branches.

## Worktree Dispatch

Task tool subagents can't write to worktree directories — the sandbox scopes `.` to the orchestrator's cwd, not the worktree path. Two approaches depending on context:

- **Parallel work**: Dispatch `claude -p` CLI subprocesses with the worktree as cwd. Run as background Bash commands and poll with `TaskOutput`.
- **Single task**: Ask the user to start a new Claude session in the worktree directory.

Best practices for `claude -p` dispatch:

- **`--allowedTools` is mandatory.** Non-interactive `claude -p` cannot prompt for permissions — missing tools fail silently with no useful output. Over-permissioning is better than under-permissioning since the orchestrator has already validated the task scope.
- Common tool sets to include:
  - File ops: `Read`, `Edit`, `Write`, `Glob`, `Grep` (always include — subprocesses need to explore)
  - Git: `Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`
  - File mgmt: `Bash(rm:*)`, `Bash(rmdir:*)`, `Bash(mv:*)`, `Bash(mkdir:*)`, `Bash(ls:*)`, `Bash(chmod:*)`
- Never use `--dangerously-skip-permissions`.
- Do not pass `--model` — let the user's default apply.
- Use `--verbose` for implementation tasks where you want to monitor progress. Reserve plain `-p` (no verbose) for programmatic use where you'll parse the output (e.g., `--output-format json`).
- Run via `Bash(run_in_background: true)` for parallelism.
- Check exit codes and output. Report errors rather than retrying blindly.
- Avoid heredocs in Bash calls that dispatch `claude -p` — the sandbox blocks temp file creation. Write prompts to `/tmp/claude/` first, then pipe: `cat /tmp/claude/prompt.md | claude -p ...`

## Personal Details

- Standard username: `@bendrucker`. Refer to any actions performed by this user as "you."
