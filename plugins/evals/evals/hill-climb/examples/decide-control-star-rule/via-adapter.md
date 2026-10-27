`includes-request-id` rose on the with arm from 33% to 100% (p=0.060), and it rose just as far on the without arm, from 17% to 83% (p=0.080). The without arm is the control that the candidate cannot touch, so both arms moving together points to drift. Add runs to both columns for `add-handler` with `bun evals/native/run.ts --adapter ./csv-adapter.ts`, then pool them with `bun evals/native/compare.ts --adapter ./csv-adapter.ts` before reading the row.

Decision: more-runs
