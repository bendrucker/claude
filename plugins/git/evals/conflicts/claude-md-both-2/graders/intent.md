---
type: llm
focus: { source: file, path: CLAUDE.md }
---
Judge only the Evals section. It keeps the branch's change (the harness sentence trimmed to name the path pattern instead of listing every harness) and main's change (a paragraph telling the reader to run native suites through `run.ts` and why), with neither side's edit reverted. A merged paragraph that words the two together differently from either side passes. Fail if either side's change is missing or the section repeats the same content twice.
