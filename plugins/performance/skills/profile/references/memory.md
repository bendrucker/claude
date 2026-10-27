# Native Memory

Peak memory is set by the allocations live at the process's high-water mark. Rank those, by allocation stack. Total allocation volume ranks the wrong things for peak RSS: a site that allocates and frees gigabytes in small pieces may not hold a byte at the peak.

Sampling profilers (`samply`, `perf`, `py-spy`) record no allocations. They cannot attribute memory.

## macOS

Record with the bundled capture script, then summarize:

```bash
bun <skill-dir>/scripts/heap-peak.ts tmp/heap/<name>.txt -- <program> <args>
bun <skill-dir>/scripts/heap-top.ts tmp/heap/<name>.txt --json
```

`heap-peak.ts` runs the program with `MallocStackLogging=full` and a preloaded library that stops it at exit, before the stack log is deleted. It then runs `malloc_history <pid> -highWaterMark -callTree -consolidateSystemFramesBySymbol` into the report and kills the process. Only the direct child stops, so the program's own children exit normally.

- Pass the program itself, not a wrapper. dyld drops the preloaded library for SIP-protected binaries (`/bin/sh`, `/usr/bin/env`), and the script refuses them.
- A binary signed with the hardened runtime blocks the stack log reader. The script checks `codesign -dv` and refuses it. Record a copy re-signed ad hoc: `cp <binary> tmp/heap/<name> && codesign --force -s - tmp/heap/<name>`.
- A program that leaves through `_exit` or a signal never reaches the stop. For it, and for a long-running server, run it yourself with `MallocStackLogging=full`, keep it alive past the workload, and run the same `malloc_history` command against its pid (`$!`, since `pgrep` is blocked in the sandbox).
- `MallocStackLogging=1` means lite mode, which keeps no history, and `-highWaterMark` refuses it.

`heap-top.ts` prints:

- **Coverage.** The high-water heap against `Physical footprint (peak)` from the same report. The rest is the stack log's own pages, thread stacks, and mapped files. When coverage falls well short of the footprint the user measured, the peak is outside the malloc heap.
- **Allocation sites.** Bytes live at peak per deepest frame outside the allocator. `--skip '<regex>'` treats the program's own allocator wrappers (an arena's grow function, a library's `xmalloc`) as allocator frames, so the bytes land on their callers.
- **Inclusive.** Bytes live at peak under each frame. Read down past the entry points to the first frame of the program's own logic.
- `--match '<regex>'` adds the bytes under frames matching the regex, which sizes one subsystem's share.

## Linux

`heaptrack` interposes `malloc` without code changes and records every allocation with its stack:

```bash
heaptrack -o tmp/heap/<name> <program> <args>
heaptrack_print <file> --print-allocators=0 --print-temporary=0 --print-leaks=0
```

`<file>` is the path heaptrack prints at exit: `.zst` or `.gz`, depending on the build. Its boolean flags take `=0`. A bare `0` after one reads as the file argument.

Read `PEAK MEMORY CONSUMERS`, which ranks stacks by their contribution to the heap's peak, and the summary line `peak heap memory consumption`. Rank on the peak section, not `MOST CALLS TO ALLOCATION FUNCTIONS` or the total allocated. Its `peak RSS` line includes heaptrack's own overhead.

When the peak section shows one entry at `0x0` `in ??`, heaptrack failed to unwind, which happens with heaptrack 1.5 on arm64 even with frame pointers. Its totals still hold, so take stacks from massif.

`valgrind --tool=massif` takes heap snapshots and marks the peak:

```bash
valgrind --tool=massif --massif-out-file=tmp/heap/<name>.%p.massif <program> <args>
ms_print tmp/heap/<name>.<pid>.massif
```

`%p` gives each process its own file. A forked child otherwise writes to the parent's file. The header line `Detailed snapshots: [3 (peak), …]` names the peak snapshot, and that snapshot carries the allocation tree. It runs the program 20 to 100 times slower, so prefer heaptrack where it unwinds. `--pages-as-heap=yes` counts `mmap` pages as well as `malloc`.

From a Mac, run either one in a Linux VM ([linux-vm.md](linux-vm.md)). Peak attribution transfers when the allocation pattern is platform-neutral. The absolute bytes do not, since the allocators differ.

## Gotchas

- **Phases.** A peak belongs to one phase of the run. Record a cheap run that stops after setup (parse, plan, or bind, without executing) beside the full run. The difference separates the setup peak from the work peak, and a candidate that shrinks one leaves the other.
- **Private allocators.** A program with its own allocator (an arena, or a jemalloc built with a symbol prefix) shows up as a few huge opaque sites: the arena's growth calls. Compare the attributed peak with the program's own memory accounting, and use `--skip` to push the bytes to the arena's callers when the wrapper is visible.
- **Allocator caching.** `malloc` keeps freed memory for reuse, so RSS lags frees and stays near the high-water mark after it. A change that frees earlier lowers the heap peak before it lowers RSS.
- **Stack log overhead.** `MallocStackLogging` adds its own pages to the footprint and slows the program. Measure peak RSS without it ([benchmark](../../benchmark/SKILL.md)), and use the recording only to attribute.
- **RSS and footprint.** Max RSS counts mapped binary text and shared pages, which footprint excludes, so the two differ by the binary's size and more. Compare a peak with the same kind of number.
