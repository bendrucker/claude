---
name: pull-request
description: |
  Create a GitHub pull request (PR) with proper formatting and content guidelines. Use when creating or updating pull requests/PRs (or GitLab merge requests/MRs, Gerrit change requests/CRs).
allowed-tools: Bash(gh:*), mcp__github
---
# Pull Request

Use these guidelines when creating or updating pull requests (PRs), merge requests (MRs), or change requests (CRs):

## Title

- Check recent commits (`git log --oneline -20`) to determine the repo's commit style:
  - **subject** (default): `${subject}: ${summary}` where subject is optional (e.g., `api: add timeout to request` or `add timeout to request`)
  - **conventional**: `${type}: ${summary}` where type is required (e.g., `fix: add timeout to request`)
  - Use conventional style if most commits use conventional commit prefixes (feat:, fix:, etc.)
  - Otherwise, use subject-oriented format
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

## Body

- Use strategy in `context.md` to obtain context about the change if the conversation does not provide enough information.
- Start with 1-3 sentences summarizing the change. Go straight into the description, without a preceding header.
- Use `##` sections for larger changes. Include one or more of the following sections as appropriate. Sections can have multiple subsections if subgroups are present.

  - `## Issue`: Root cause analysis, link existing issues. Use this for bug fixes, which should include a related issue.
  - `## Changes`: High-level bulleted description of changes made.
    - Emphasize API and interface changes first.
      - Example: Adds `POST /users` endpoint to create users
      - Example: Updates `User.create` to accept `email` parameter.
      - Example: Handles `404` errors in `GET /users/{id}`.
    - Do not list modified files by path, line number, etc. Summarize the user impact of changes, do not narrate the code.
    - Include refactoring or cleanup changes as separate bullet points.
      - Example: Refactors `UserService` to use dependency injection.
      - Example: Extracts repeated user getter logic into `UserRepository`.
  - `## Testing`: Only include if tests were added/modified or if manual testing was performed. Omit this section entirely if no testing discussion occurred.
    - Focus on qualitative insights about test coverage and approach, not quantity or CI status.
    - Good examples:
      - ✓ "Tests cover error handling for malformed JSON responses"
      - ✓ "Added integration tests that verify the full request/response cycle"
      - ✓ "Extended existing auth tests to cover the new OAuth flow"
      - ✓ "Manually verified behavior with screen reader on iOS Safari"
    - Bad examples (avoid these):
      - ✗ "All tests passed" (CI status already shows this)
      - ✗ "Added 5 unit tests" (quantity is unimportant)
      - ✗ "Tests work correctly" (too vague)
    - Include manual testing steps as `###` checklist only if they were actually performed or discussed.
  - `## References`: ONLY include if there are relevant links or related issues.
    - Bulleted list of links or related issues and code reviews
    - Use `Closes #<issue>` if the change closes an issue

## Workflow

See [`workflow.md`](./workflow.md) for instructions on how to create a new pull request.
