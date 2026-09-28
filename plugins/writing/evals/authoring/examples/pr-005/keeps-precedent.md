---
fail: [keeps-precedent]
---

<out>
Generate readme input/output docs

The input/output tables drift out of date since nobody updates both the README and `action.yml` by hand. Generates them instead, and adds a `make docs` target plus an Actions workflow that fails the check if the committed README doesn't match the generated output.
</out>
