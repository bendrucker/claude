# Rubric

What separates a good refined issue from a bad one, derived from labeling a batch
of real `issue:refine` outputs. Each item names the rule, the evidence behind it,
and the skill text that produces the violation. This drives both the skill edits
and the A/B scorer.

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
  title-case body headings. The scorer reads the title from that field.

### 7. Possible Missing Spike Type

A spike (timeboxed investigation, output is a recommendation not a shipped change)
was typed as a bug and read wrong.

- Evidence: sample-01 tagged `wrong-type`, note "should be labeled Spike".
- Skill location: `SKILL.md` Issue Types lists only bug / feature / refactor.
- Confidence: one data point. Confirm before acting.

## How this scores an A/B run

The scorer parses the artifact's frontmatter first and reads the title and type
from it, then runs findings 1-5 over the body alone, so relation links in the
frontmatter never register as bare references. Findings 1, 2, 3, and 6 are
mechanical and check by pattern. Findings 4 and 5 are partly mechanical (word
list) and partly judgment. The A/B harness runs a synthetic brief through both
skill versions, counts violations per finding, and adds an LLM judge for the
judgment calls.
