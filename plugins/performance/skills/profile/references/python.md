# Python

## py-spy

`py-spy` samples a Python process from outside and names Python functions with file and line.

```bash
py-spy record --subprocesses --format speedscope -o tmp/profile/<name>.json -- python <script> [args]
py-spy top --pid <pid>
```

- `--subprocesses` follows child Python processes, which covers multiprocessing workers.
- `--native` adds C-extension frames when the time sits in native code.
- `--idle` includes samples where the thread waits, which ranks what a waiting program blocks in.
- `py-spy` needs `sudo` on macOS to attach to a running process. `record -- <command>` launches the process itself and runs without it.

## cProfile

When `py-spy` is unavailable, the standard library's deterministic profiler works with no install:

```bash
python -m cProfile -o tmp/profile/<name>.prof <script> [args]
python -c "import pstats; pstats.Stats('tmp/profile/<name>.prof').sort_stats('cumulative').print_stats(25)"
```

`cProfile` instruments every call, so it inflates code with many small calls far more than code with few large ones. Use its ranking to pick candidates and measure changes without it.

## Imports

`python -X importtime -c 'import <module>'` prints a per-module import time tree to stderr. Startup often dominates a short CLI.
