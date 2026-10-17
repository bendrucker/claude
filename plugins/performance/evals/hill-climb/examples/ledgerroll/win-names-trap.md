1. Decode each line into a typed struct in `decodeRecord` instead of `map[string]any`. Gzip is bigger at 31.00%, but the feed format fixes it, so this 11.00% ranks first.
2. Sort each group once instead of `sort.Slice` after every append. 10.00%.
3. Build rows in `renderRow` with `strconv.AppendFloat`. 8%.
4. Overlap decompression with parsing on a goroutine, set aside: 1 vCPU.
