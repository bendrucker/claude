---
fail: []
---
Cut the "I ended up..." narration and the "the" filler on mtime — everything else was already result-stated.

<rewrite>
Cache compiled templates per worker, so a render no longer re-parses its template on every request.

The cache key is the template path and its mtime, so an edited template recompiles on its next render without a restart. Entries are never evicted: a worker holds at most the ~200 templates in `views/`, about 3 MB.

p95 render time on the dashboard dropped from 41 ms to 9 ms in staging. Keyed on mtime rather than a content hash — hashing on every render costs more than the parse it saves.
</rewrite>

Cut: the first-person "I ended up" framing on the mtime-vs-hash choice — kept the reasoning itself since it answers a likely reviewer question, just stated as fact rather than narrated.
