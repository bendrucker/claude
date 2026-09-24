Can you cut any diary out of this PR body before I push it?

---
Cache compiled templates per worker, so a render no longer re-parses its template on every request.

The cache is keyed on the template path and its mtime, so an edited template recompiles on its next render without a restart. Entries are never evicted: a worker holds at most the ~200 templates in `views/`, about 3 MB.

p95 render time on the dashboard dropped from 41 ms to 9 ms in staging. I ended up keying on mtime rather than a content hash, since hashing on every render cost more than the parse it saved.
---
