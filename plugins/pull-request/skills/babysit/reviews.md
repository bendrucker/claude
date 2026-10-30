# Reviews Hand-off

After the first green, invoke `pull-request:follow-up --auto <pr-url>` and let it own the AI-reviewer loop: it fixes, replies, resolves, calls back into babysit for each post-push CI wait, and waits for an expected bot review that has not posted yet.

When it returns satisfied, re-request the human reviewers whose approval a push invalidated. follow-up owns bot re-triggers.

- GitHub: `gh pr edit <pr-url> --add-reviewer <user>`.
- GitLab: delegate to `gitlab:merge-request` ([Re-request reviewers](../../../gitlab/skills/merge-request/SKILL.md#re-request-reviewers)).

Then continue to [Merge Mode](merge-mode.md) when `--merge` is set. Otherwise report what was addressed and `TaskStop`. Human review threads stay with the user.
