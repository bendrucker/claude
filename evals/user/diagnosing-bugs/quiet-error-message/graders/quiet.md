---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?diagnosing-bugs"'
min: 0
max: 0
arm: both
---
The user mentions an error but asks for something other than a diagnosis, so the skill stays quiet. Scored on both arms so a trigger change that over-fires loses score.
