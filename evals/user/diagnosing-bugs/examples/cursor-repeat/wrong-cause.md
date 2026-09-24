---
fail: [cause, proposes-fix]
---
The sort in `sortUsers` is unstable, so page boundaries shift between calls. Sorting by name as a tiebreaker would fix it.
