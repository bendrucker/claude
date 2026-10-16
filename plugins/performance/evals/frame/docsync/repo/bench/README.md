# Benchmark

`bench.sh` builds `docsync` and times `docsync sync` with hyperfine against the fixture in `fixtures/`. The fixture is pinned, so runs are offline and repeatable.

    ./bench/bench.sh

Last run, 2026-10-09 on an M2 laptop: 412 ms ± 18 ms over 20 runs.
