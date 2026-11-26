# Suggestions Eval

Measures whether the way the writing hook reports Vale findings lets the model fix errors and warnings while it applies only the suggestions that improve the text.

Each scenario's prompt holds a draft for the model to save with one added section. On the first write to the doc, the case's hook replays the scenario's findings from [`scenarios/`](scenarios/): one error, one warning, two suggestions that improve the text (TP), and three whose change leaves it no better (FP). The doc is `.rst`, which the real writing hook skips.

The arm is the last part of the case name, and each case's `plugin/` passes it to [`findings.ts`](findings.ts):

| Arm | Surface |
| --- | --- |
| `flat` | Every finding as PostToolUse context under one "Fix them in one pass" |
| `inline` | Every finding as PostToolUse context, grouped by severity with what each severity expects, from `report()` in [`hooks/report.ts`](../../hooks/report.ts) |
| `stop` | Errors and warnings as `inline`, suggestions held until a Stop hook returns them once as optional `additionalContext` |

The without arm loads neither hook. Run with `--ablation none`:

```bash
bun evals/native/run.ts plugins/writing/evals/suggestions -- --ablation none --runs 4 -j 4
bun plugins/writing/evals/suggestions/report.ts plugins/writing/evals/suggestions/results/<run>
```

`report.ts` pools pass rates per arm and finding kind. A case score mixes fixing a TP with leaving an FP alone, which pull opposite ways.
