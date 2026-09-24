give this comment a no-diary pass

```go
// Postgres truncates identifiers at 63 bytes. Index names built from long
// table and column names would collide after truncation, so names past the
// limit get a short hash suffix instead.
func indexName(table string, cols []string) string {
```
