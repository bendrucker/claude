---
fail: []
---
The loop in `page()` runs `i <= items.length`, an off-by-one that pushes `undefined` as the last item. Use `i < items.length`.
