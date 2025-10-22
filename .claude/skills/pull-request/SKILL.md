---
name: pull-request
description: |
  Formatting and content guidelines for GitHub pull requests and equivalents (GitLab: merge request, Gerrit: change request). MUST be used anytime you are creating or updating a pull request's body (description) and title.
---
# Pull Request Guidelines

Use these guidelines when creating pull requests (GitHub), merge requests (GitLab), or change requests (Gerrit):

### Title

- Use `$subject: $summary` format (e.g., `fix: add timeout to request`)
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

### Body

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
  - `## Testing`: Only include if tests were added/modified or if we discussed manual testing steps. Do not repeat obvious statements (❌ "existing tests pass" ❌) or meta-information (❌ "3 unit tests" ❌). Do include, where applicable:
    - High level summary of any tests added or modified.
    - Nw testing patterns or significant coverage changes.
    - Checklist of manual test steps as `###`.
  - `## References`: ONLY include if there are relevant links or related issues.
    - Bulleted list of links or related issues and code reviews
    - Use `Closes #<issue>` if the change closes an issue
