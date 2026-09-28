# Go

## Whole Programs

Build the binary once per arm with `go build -o tmp/bench/<arm>/<bin>` and benchmark the binaries. `go run` compiles on every start and measures the compiler.

## Microbenchmarks

Write `testing` benchmarks with `b.Loop()` (Go 1.24+), which keeps the compiler from removing the measured call:

```go
func BenchmarkParse(b *testing.B) {
	input := loadRealInput(b)
	for b.Loop() {
		Parse(input)
	}
}
```

On older Go, loop to `b.N`, assign the result to a package-level variable, and build the input before `b.ResetTimer()`.

Compare arms with `benchstat`, which reports a p-value per benchmark and prints `~` when the difference is not significant:

```bash
go test -run '^$' -bench <Name> -benchmem -count 10 ./<pkg> > tmp/bench/base.txt
benchstat tmp/bench/base.txt tmp/bench/candidate.txt
```

- Two `go test` runs minutes apart carry drift between them. Interleave instead: compile each arm's test binary once with `go test -c -o tmp/bench/<arm>.test`, then alternate `-test.bench <Name> -test.count 1` between the binaries in a loop, appending to each arm's file.
- Run at least 10 counts per arm before reading `benchstat`.
- `-benchmem` adds allocations per op, a deterministic fast signal that tracks GC time.
- Pin `GOMAXPROCS` (or `-cpu`) when the code is parallel, so both arms get the same parallelism.
