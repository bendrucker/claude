# Effort Cells

The review's shape is chosen by `(model family, effort level)`. Read the active model from context, pick its row, then pick the effort column. Unknown model families use the `default` row.

## Cell Selection

| Model family | low | medium | high | xhigh | max |
| --- | --- | --- | --- | --- | --- |
| `default` | `low` | `medium` | `high` | `xhigh` | `max` |
| `claude-sonnet-5` | `low-sonnet5` | `medium` | `high` + finder budget | `xhigh` + finder budget | `max` + finder budget |
| `claude-opus-4-8` | `o48-low` | `o48-med` | `o48-high` | `o48-xhigh` | `max` |

The `o48-*` cells run every angle **inline in this context** with no subagent fan-out and no verify pass. Only `max` reaches the full multi-agent fan-out on Opus 4.8. That is the upstream calibration, kept as-is.

## Budgets

| Cell | Angles | Cands/angle | Verify | Sweep | Cap | Framing |
| --- | --- | --- | --- | --- | --- | --- |
| `low` | 1 diff pass | — | none | no | <=4 | terse, hunk-only, skips test/fixture hunks |
| `low-sonnet5` | 1 diff pass | — | none | no | floor `min(files, 4)` | same, plus a second pass if under the floor |
| `o48-low` | 1 diff pass | — | none | no | <=8, floor `min(files, 4)` | no test-hunk skip |
| `medium` | 3 correctness + 3 cleanup + altitude + conventions = 8 | 6 | 1-vote, 3-state | no | <=8 | precision |
| `high` | 8 | 6 | 1-vote, recall-biased | no | <=10 | recall |
| `xhigh` | 5 correctness + 5 cleanup/altitude/conventions = 10 | 8 | 1-vote, single non-REFUTED carries | yes | <=15 | recall |
| `max` | 10 | 8 | same as `xhigh` | yes | <=15 | recall, maximum |
| `o48-med` | 8, inline | 6 | dedup only | no | <=8, floor 4 | recall |
| `o48-high` | 8, inline | 6 | dedup only | no | <=10, floor 5 | recall |
| `o48-xhigh` | 10, inline | 8 | dedup only | yes | <=15, floor 7 | recall |

"8 angles" means Angles A, B, C plus Reuse, Simplification, Efficiency, Altitude, Conventions. "10 angles" adds Angles D and E.

When the `Agent` tool is unavailable, every fan-out cell degrades to a single inline pass. See [SKILL.md](SKILL.md) for that path.

## Framing Paragraphs

Emit the framing for the selected cell before Phase 1. It sets the precision/recall tradeoff and is the main behavioral lever between tiers.

### `medium` (default and Sonnet 5)

> You are reviewing for **precision** at medium effort: every finding you surface should be one a maintainer would act on.

### `high`, `o48-med`, `o48-high`

> You are reviewing for **recall** at high effort: catch every real bug a careful reviewer would catch in one sitting. At this level, catching real bugs matters more than avoiding false positives. Err on the side of surfacing.

`o48-med` deliberately uses recall framing rather than the precision framing the default-family `medium` uses.

### `xhigh`, `o48-xhigh`

> You are reviewing for **recall** at extra-high effort: catch every real bug. At this level, catching real bugs matters more than avoiding false positives — a missed bug ships. Err on the side of surfacing.

### `max`

Same as `xhigh` with "maximum" in place of "extra-high". The fan-out is identical. Only the reasoning effort differs.

## Low Cells

The `low` cells skip the phase structure entirely: one diff read, then findings.

Read the unified diff in one tool call. `low` and `low-sonnet5` skip test/fixture hunks (`test/`, `spec/`, `__tests__/`, `*_test.*`, `*.test.*`, `fixtures/`, `testdata/`), which are not reviewed at those levels. `o48-low` reviews them. No subagents, no full-file reads.

Flag runtime-correctness bugs visible from the hunk alone: inverted/wrong condition, off-by-one, null/undefined deref where adjacent lines show the value can be absent, removed guard, falsy-zero check, missing `await`, wrong-variable copy-paste, error swallowed in a catch that should propagate. Also flag — still from the hunk alone — new code that duplicates an existing helper visible in the diff context, and dead code the diff leaves behind.

Do **not** flag style, naming, perf, missing tests, or anything outside the hunk.

Output one line per finding, most-severe first: `path/to/file.ext:123 — what's wrong and the concrete failure`. `low` outputs at most 4 and emits exactly `(none)` when nothing qualifies. `low-sonnet5` targets `min(files_changed, 4)` and does one more pass over the largest changed file and any removed blocks before settling for fewer. `o48-low` outputs at most 8, targeting at least `min(files_changed, 4)` and widening to other hunks before stopping.

`low` never reports through `ReportFindings`. It prints its findings as text.

## Finder Budget Hint

On Sonnet 5 at `high`, `xhigh`, or `max`, scale the fleet to the diff size instead of using a fixed one-agent-per-angle fan-out. Run `git diff --numstat` over the review range, sum the changed lines, and compute:

```
budget = clamp(ceil(lines / 150), 2, 8)
```

Spawn about that many finder subagents. The committed-range count is a floor: uncommitted changes are not in it, so scale up if Phase 0 finds additional working-tree scope.

No other model family gets this hint.

## Floors on the Opus 4.8 Cells

The `o48-med`, `o48-high`, and `o48-xhigh` cells carry an output floor of `floor(cap / 2)`: target at least that many findings. If fewer genuine findings exist, emit what you have. Do not invent findings to hit the floor.
