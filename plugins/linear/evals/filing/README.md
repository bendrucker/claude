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
| `refined` | `refined-relations`, `refined-duplicate` | An `issue:refine` file saved in one call: frontmatter mapped to params, Agent Context as a `>>>` collapsible, bare-identifier references |
| `update` | `update-blocked` | An update by `id` that sends only the changed fields |
| `query` | `query-mine` | A terse, linked list of assigned issues |

`skill-fired` is a with-only indicator of whether the skill loaded.

## Running

```bash
bun evals/native/run.ts plugins/linear/evals/filing -- --scaffold --runs 3 -j 4
bun evals/native/compare.ts --suite plugins/linear/evals/filing <baseline>/aggregate-result.json <candidate>/aggregate-result.json
```

The `refined-*` cases write their structured file from `fixture.sh`, so they need `--scaffold`. Results land in the gitignored `results/` and go to `s3://ben-drucker-agents-eval-corpus/linear-filing/`.
