---
type: regex
pattern: '^(?=[\s\S]*(?:load average|\bloaded\b|machine load|\bload\b[^\n]{0,60}(flag|round|above|high|2\u00D7|2x|cpu|core)|(flag|round)[^\n]{0,60}\bload\b|busy|noisy machine))'
flags: i
match: contains
---
The reply's reason names the trap. The gain is significant, but every round ran with the load average above twice the core count.
