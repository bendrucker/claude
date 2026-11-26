---
type: llm
---
The final reply reports that the session ran the original implementation and the new one on the same inputs and compared what callers observe (output, errors, and exit status for a script, return values for a library), and gives the result of that comparison. At least one input goes beyond the happy path, such as empty input, a missing file or session, or an edge the original handles specially. Running only the new version, running only the test suite, or comparing by reading the code fails. When the sandbox blocked part of the comparison, the reply says which part, and the comparisons that did run still count.
