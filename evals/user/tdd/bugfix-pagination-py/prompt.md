`paginate(items, 1)` skips the first ten items, but pages are 1-based. Fix it test-first. `paginate` and `page_count` are the public API, and tests run with `python3 -m unittest`.
