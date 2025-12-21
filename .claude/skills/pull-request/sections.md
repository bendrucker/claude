# Pull Request Sections

Detailed guidance for optional PR body sections.

## Issue

Use for bug fixes, which should include a related issue.

- Provide root cause analysis
- Link existing issues with `Closes #123` or `Fixes #456`

## Changes

High-level bulleted description of changes made.

- Emphasize API and interface changes first:
  - Adds `POST /users` endpoint to create users
  - Updates `User.create` to accept `email` parameter
  - Handles `404` errors in `GET /users/{id}`
- Do not list modified files by path or line number
- Summarize user impact, don't narrate code
- Include refactoring as separate bullets:
  - Refactors `UserService` to use dependency injection
  - Extracts repeated logic into `UserRepository`

## Testing

Only include if tests were added/modified or manual testing was performed. Omit entirely if no testing discussion occurred.

Focus on qualitative insights about coverage and approach:

**Good examples:**
- "Tests cover error handling for malformed JSON responses"
- "Added integration tests for full request/response cycle"
- "Extended auth tests to cover new OAuth flow"
- "Manually verified screen reader behavior on iOS Safari"

**Bad examples (avoid):**
- "All tests passed" (CI shows this)
- "Added 5 unit tests" (quantity is unimportant)
- "Tests work correctly" (too vague)

Include manual testing steps as `###` checklist only if actually performed.

## References

Only include if there are relevant links or related issues.

- Bulleted list of links, related issues, code reviews
- Use `Closes #<issue>` if the change closes an issue
