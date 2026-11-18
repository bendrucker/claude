# Budget

## Pricing

Price a candidate before launching it: cases × runs × 2 arms sessions, plus judge calls, each at the per-run cost the latest stored result measured. Re-price after a model or fixture change. CI and local runs draw on the same subscription quota. When the quota is tight, run one invocation at a time and cap the session's spend before the first run.

## Cap

Under a cap, divide it by the cost of one `dev` replicate before the first run. The loop needs two baseline replicates, a matching count per candidate, and a `holdout` pair at the end. When the cap cannot cover that, save in this order: verify only candidates that pass their screen, then drop the without arm on screens and scoped top-ups once the baseline shows it flat. Keep both arms on the baseline and the first candidate replicate, since the without arm is the drift check.
