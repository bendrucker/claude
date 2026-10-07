---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(five|5)[\s\S]{0,40}second[\s\S]{0,80}agent_prompt_stalled'
flags: i
match: contains
---
`agent prompt --wait` gives up with `agent_prompt_stalled` after five seconds of no state change.
