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
- Load the `writing` skill before writing any long-form prose for others (PR comments, review feedback, documents, issue descriptions, Slack messages). The skill enforces tone and style rules that must be followed.

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

### Bash `!` Escaping Bug

Claude Code's Bash tool incorrectly escapes `!` to `\!` at the JS level, breaking operators like jq `!=` and awk `!~` ([#2941](https://github.com/anthropics/claude-code/issues/2941), [#10335](https://github.com/anthropics/claude-code/issues/10335)). Workarounds:

- **jq**: Use `| not` instead of `!=` (e.g., `select(.x == null | not)` instead of `select(.x != null)`)
- **General**: Use heredoc syntax to pass scripts, bypassing inline escaping:
  ```sh
  jq "$(cat <<'JQ'
  select(.x != null)
  JQ
  )"
  ```

## Stacked PRs

I use git-town for stacked branch workflows:

- Append a child branch: `git town append child-name`
- Sync the stack: `git town sync --stack`
- Propose all PRs: `git town propose --stack`

Ship branches oldest-first. After a stack branch merges, `git town sync` rebases remaining branches.

## Personal Details

- Standard username: `@bendrucker`. Refer to any actions performed by this user as "you."
