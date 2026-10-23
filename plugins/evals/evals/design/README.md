# `evals:design` Eval

A native `claude plugin eval` suite for `evals:design`: given a brief, does a session write an eval suite to disk that meets the design rules? Every case hands the session `/evals:design <artifact>` with an invented plugin, skill, agent, or rule in its working directory, a motivating correction, and three to five short synthetic transcript excerpts. The session writes a suite (or, for the Python case, a `pydantic-evals` dataset) and the graders read the tool calls it made. Nothing runs, so a case costs one authoring session. The suite is `.local-only`, since all nine cases in a labeled-PR run would pass the monthly eval budget. Dispatch it with `--tag dev` or `--tag holdout`.

## Cases

Each case is tagged `design`, its split, and its brief kind. The fixture is a shell scaffold (`fixture.sh`, run by the runner's `--scaffold`) that writes the invented artifact into the case's working directory. A fixture holds the artifact and, for `extend-rollback-note`, an existing suite. Grader text stays out of it.

| Case | Split | Brief | Request kinds | Seed |
| --- | --- | --- | --- | --- |
| `skill-changelog` | dev | skill | `fix`, `breaking` | a suite of nine cases with no `holdout` tag |
| `skill-branch-name` | holdout | skill | `ticket`, `freeform` | a claim pattern that failed a reply for naming a cause it ruled out |
| `agent-dep-review` | dev | agent | `bump`, `added` | a judge set to the model under test |
| `agent-ticket-triage` | holdout | agent | `bug`, `question` | a trace pattern anchored on one key order of a tool input |
| `rule-sql-style` | dev | rule | `select`, `migration` | expected values copied into the fixture, where a `Grep` found them |
| `quiet-commit-scope` | dev | quiet | `scope`, `amend` | a skill that fired on every git request because no case asked it to stay quiet |
| `removal-error-copy` | holdout | removal | `rewrite`, `fresh` | a removal grader with no survival partner, which an empty reply passed |
| `extend-rollback-note` | dev | extend | `rollback`, `hotfix` | a review suite of four cases with no `holdout`, grown by adding more `dev` cases |
| `pydantic-support-agent` | dev | pydantic | `refund`, `shipping` | a `pydantic-evals` report an earlier climb read through native-only commands |

The seeds are real misses, rewritten into invented artifacts. No transcript or work-repo text is in the suite.

## References

The runner denies reads outside a case's working directory, the plugin's own files included, so a session cannot open the files `evals:design` links. `inline_references: true` in `suite.yaml` has `run.ts` append each linked file to the staged `SKILL.md`. The with arm gets the references in context and the without arm gets nothing. A copy in the working directory would leak to the without arm, whose `**/*` glob found and read one in a probe. The suite therefore measures the skill's content and cannot test whether a session opens a reference when it should.

## Graders

All but one grader are deterministic. The regexes read the trace of the session's `Write` and `Edit` calls, anchored on the tool call so the injected skill text and the prompt never match, and independent of the serialized key order. Their patterns come from [`scripts/patterns.ts`](scripts/patterns.ts).

| Rule | Grader | Kind |
| --- | --- | --- |
| a third of the cases are `holdout` | `holdout-share` | `llm`, the only one, one criterion with a 25% to 45% pass bar over the reply's case list |
| both splits exist | `tag-holdout`, `tag-dev` (native), `split-holdout`, `split-dev` (pydantic, from the reply's list) | `regex` |
| every request kind has a case in both splits | `kind-<kind>-<split>` per case (pydantic: from the reply's list) | `regex` |
| a quiet case and a balance case | `quiet-tag`, `balance-tag` (native), `quiet-case`, `balance-case` (pydantic, from the reply's list) | `regex` |
| the judge differs from the model under test | `judge-model` (native `suite.yaml`), `judge-model-py` (no `LLMJudge` without `model=` or with the agent's model) | `regex` |
| each `llm` grader states a pass bar | `pass-bar`, `pass-bar-py` | `regex`, `not_contains` |
| `examples/` exist | `examples-exist` | `file_exists` |
| fixtures hold no grader text | `fixture-clean` | `regex`, `not_contains` on writes to fixture paths |
| removal and survival pair (`removal-error-copy`) | `removal-grader`, `survival-grader` | `regex` |
| pydantic stays pydantic (`pydantic-support-agent`) | `dataset-written`, `deterministic-evaluator`, `no-ts-write`, `no-native-ref`, `no-native-files` | `regex`, `file_exists` |

#### Gaps

The runner has no script or command grader, so a regex over the trace stands in where a check needs counting or a cross-file view.

- The holdout share is a count, which no regex expresses. `tag-holdout` and `tag-dev` only require both splits to exist, and `holdout-share` judges the reply's own list of cases and splits. A session that lists a case list it did not write passes the judge. The trace shows the truth.
- "Random within each kind" and "never by baseline score" are not observable. The kind graders check coverage and nothing about how the split was drawn.
- "Source from real corrected turns" and "one criterion per `llm` judge" need a reader. The pass-bar graders only fail an `llm` grader with no `pass` anywhere in it.
- The native graders find a tag list written as a flow list (`tags: [fix, holdout]`) or a block list. A suite that names splits some other way scores 0 on them.
- A Python dataset can build its cases through helpers, such as `_refund(name, question, "holdout")`, which no regex over the file follows. The pydantic split, kind, and role graders read the reply's `name | tags` list instead, so like `holdout-share` they trust what the session reports.
- The judge graders compare against the model the prompt names for the artifact (`claude-sonnet-5-5`). A pydantic `LLMJudge` whose model comes from a variable fails `judge-model-py` unless it also appears as a literal in the call.

## Regenerate

The `case.yaml`, grader, `suite.yaml`, and `examples/` files are generated. Edit [`scripts/spec.ts`](scripts/spec.ts), [`scripts/graders.ts`](scripts/graders.ts), or [`scripts/traces.ts`](scripts/traces.ts) and run `bun plugins/evals/evals/design/scripts/gen.ts`. The `prompt.md` and `fixture.sh` of each case are hand-written. A test fails when a committed file differs from the generator.

## Running

`bun evals/native/run.ts plugins/evals/evals/design --ref <ref> -- --tag dev --runs <n>` runs the plugin at `<ref>` against a no-plugin baseline on the `dev` split. Add `--tag holdout` to confirm a win, `--case <glob>` for one case, and `--ablation none` to drop the baseline arm and halve the cost. A case runs up to 60 turns, so price a run first: cases × `--runs` × 2 arms sessions, plus three judge calls per run for `holdout-share`. The `dev` split is six cases and the `holdout` split is three.

- `bun evals/native/check.ts plugins/evals/evals/design` tests the regex graders against [`examples/`](examples/): a passing trace for every case, and per grader a failing trace. Every case has failing traces for its `kind-*` graders, and `skill-changelog`, `removal-error-copy`, `extend-rollback-note`, and `pydantic-support-agent` have one for every shared grader.
- `bun test plugins/evals/evals/design` covers the generator, the committed files, and the trace patterns across key orders, `Edit` calls, and block tag lists.
