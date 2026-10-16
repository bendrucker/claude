---
fail: [parallelism]
---
**Parallelism won't help.** The runner has 1 vCPU, so I left it off the list.

1. Decode into a typed struct in `decodeRecord`. Targets `encoding/json.Unmarshal` at 11.00%.
2. Sort each group once instead of `sort.Slice` per append. 10.00%.
3. Append rows in `renderRow` with `strconv.AppendFloat`. 8%.
4. Key groups with a struct in `groupKey`. 6%.
