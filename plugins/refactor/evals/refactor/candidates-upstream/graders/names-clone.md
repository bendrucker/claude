---
type: llm
focus: last_message
---
`snapshot` in `src/cache/snapshot.ts` deep-clones with `JSON.parse(JSON.stringify(state))`. Pass when the final reply names it as a candidate for `structuredClone` and states at least one behavior difference: the JSON round trip turns `Date` fields into strings and drops `undefined` fields, while `structuredClone` keeps both. Fail when it calls the swap equivalent with no difference stated, or omits the candidate.
