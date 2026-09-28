# Go

Go ships its profiler in the toolchain. `pprof` names Go functions with source lines and prints text rankings directly.

## CPU and Memory

Profile a benchmark or test with flags:

```bash
go test -run '^$' -bench <Name> -cpuprofile tmp/profile/cpu.prof -memprofile tmp/profile/mem.prof ./<pkg>
```

Profile a whole program by starting `runtime/pprof` in `main` (`pprof.StartCPUProfile` / `StopCPUProfile`), or by importing `net/http/pprof` in a long-running server and fetching `/debug/pprof/profile?seconds=30`.

Read the ranking as text:

```bash
go tool pprof -top -nodecount=25 tmp/profile/cpu.prof
go tool pprof -top -cum -nodecount=25 tmp/profile/cpu.prof
go tool pprof -list '<func regex>' tmp/profile/cpu.prof
```

`-top` sorts by self time, `-cum` by inclusive time, and `-list` annotates a function's source line by line. For memory, add `-sample_index=alloc_space` to rank allocation volume, which drives GC time, or `inuse_space` for what stays live. Point the user at `go tool pprof -http=:0 <file>` for the flame graph.

## Waiting

A CPU profile misses time a goroutine spends blocked.

- `-blockprofile` and `-mutexprofile` on `go test` rank where goroutines wait on channels, locks, and `select`.
- `go test -trace tmp/profile/trace.out` (or `runtime/trace` in `main`) records scheduling, syscalls, and GC per goroutine. `go tool trace` opens it in a browser for the user.

## Startup

`GODEBUG=inittrace=1 <binary>` prints the time and allocations of each package's `init`. Run the built binary, since `go run` adds a compile to every start.

## Gotchas

- `samply` also profiles Go binaries and follows child processes. Use it when the program shells out.
- A profile of a benchmark with a tiny input ranks setup and loop overhead. Match the scenario.
