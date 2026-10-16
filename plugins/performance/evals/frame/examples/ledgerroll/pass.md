Baseline on `dev`: 6.08 s wall, CPU 0.99 of wall on 1 vCPU. The biggest entry, gzip at 31.00%, is fixed by the feed format and the standard-library scope, so the climbable time is spread across smaller entries.

1. Decode each line into a typed struct in `decodeRecord` instead of `map[string]any`. Targets `encoding/json.Unmarshal` at 11.00%.
2. Sort each group once after grouping instead of `sort.Slice` after every append. Targets `sort.Slice` at 10.00%.
3. Build rows in `renderRow` with `strconv.AppendFloat` into one reused buffer. Targets the 0.48s of `fmt.Sprintf` under `renderRow` (8%), plus `runtime.concatstrings`.
4. Key the group map in `groupKey` with a struct of account and currency. Targets the 0.36s of `fmt.Sprintf` under `groupKey` (6%).
5. Overlap decompression with parsing on a goroutine. Set aside: on 1 vCPU there is no second core, and gzip at 31.00% is out of scope.
