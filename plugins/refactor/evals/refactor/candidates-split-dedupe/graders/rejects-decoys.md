---
type: llm
focus: last_message
---
Two decoys look like targets but should not be ranked as recommended work. `packages/cli-a/src/exit.ts` and `packages/cli-b/src/exit.ts` are identical, but each package is published alone with zero runtime dependencies, including other packages in the repo. `src/data/countries.ts` is the largest file but holds one data table. Pass when the final reply rejects or keeps both, giving for the exit copies a reason about the separate-publish or zero-dependency constraint (proposing a new shared package counts only when it names that cost), and for `countries.ts` a reason that it is one responsibility or data. Fail when either is ranked as a recommended split or merge without that reason, or when either goes unmentioned.
