# Pull Request

Use these guidelines when creating GitHub pull requests:

### Title

- Use `$subject: $summary` format (e.g., `fix: add timeout to request`)
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

### Body

- Start with 1-3 sentences summarizing the change. Do not prefix this with any header, just go straight into the description.
- Use `##` sections for larger PRs. Include one or more of the following sections as appropriate. Sections can have multiple subsections if subgroups are present.

  - `## Issue`: Root cause analysis, link existing issues. Use this for bug fixes, which should include a related issue.
  - `## Changes`: High-level bulleted description of changes made.
    - Emphasize API and interface changes first.
      - Example: Adds `POST /users` endpoint to create users
      - Example: Updates `User.create` to accept `email` parameter.
      - Example: Handles `404` errors in `GET /users/{id}`.
    - Avoid listing files. Summarize the user impact of changes.
    - Include refactoring or cleanup changes as separate bullet points.
      - Example: Refactors `UserService` to use dependency injection.
      - Example: Extracts repeated user getter logic into `UserRepository`.
  - `## Testing`: Only include this section if there are notable strategic details. **Do not** over-narrate small details of tests such as number of tests or specific assertions.
    - Do include new testing patterns or significant coverage changes.
    - Do include a checklist of manual test steps as `<h3>` if applicable.
  - `## References`: Bulleted list of links or related issues/PRs, use `Closes #<issue>` if applicable
