# `pull-request:create` Rubric

A local harness for evaluating the PR bodies that `pull-request:create`
produces, following the structure of [`evals/issue-refine`](../issue-refine).
The aim is the same: label real outputs, derive a rubric from the labels, then
score the skill before and after edits so changes to
`plugins/pull-request/skills/create/` are gated on output quality instead of
lint alone.

This scaffold delivers the mining script and the labeling UI. The rubric,
scorer, and judge come after a labeling session, since the rubric is derived
from the labels.

## Privacy

The session index includes an imported `work` host marked block-egress, and
work PR bodies live on private hosts anyway. `scripts/mine.ts` hardcodes
`host = 'local'` and `repository LIKE 'bendrucker/%'` in its SQL, so only
public personal PRs are ever mined. Keep those filters if you touch the query.
`data/` and `feedback/` are gitignored regardless.

## Workflow

### 1. Mine

Build the session index first if it is stale (the session skill owns it):

```bash
bun plugins/claude-code/skills/session/scripts/refresh.ts
```

Then mine PR bodies:

```bash
bun evals/pr-body/scripts/mine.ts                      # writes data/samples.json
bun evals/pr-body/scripts/mine.ts --limit 80
```

`mine.ts` enumerates PRs opened from local sessions via the index's `pr_links`
table, fetches their bodies with `gh pr list`, drops empty bodies, and selects
a repo-balanced sample that interleaves long sectioned bodies with tight
one-paragraph ones. Each item records repo, PR number, URL, date, state, and
the originating session id.

### 2. Label

```bash
bun evals/pr-body/label/server.ts                      # http://localhost:4319
```

Open the URL and review each body. Per PR you can:

- Select any span in the rendered body to attach an inline comment with a
  severity (critical / minor / praise). Highlights persist across reloads.
- Set a verdict (good / ok / bad), toggle quality tags, and write freeform notes.

Everything autosaves to `feedback/<id>.json`. The header links to the PR on
GitHub so the diff is one click away while judging the body.

The UI is copied from `evals/issue-refine/label/` and adapted. Copying is the
current convention across `evals/`; extracting a shared harness package is a
known deferred refactor.

### 3. Derive the rubric (after labeling)

Once a batch is labeled, the recurring critical spans and tags become
`RUBRIC.md`: the failure modes the skill should stop producing and the traits
to preserve. That feeds concrete edits to `plugins/pull-request/skills/create/`
and a mechanical `score.ts` (rubric-as-code), mirroring issue-refine.

### 4. A/B test a skill change (after the rubric)

The skill's `--dry-run` flag already produces a body without creating anything,
which is the natural hook: run synthetic change scenarios through the committed
skill (`git show HEAD:...`) and the working tree, then compare with an
`ab-report.ts` mechanical score plus a blinded `judge.ts` for the
judgment-call findings, as issue-refine does.

## Status

- Done: `scripts/mine.ts`, `label/` UI, this loop definition.
- Next (owner): run the miner and the labeler, label ~50 items.
- After labeling: `RUBRIC.md`, `score.ts`, `judge.ts`, `ab-report.ts`, and a
  gate on `pull-request:create` edits.

## Layout

- `scripts/mine.ts`: builds `data/samples.json` from `pr_links` + `gh pr list`
- `label/server.ts`, `label/index.html`: the review UI (inline span comments, verdict, tags, notes)
- `data/`, `feedback/`: generated or local-only (gitignored)
