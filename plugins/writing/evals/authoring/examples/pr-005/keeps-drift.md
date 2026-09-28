---
fail: [keeps-drift]
---

<out>
Generate readme input/output docs

Wraps the generated table in comment markers, similar to `//go:generate`, so regenerating it is idempotent. Adds a `make docs` target and an Actions workflow that runs the generator and fails the check if the committed README doesn't match the output.
</out>
