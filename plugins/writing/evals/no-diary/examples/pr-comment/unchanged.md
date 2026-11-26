---
fail: [no-hedge]
---
<rewrite>
I think it might potentially be worth considering whether we should maybe extract this validation logic into its own function? It's currently duplicated in a couple of places (handleCreate and handleUpdate) and it feels like it could get out of sync over time. Just a thought, not a blocker or anything.
</rewrite>
