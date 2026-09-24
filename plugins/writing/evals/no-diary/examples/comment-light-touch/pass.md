---
fail: []
---
The comment already states the constraint and the fix, so it stays as written.

<rewrite>
```go
// Postgres truncates identifiers at 63 bytes. Index names built from long
// table and column names would collide after truncation, so names past the
// limit get a short hash suffix instead.
func indexName(table string, cols []string) string {
```
</rewrite>
