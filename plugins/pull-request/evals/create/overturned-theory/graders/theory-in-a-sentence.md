---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. The body mentions the disproved theory (that the wrapper was swallowing the exit code) in one sentence or one bullet. A sentence that names the theory and pivots to the real cause ("the wrapper was suspected of swallowing the code, but that didn't hold up: the cause was ...") passes, as does a single bullet under an investigation heading whose other bullets cover the cause and the test. Fail if the theory is absent, or if the body spends more than one sentence or bullet on the wrong turn itself (what was checked, in what order, why it seemed plausible).
