# Research

Gather context before reviewing:

- [ ] Read the project's CLAUDE.md to understand conventions, coding standards, and project-specific guidelines
- [ ] Read any upstream issues linked in the PR body, including their comments, via the platform API. The issue is where the change originates, so it carries the causal context: the problem being solved, constraints discussed, and alternatives ruled out. Use that intent to judge whether the diff actually addresses the problem
- [ ] If URLs are referenced, fetch with `WebFetch`
- [ ] If insufficient context about motivation or implementation, ask me for additional information
