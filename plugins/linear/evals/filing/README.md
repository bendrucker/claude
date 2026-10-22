# `linear` Filing Eval

A native `claude plugin eval` suite for the `linear` skill's write path. Each case asks for an issue filed, updated, or listed in Linear, with and without the plugin. The without arm keeps the connector, so the delta is what the skill and its hooks add over a bare connector.

## Connector Mock

`mocks/claude_ai_Linear/` registers a standalone mock server under the claude.ai connector's own name, so the session sees `mcp__claude_ai_Linear__save_issue` and the rest exactly as it does in real use, and the plugin's `save-issue.ts` hook fires on it. `_tools.json` gives the tools hand-written schemas modeled on the connector's. `get_issue` answers from `issues/<id>.json`. A case's own `mocks/` overrides a tool, as `update-blocked` does for `save_issue`.

Graders read the call input with `tool_used` and `input_match`, against the JSON-encoded input, where a description newline is the two characters `\n`.

## Cases

| Tag | Cases | Measures |
| --- | --- | --- |
| `quick` | `quick-bug`, `quick-assigned` | A one-line report filed without headings, assignee `me`, labels by name |
| `raw`, `formatting` | `raw-materials`, `flow-race` | Pasted material turned into Linear constructs: fenced trace, check list, mermaid, relation params |
| `log`, `formatting` | `log-panic`, `log-migrate` | A long pasted log folded into a `>>>` collapsible, its decisive lines kept |
| `refined` | `refined-relations`, `refined-duplicate` | An `issue:refine` file saved in one call from a natural prompt: frontmatter mapped to params, Agent Context as a `>>>` collapsible, bare-identifier references |
| `invoked` | `invoked-relations`, `invoked-duplicate` | The same files through `/linear:linear`, which loads the skill without relying on its trigger |
| `update` | `update-blocked` | An update by `id` that sends only the changed fields |
| `query` | `query-mine` | A terse, linked list of assigned issues |

`skill-fired` is a with-only indicator that the model called the skill. It can't see a `/linear:linear` expansion, so the `invoked-*` cases skip it. `skill-load-error` fails a run whose skill load hit a shell injection error, which the skill's `!` line raises wherever Bash is denied or the eval sandbox can't start. The cases grant no Bash, so they run in a cloud container.

Beyond the skill's own rules, a second set of graders measures what a filed issue should look like, borrowed from the `issue:refine` suite. Word ceilings form a ladder per case size (`words-40` quick, `words-120`, `words-200` raw), `bullet-words-20` caps each bullet, `no-invented-priority` and `no-invented-sections` fail a priority or a fix, next-steps, or criteria heading the request never supplied, `title-words-10` caps the title, `body-verbatim` holds a refined file's prose unedited, `repro-fenced` wants the repro command in a shell block, `short-log-inline` keeps a short trace out of a collapsible, `no-mermaid` keeps diagrams out of issues without a multi-actor flow, and `no-invented-checklist` fails a check list on a request that supplied no criteria or tasks. Every one is a `regex` over the trace, so `regrade.ts` re-scores stored runs when one changes.

## Running

```bash
bun evals/native/run.ts plugins/linear/evals/filing -- --scaffold --runs 3 -j 4
bun evals/native/compare.ts --suite plugins/linear/evals/filing <baseline>/aggregate-result.json <candidate>/aggregate-result.json
```

The `refined-*` cases write their structured file from `fixture.sh`, so they need `--scaffold`. Results land in the gitignored `results/` and go to `s3://ben-drucker-agents-eval-corpus/linear-filing/`.
