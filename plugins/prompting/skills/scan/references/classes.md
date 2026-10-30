# Classes

Tag every proposal with one class. Each class names a kind of line that no longer changes what a current model does, and anchors to a section of the `prompting` skill, which carries the full rule.

One test decides every class: does this line change behavior on a current model? A line that does stays, whatever class it resembles.

## Keep

Propose no cut to these, whichever class they look like:

- A fact the model cannot find by looking: an unwritten convention, the reason behind a constraint, a gotcha no config records, the audience, the quality bar.
- A completion criterion or done-condition.
- A string a hook, script, test, or eval greps for or asserts on. Search the repo for the quoted text before proposing it.
- A tool's contract: flags, output format, exit codes the document's own scripts define.

## Classes

#### `no-op`

An instruction the model follows by default. Anchor: Pruning, No-ops.

#### `stale-guard`

A guard written against an older model's failure that current models no longer make, such as a warning against hallucinating a tool or skipping a file. Anchor: Pruning, No-ops, the paragraph on text written against an older model.

#### `emphasis`

Capitals, `MUST`, `CRITICAL`, `IMPORTANT`, or repetition used to force compliance. A current model over-applies emphasized rules, so the cut usually rewrites the sentence plainly rather than deleting it. Anchor: Pruning, No-ops.

#### `duplication`

A meaning stated a second time in the same unit. Cut the weaker copy. A leading word repeated as a token is not duplication. Anchor: Pruning, Duplication.

#### `cache`

Text restating what one file read or one command's output already shows: package scripts, config, directory layout, `--help`. Anchor: Pruning, Cache.

#### `relevance`

A line that never bore on the task, or has gone stale as the world it describes changed: exposition, project history, a branch that belongs behind a pointer. Anchor: Pruning, Relevance.

#### `choreography`

An exact sequence of tool calls or steps the goal already implies. Keep a step the goal cannot imply: an ordering constraint, or a call the model would not otherwise make. Anchor: Goal.

#### `delegation`

An instruction to dispatch a subagent, fork, or parallel worker for work a current model does well inline. Anchor: Goal, the paragraph on pairing the goal with instructions.

## Retiring a Class

Retire a class when the `prune-acceptance` query shows it below 50% acceptance in each of two consecutive rounds where it drew at least five proposals. Retire it by deleting its entry from this file, so the judge stops proposing it.
