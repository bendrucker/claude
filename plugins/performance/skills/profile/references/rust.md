# Rust

`samply` is the default profiler for Rust. It reads Rust symbols, including inlined frames, from the build's debug info ([samply.md](samply.md)).

## Build

Profile a release build with debug info, since a debug build ranks the wrong code:

```bash
CARGO_PROFILE_RELEASE_DEBUG=true cargo build --release
samply record --save-only --unstable-presymbolicate -o tmp/profile/<name>.json.gz -- target/release/<bin> [args]
```

- Keep every other release setting (`lto`, `codegen-units`, `opt-level`) the same as what users run. The environment variable adds debug info without editing `Cargo.toml`.
- Add `RUSTFLAGS="-C force-frame-pointers=yes"` when stacks come out truncated. It changes codegen slightly, so drop it for timing.
- Profile a benchmark by running its compiled binary: `cargo bench --no-run` prints the path.

## Memory

- The `dhat` crate, enabled behind a feature flag, reports allocation counts, bytes, and the call sites that make them. Allocation count is a deterministic signal.
- On Linux, `heaptrack target/release/<bin>` records allocations without code changes.

## Compile Time

When the metric is build time, `cargo build --timings` writes an HTML report of each crate's compile time and the parallelism across them. `cargo llvm-lines` ranks the generic functions that expand into the most code.
