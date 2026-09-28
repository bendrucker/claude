# Rust

## Whole Programs

Benchmark `target/release/<bin>`, built once per arm into its own target directory (`CARGO_TARGET_DIR=tmp/bench/<arm>`). `cargo run` checks the build on every start. Build with the release settings users get.

## Microbenchmarks

Use the harness the project already has. For a new one, use [`criterion`](https://github.com/bheisler/criterion.rs): a benchmark group runs both arms in one process and reports whether their difference exceeds noise. When the metric is allocations, add [`divan`](https://github.com/nvzqz/divan) for its `AllocProfiler`, whose counts are deterministic. Pass inputs and results through `std::hint::black_box`, or the optimizer removes the measured work.

```rust
fn bench(c: &mut Criterion) {
    let input = load_real_input();
    let mut group = c.benchmark_group("parse");
    group.bench_function("base", |b| b.iter(|| parse_base(black_box(&input))));
    group.bench_function("candidate", |b| b.iter(|| parse_candidate(black_box(&input))));
    group.finish();
}
```

- Put both implementations in one benchmark group so they share a process and machine state. `criterion`'s `--save-baseline` and `--baseline` compare against a run from earlier, which carries the drift between the two runs.
- `criterion` prints "No change in performance detected" when the difference is within noise. Treat that as a tie.

## Instruction Counts

On Linux, [`gungraun`](https://github.com/gungraun/gungraun) (formerly `iai-callgrind`) runs benchmarks under Valgrind and reports instructions and cache accesses. The counts barely vary between runs, so they make a strong fast signal. Check on the baseline that they track wall time.
