# review-voice

Ad-hoc harness for grounding the `review:peer` addressing rules in real review
comments. It mines comment bodies from the Claude Code session index, lets you
label each one good or bad in a browser, and reports the bad phrasings so they
can seed `tone.md` negative examples.

The problem it targets: on the work machine `review:peer` writes comments that
address the PR author by name in the third person, when the author should be
addressed as "you" or impersonally.

## Privacy

The mined bodies include imported work-repo content. `data/` and `labels/` are
gitignored and must never be committed to this public repo.

## Workflow

Build the session index first if it is stale (the session skill owns it):

```bash
bun plugins/claude-code/skills/session/scripts/refresh.ts
```

Then mine, label, and report:

```bash
bun evals/review-voice/scripts/mine.ts            # -> data/candidates.json
bun evals/review-voice/label/server.ts            # browse http://localhost:4318
bun evals/review-voice/scripts/report.ts          # summary + full text of bad cases
```

`mine.ts` reads Write tool calls that produced review payload files
(`tmp/review*.json`, `tmp/replies/*.md`), since GitLab MR bodies never land inline
in the `glab`/`draft-note` commands. It dedupes by body and drops fragments.
Flags: `--host work`, `--min-chars`, `--db`, `--out`.

In the labeler: `g` good, `b` bad, `s` skip, arrows to move, and a note field per
case. Verdicts persist to `labels/<id>.json` as you go.

`report.ts --show bad|good|skip|all` prints the full text of each labeled case
with its note.
