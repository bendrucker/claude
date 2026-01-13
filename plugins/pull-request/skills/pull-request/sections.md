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

Only include if tests were added/modified or manual testing was performed. Omit entirely if no testing discussion is relevant.

**NEVER mention test counts** - phrases like "Added N tests" or "13 unit tests" provide no value. The number of tests doesn't indicate coverage quality, and readers can count tests themselves if they care.

Focus on **what** is covered and **why** it matters:

**Good examples:**
- "Tests cover error handling for malformed JSON responses"
- "Added integration tests for the full request/response cycle"
- "Extended auth tests to cover the new OAuth flow"
- "Verified edge cases: empty input, null values, and Unicode handling"

**Coverage gaps**: Note anything that merited testing but was difficult to automate:
- "Rate limiting behavior requires manual verification against live API"
- "Visual layout changes verified in browser but not covered by snapshot tests"

**Manual verification**: Include any testing done outside of automated tests—running commands, checking output, verifying behavior in a browser or tool. This counts whether performed by the user or by Claude during the session.

**Patterns to avoid:**
- "Added N tests" or "N unit tests" (counts are noise)
- "All tests passed" (CI shows this)
- "Tests work correctly" (too vague)
- Listing test file names without explaining coverage

## References

Only include if there are relevant links or related issues.

- Bulleted list of links, related issues, code reviews
- Use `Closes #<issue>` if the change closes an issue
