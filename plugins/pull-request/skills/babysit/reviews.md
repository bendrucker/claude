# Reviews Hand-off

Load this when babysit runs with `--reviews`. After the first green, invoke `pull-request:follow-up --auto <pr-url>` to triage AI-reviewer threads (fix, reply, resolve, loop until the reviewer is satisfied). follow-up calls back into babysit for each post-push CI wait, so let it own the review loop. When a bot review is expected but hasn't landed at green, follow-up waits for its first pass rather than reporting nothing to do.

When it returns satisfied, re-request the **human** reviewers whose approval a push (follow-up's fixes or babysit's own) invalidated. Don't re-request bots; follow-up owns the `@bot` re-trigger.

- **GitHub**: `gh pr edit <pr-url> --add-reviewer <user>`.
- **GitLab**: delegate to `gitlab:merge-request` ([Re-request reviewers](../../../gitlab/skills/merge-request/SKILL.md#re-request-reviewers)).

Then branch:

- If `--merge` is also set, proceed to [Merge Mode](merge-mode.md).
- Otherwise report what was addressed and call `TaskStop`.

This human re-request happens only in the `--reviews` flow. Review *threads* stay out of scope: follow-up lists them and leaves them for you.
