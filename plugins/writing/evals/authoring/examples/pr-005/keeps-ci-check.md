---
fail: [keeps-ci-check]
---

<out>
Generate readme input/output docs

The input/output tables drift out of date since nobody updates both the README and `action.yml` by hand. Generates them instead, wrapped in comment markers so regeneration is idempotent, similar to `//go:generate`. Also adds a `make docs` target.
</out>
