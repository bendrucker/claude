The baseline doesn't support ranking from the CPU profile yet.

Wall time is 8.62 s but user plus system CPU is only 2.11 s, so about three quarters of the run is spent waiting off the CPU. The profile agrees: 2.05 s of samples over an 8.62 s duration. A CPU profile can't see that time, and `Store.Put` calls `wal.Sync()` after every one of 50,000 records, which is the likely wait.

Before ranking anything, take an off-CPU view of the same run: `strace -c -f` or `perf trace -s` for syscall time, or time the `Sync` calls directly.

1. **Sync once per batch instead of per record** (`Store.Put`, `os.(*File).Sync`). The Guard only needs every record durable once `kvload` exits, so a final `Sync` before `Close` keeps it. Confirm the fsync wait with the off-CPU profile first.
2. **Re-rank the CPU entries once the off-CPU profile is in.** `encoding/json.Marshal` leads them at 34.63% of samples, about 8% of wall.
3. **Encode with a reused buffer** (`encoding/json.Marshal`).
