# Research

Gather context before reviewing:

- [ ] Identify the participants. The reviewing user is in the skill's Context block. Fetch the author with `gh pr view <N> --json author --jq .author.login` (GitHub) or `glab mr view <N> --output json | jq -r .author.username` (GitLab). Record one line to work from ("Author: @alice, reviewing as @bob"), and see [tone.md](tone.md) for how to address each party. When the author is you (author matches the reviewing user), note that so comments still read naturally.
- [ ] Read the project's CLAUDE.md to understand conventions, coding standards, and project-specific guidelines
- [ ] Read any upstream issues linked in the PR body, including their comments, via the platform API. The issue is where the change originates, so it carries the causal context: the problem being solved, constraints discussed, and alternatives ruled out. Use that intent to judge whether the diff actually addresses the problem
- [ ] If URLs are referenced, fetch with `WebFetch`
- [ ] If insufficient context about motivation or implementation, ask me for additional information
