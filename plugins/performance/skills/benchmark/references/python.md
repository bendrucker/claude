# Python

## Whole Programs

Benchmark a Python CLI through `hyperfine` like any other command. Interpreter startup and imports often dominate short commands. Measure them alone with `python -X importtime -c 'import <module>'`, which prints a per-module import time tree to stderr.

## pytest-benchmark

Use `benchmark.pedantic()` with explicit `rounds`, `iterations`, and `warmup_rounds` for a comparison. The default auto-calibration picks a different round count per variant.

- Parametrize both variants into one session, so they share a process and machine state. A `--benchmark-compare` against a result saved minutes earlier carries the drift between the two sessions.
- Run at least 25 rounds before reading a difference. At 5 rounds, differences between high-variance cases flip sign on a re-run.
- `pedantic` calls the same target with the same arguments every round. Any object passed in that holds state (a sampler, a connection, a stop flag) must reset itself on each call, or every round after the first measures a stale object.
- Pass `-p no:randomly` and `--timeout=0` when the suite uses `pytest-randomly` or `pytest-timeout`, so ordering and timeouts stay fixed across variants.
- Export with `--benchmark-json` and keep the files beside the notes.

## Real Inputs

Benchmark against real data before trusting a conclusion. Synthetic data with the wrong size, cardinality, or distribution has inverted conclusions that real inputs then reversed.
