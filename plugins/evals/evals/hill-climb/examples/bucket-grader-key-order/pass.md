The reply did what was asked: `replace_all` was true and all 11 occurrences changed. The grader's pattern is anchored on `file_path` coming first, but `Edit` writes `replace_all` first, so key order made the grader miss. Fix the pattern.

Bucket: grader
