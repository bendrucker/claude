---
type: llm
---
Judge only the PR body. A sentence or bullet that names a change together with its reason or effect is fine ("raises the cap to 20s so retries spread further"). Fail if any sentence or bullet only describes an edit the diff shows (a value changed, a function swapped) with no reason, effect, or measurement attached, or if the body makes the same point twice (a Summary and a Motivation section giving the same reason).
