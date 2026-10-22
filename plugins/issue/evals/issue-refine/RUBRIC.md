# Rubric

What separates a good refined issue from a bad one, derived from labeling a batch
of real `issue:refine` outputs. Each item names the rule, the evidence behind it,
and the skill text that produces the violation. This drives both the skill edits
and the suite's graders.

The cases that scored "good" with no marks share a shape: name the problem,
point at the code, stop. The marked cases were longer and more structured, and
that extra length and structure is what the reviewer cut.

## Findings

### 1. Title-Case Noun-Phrase Section Headings

No sentence headings, no marketing phrasing, no "X, not Y" antithesis. Title-case
every section heading. This covers the `##`/`###` headings; the issue title
follows sentence case instead (finding 6).

- Evidence: sample-01 flagged `Workspace, not cache` and `Pin, don't invalidate`
  (both the antithesis trope and sentence case), sample-04 flagged
  `Fix, preferred: Glue layer, no producer or data change`.
- Skill location: nothing in `SKILL.md` or the guides constrains heading form.
  The guide section names are already noun phrases, but free-form subsections
  drift into sentences and slogans.
- Note: this is the same rule already enforced for PR headings.

### 2. Native Links for Issue and PR References

Use the tracker's embedded link syntax so references expand into issue chips.
A bare `ENG-1970`, `MR !578`, or `#123` is noise: a reader cannot resolve it.
A related issue belongs in the tracker's native relations, so the refined issue
never carries a standalone "Related Issues" section. Mention another issue in
prose only when it adds what the relation can't.

- Evidence: sample-01 flagged `ENG-1970, MR !578` inline and the whole
  `Related Issues` URL dump as critical.
- Skill location: `SKILL.md` Output Structure no longer lists a Related Issues
  subsection, and the Context note plus the Style rule route related issues to
  native relations and govern link syntax for the prose mentions that remain.

### 3. No Volatile Line Numbers

Bare line ranges (`file.py:26-56`, `#L26-L56`) go stale as the file changes and
rarely help. Cite the symbol or function name, or quote the relevant code inline.
Use a SHA-pinned permalink only when a stable anchor is genuinely needed.

- Evidence: sample-02 flagged a `file:26-56` citation as unproductive.
- Skill location: `SKILL.md` Style currently instructs the opposite:
  "Use permalinks for GitHub ... and file paths elsewhere (`path/to/file:10-20`)".
  This rule reverses that default.

### 4. Plain Words Over Jargon and Marketing

Plain words over jargon and promotional language. Flagged terms: `spike` (as a
verb), `seam`, `disposition`, `reality`.

- Evidence: sample-01 (`Spike`, `seam`), sample-02 (`reality`, `disposition`).
- Skill location: `SKILL.md` Style says "State facts, not hedging" but does not
  load the writing tropes or name jargon. The writing scan already catches some
  of these.

### 5. Structure Sized to the Problem

The longer, more sectioned issues drew "too-long" consistently. State the goal
and the acceptance criteria. Drop thin option menus that list approaches without
evaluating them.

- Evidence: sample-03 and sample-04 tagged `too-long`; sample-08 flagged an
  `Approach options` list as "vague options not described well ... just state the
  goal and acceptance criteria".
- Skill location: `feature.md` (`#### Approach`, `#### Open Questions`) and
  `refactor.md` (`Approach`) invite option enumeration. Section Selection in
  `SKILL.md` already warns against filler sections but not against weak options.

### 6. Sentence-Case, Concise Titles

The issue title is sentence case: only the first word and proper nouns
capitalize. Section headings stay title case (finding 1), so the two look
different on purpose. Keep the title to one line, no wordy parentheticals.

- Evidence: sample-02 and sample-11 tagged `bad-title`; sample-02's title carried
  a long parenthetical. The sentence-case rule comes from reviewing the first
  generated label batch, where every title came back in title case
  ("404 Page Missing Top Nav Bar" should read "404 page missing top nav bar").
- Skill location: `SKILL.md` Output Structure puts the title in the artifact's
  `title` frontmatter field and requires sentence case there, distinct from the
  title-case body headings. The title graders read that field.

### 7. Spike Type

A spike (timeboxed investigation, output is a recommendation not a shipped change)
was typed as a bug and read wrong.

- Evidence: sample-01 tagged `wrong-type`, note "should be labeled Spike".
- Skill location: `SKILL.md` Issue Types lists Spike, with its guide in `spike.md`.
- Confidence: one data point.

### 8. Length Sized to What the Reader Needs

The most frequent correction on drafts: cut by half, "tighter", "wall of text".
A speculative issue stays short on purpose. Graded as a word-count ladder on the
body above Agent Context, so a climb sees partial progress.

- Evidence: Plannotator annotations and chat revisions across the refine
  sessions in the session index ("cut length 50%", "too much excessive detail",
  "intentionally vague and concise since they're speculative").

### 9. Written for the Team, Not the Drafter

No scratch or tmp paths, home paths, the drafter's machine, or the drafter's own
skills and tools. Agent Context included: a teammate's agent can't open them either.

- Evidence: "no refs to tmp paths" (twice), "dont talk about my machine this is
  for a linear issue not personal notes", "compare.ts is detail of my skills".

### 10. Structure Over Prose for Data

Numbers go in tables, attribute and option definitions in a table, schema, or
list, and step-by-step flows in a diagram rather than paragraphs.

- Evidence: "numerical information should be expressed in tabular form",
  "bullets using prose to describe options for a given attribute", "compress
  info into visuals, eg mermaid sequence diagram".

### 11. Open Questions Only for Real Investigations

An open question is for a deep investigation with cross-cutting consequences
that a quick prototype can't settle. An implementation detail the refiner could
have decided, left open, is the model dodging the work. Something a short test
answers becomes a check for the assignee. Spikes keep their Questions section.

- Evidence: "too many open questions", "having any open questions is
  unacceptable ... set this issue up so the person who works on it can
  autonomously resolve the full scope".

### 12. Acceptance Shows the Behavior

Acceptance criteria and requested tests show the user-visible bug, not the
intermediate cause, and a list of tests is not acceptance criteria.

- Evidence: "why are tests the acceptance criteria", "an example of a cause
  based test, we should prefer integration style tests".

### 13. Claims Match the State of the World

Nothing pending is described as existing: an unmerged PR's tool is not "the
existing harness".

- Evidence: "existing? i think an existing pr is adding but this isnt landed",
  "pg doesn't have an existing materialized shape as claimed".

### 14. Titles Name the Task

The title identifies the problem or outcome without prescribing the
implementation: no env vars, file names, or function calls.

- Evidence: "The titles are overly prescriptive about implementation details."

### 15. No Agent Context Upstream

An issue filed in a repository the team doesn't maintain drops Agent Context.

- Evidence: "Get rid of this whole section" on an upstream issue, confirmed by
  Ben as the rule for repositories he doesn't own.

## How the Suite Scores

Title graders read the frontmatter, and body graders stop at Agent Context, so
relation links in the frontmatter never register as bare references. Findings 1,
2, 3, and 6 check by pattern. Findings 4 and 5 approximate the reviewer's judgment
with a word list and a heading count. Finding 7 is the
`type-spike` grader on the spike cases.

Findings 8, 9, 14, and 15 check by pattern: `body-words-*`, `no-leak`,
`title-no-code`, and `no-agent-context`. Findings 10 through 13 are one-criterion
`llm` judges (`events-structured`, `oq-justified`, `decided-not-open`,
`ac-observable`, `harness-not-existing`) plus the `numbers-table` pattern, each
paired with a `keeps-*` grader for the fact a cut must not lose.
