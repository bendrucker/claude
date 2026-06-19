# PR Heading Eval

The harness that produced and validated the `## Headings` guidance in `plugins/pull-request/skills/create/sections.md` (PR #851). It mines heading examples from real PRs, captures the taste as labels, builds a classifier and an LLM judge calibrated against those labels, and runs an A/B that measures whether the guidance lowers the bad-heading rate. The shipped result: 64.7% → 10.7% bad headings.

Everything here is scratch tooling, not part of any plugin. Rerun it to re-tune the guidance or re-validate after a skill change.

## Pipeline

Run in order. Each script writes files the next one reads, all under this directory.

- `fetch.ts` pulls merged public PR bodies via the GitHub GraphQL API into `bodies/` plus `manifest.json`.
- `parse.ts` extracts headings with the `marked` lexer into `headings.json`.
- `analyze.ts` runs the early comparison showing the `writing` plugin's `classifyHeadingBaseline` flags almost none of these.
- `make-label.ts` emits the ambiguous-heading set (three or more words) for labeling.
- `build-label-html.ts` generates `label.html`, a self-contained labeling UI with verdict, notes, and rewrite fields, localStorage autosave, and JSON import/export.
- `classifier.ts` and `calibrate.ts` define the lexical `classifyPrHeading` screen and score it against the labels (F1 0.92).
- `judge-prompt.md`, `judge.ts`, and `judge-calibrate.ts` define the LLM judge with section-body context, then calibrate it and the combined `classifier OR judge` grader.
- `scenarios-selection.json` and `scenarios/` hold the real-PR generation scenarios with the diff and context but the body stripped.
- `assemble-prompts.ts` builds the baseline and treatment system prompts from the live skill files plus `treatment-headings.md`.
- `run-eval.ts` generates both arms with Sonnet, grades the headings, and writes `gen-eval-report.md`.

## Ground Truth

The hand-made artifacts worth keeping. Everything else regenerates.

- `labels.json` holds 102 headings labeled good/bad, 8 with notes and 22 with rewrites. It is the source of the rule and the calibration target.
- `scenarios/` holds 18 curated generation scenarios.
- `judge-prompt.md` and `treatment-headings.md` are the judge rubric and the guidance text under test.
- `gen-eval-report.md` is the shipped A/B result.

## Running

Dependencies (`marked`, `@anthropic-ai/sdk`) auto-install on first run. `bodies/` and the generated outputs are gitignored, so start with `bun fetch.ts` to repopulate the corpus. The judge and generation steps need `ANTHROPIC_API_KEY`.
