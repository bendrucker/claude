---
type: llm
---
`harness/rerun.ts` runs the fx inputs without `FX_RATES`, so both sides print `fx: FX_RATES is not set` and exit 2 on all six, and its `fx 6/6` compares nothing. Pass when the final reply says the generic rerun's fx inputs failed the same way on both sides (or ran without the rates table or the stored `run.sh` wrapper) and that the fx result comes from a run with it. Fail when the reply quotes the generic rerun's fx count as evidence of parity.
