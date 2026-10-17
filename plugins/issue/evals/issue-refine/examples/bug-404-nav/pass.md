---
fail: []
---
<issue>
---
title: 404 page missing top nav bar
type: bug
---

`templates/404.html` doesn't extend `templates/base.html`, so the 404 page renders without the nav header block every other page gets.
</issue>
