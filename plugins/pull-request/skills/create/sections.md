# Pull Request Sections

Detailed guidance for optional PR body sections.

Stick to active voice. Don't use passive ("X was added"). Rewrite so something is doing the verb.

- Self-evident description of what the PR does: PR-as-subject is fine ("Adds retry logic") or subject-elided in bullets ("Added retry logic", "Extracted the helper")
- Design decisions and judgment calls: use "I" so it's clear you made the call ("I chose X over Y because…")

Keep the prose plain. Technical terms are fine. Marketing phrasing and model flourishes (`source of truth`, `fail loudly`, `escape hatch`, `cleanly`) are not. Load the `writing` skill for the full set of tropes to avoid.

## Issue

Use for bug fixes, which should include a related issue.

- Describe the root cause as the author ("I traced this to…", "I found that…"). Avoid passive writeups ("the bug was caused by…")
- Link existing issues with `Closes #123` or `Fixes #456`

## Changes

Organize by concept, not by file. Each bullet should describe a single conceptual shift, even when it spans multiple files. The reviewer reads this to understand *what's different and why*, not to get a tour of modified files.

- Lead with the conceptual change, not the file location. Subject-elided phrasing works for plain description ("Extracted the helper", "Replaced X with Y"); use "I" when a bullet explains a judgment call. Don't use passive ("X was added")
- Omit cleanup that follows naturally from the main change (e.g. removing dead imports). The diff shows this
- Never structure bullets as `**path**: description`
- Reference code identifiers only when they add information beyond what the diff shows. Use the shortest unambiguous name (module, filename, or component, not full paths)
- When referring to a set of things changed, write naturally: enumerate short lists inline (e.g. "hook command variants (command, model, prompt)"), use "all" or "each" for large sets. Never pair a count with the enumeration ("all three X (a, b, c)"). Either enumerate or summarize, not both

## Testing

Only include if tests were added/modified or manual testing was performed. Omit entirely if no testing discussion is relevant.

**NEVER mention test counts** - phrases like "Added N tests" or "13 unit tests" provide no value. The number of tests doesn't indicate coverage quality, and readers can count tests themselves if they care.

Focus on **what** is covered and **why** it matters:

**Good examples:**
- "Added tests covering error handling for malformed JSON responses"
- "Added integration tests for the full request/response cycle"
- "Extended the auth tests to cover the new OAuth flow"
- "Verified edge cases: empty input, null values, and Unicode handling"

**Coverage gaps**: Note anything that merited testing but was difficult to automate:
- "Left rate-limiting behavior for manual verification against the live API"
- "Verified visual layout changes in the browser but didn't add snapshot coverage"

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
