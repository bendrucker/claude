# issue:refine rubric

A local harness for evaluating the `issue:refine` skill against real usage and
A/B testing changes to it. The aim is a rubric: a concrete list of what makes a
refined issue good or bad, derived from labeling real outputs, then used to
score the skill before and after edits.

The issue content here is internal work, so `raw/`, `data/`, and `feedback/`
stay local (see `.gitignore`). Only the harness code is tracked.

## Workflow

### 1. Build the dataset

Three exports in `raw/` come from the Claude Code session index (the
`claude-code:session` skill), pulled from every session that invoked
`issue:refine`:

- `save_issues.json`: every `Linear.save_issue` call (the refined bodies)
- `briefs.json`: the `issue:refine` skill args (the original brief, i.e. the input)
- `types.json`: which guide (`bug` / `feature` / `refactor`) the skill read per session

`build-dataset.ts` pairs each session's brief with its richest refined body,
drops near-duplicate issues, and selects a type- and size-balanced sample:

```bash
bun plugins/issue/evals/issue-refine/scripts/build-dataset.ts        # writes data/samples.json
bun plugins/issue/evals/issue-refine/scripts/build-dataset.ts --limit 24
```

To refresh `raw/` from the live session history, see the query in
[`scripts/build-dataset.ts`](scripts/build-dataset.ts) header and re-run the
`duckdb` exports against the session index.

### 2. Label

```bash
bun plugins/issue/evals/issue-refine/label/server.ts                 # http://localhost:4317
```

Open the URL and review each sample. Per issue you can:

- Select any span in the rendered issue to attach an inline comment with a
  severity (critical / minor / praise). Highlights persist across reloads.
- Set a verdict (good / ok / bad), toggle quality tags, and write freeform notes.

Everything autosaves to `feedback/<sample-id>.json`. The original brief (the
skill's input) sits in a collapsible block above each issue for context.

### 3. Derive the rubric

Once a batch is labeled, the inline comments and tags become the rubric: the
recurring critical spans and tags are the failure modes the skill should stop
producing, the praise spans are what to preserve. This feeds concrete edits to
`plugins/issue/skills/refine/`.

### 4. A/B test a skill change

The skill only refines text, so an A/B run takes a synthetic brief, runs it
through two skill versions, and compares the refined outputs against the rubric.
"Before" is the committed skill (`git show HEAD:...`), "after" is the working
tree, snapshotted into `ab/before/` and `ab/after/`.

Briefs live in `briefs/` as JSON (`brief` plus a synthetic `context`). Each one
is deliberately seeded with the tropes the rubric targets, so a version that
fixed them scores lower.

Each version writes a refined artifact: YAML frontmatter (title, type, and any
labels, priority, relations) followed by the body. The scorer reads the title
and type from the frontmatter and runs its findings over the body.

The run is driven from the session by spawning one agent per (brief, version):
`ab-prompt.ts` packages a skill version and a brief into a self-contained agent
prompt, the agent writes its refined artifact to `ab/out/<brief>.<version>.md`,
and then:

```bash
bun plugins/issue/evals/issue-refine/scripts/score.ts --input ab/out/<brief>.after.md   # one output
bun plugins/issue/evals/issue-refine/scripts/ab-report.ts                               # before vs after, all briefs
```

`ab-report.ts` is the mechanical score (rubric-as-code in `score.ts`). For the
judgment-call findings, `judge.ts` blinds the outputs (random slot order, mapping
withheld), prints a judge prompt, and a judge agent scores each against the
rubric. Unblind the verdict:

```bash
bun plugins/issue/evals/issue-refine/scripts/judge.ts                                   # writes blinded copies + prompt
# (a judge agent writes ab/verdict.json)
bun plugins/issue/evals/issue-refine/scripts/judge.ts --unblind ab/verdict.json         # de-blinded result
```

## Layout

- `scripts/build-dataset.ts`: assembles `data/samples.json` from `raw/`
- `label/server.ts`, `label/index.html`: the review UI (inline span comments, verdict, tags, notes)
- `scripts/frontmatter.ts`: parses an artifact into `{ title, type, body, data }`
- `scripts/score.ts`: the rubric-as-code; scores one refined artifact
- `scripts/ab-prompt.ts`: packages a skill version + brief into an agent prompt
- `scripts/ab-report.ts`: scores before vs after across briefs
- `scripts/judge.ts`: blinds outputs, prints a judge prompt, unblinds the verdict
- `briefs/`: synthetic A/B scenarios (tracked)
- `data/`, `feedback/`, `ab/`: generated or local-only (gitignored)
