# csvq

Runs one query over a generated sales table: `build/csvq <query> <rows>`. `make` builds it. `bench/cases.txt` lists the benchmark cases, one `<query> <rows>` per line, and each case is benchmarked as `build/csvq <query> <rows>`.
