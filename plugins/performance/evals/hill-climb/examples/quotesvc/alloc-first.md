---
fail: [gap, profile, no-trap-top2]
---
Ranked by share of the profile:

1. **Pool the JSON encoder's buffers with `sync.Pool`** (34.44% of allocations).
2. **Replace `fmt.Sprintf` in `cents`** with `strconv.AppendInt` (19.21%).
3. **Set headers once** (`net/http.Header.Set`, 11.26%).
